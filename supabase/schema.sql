-- ═══════════════════════════════════════════════════════════════
--  SỔ TAY BÁN HÀNG — lược đồ Supabase
--  Dán toàn bộ file này vào Supabase → SQL Editor → Run.
--  Chạy lại nhiều lần vẫn an toàn.
-- ═══════════════════════════════════════════════════════════════

-- ───────── BẢNG ─────────

create table if not exists public.shops (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text unique not null,
  pin         text not null default '0000',
  addr        text not null default '',
  phone       text not null default '',
  paper       int  not null default 80,           -- 80mm (T82) hoặc 58mm
  no_accent   boolean not null default true,      -- bỏ dấu khi in nhiệt
  ai_on       boolean not null default true,
  owner       uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.shop_members (
  shop_id    uuid not null references public.shops(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'Người bán',
  role       text not null default 'seller',      -- owner | seller
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);

-- Hàng hoá của quầy: nơi lưu GIÁ ĐÃ NHỚ, bán lần sau khỏi nhập lại
create table if not exists public.products (
  shop_id     uuid not null references public.shops(id) on delete cascade,
  code        text not null,                      -- mã vạch EAN-13, hoặc mã tự đặt
  name        text not null,
  price       bigint not null default 0,
  cost        bigint not null default 0,
  unit        text   not null default '',
  stock_base  int,
  stock_at    timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default '',
  primary key (shop_id, code)
);
create index if not exists products_shop_updated on public.products (shop_id, updated_at desc);

-- Đơn hàng. id do máy tự sinh → bán offline rồi đẩy lên vẫn không trùng.
create table if not exists public.orders (
  id         text primary key,
  shop_id    uuid not null references public.shops(id) on delete cascade,
  day        date not null,
  ts         timestamptz not null default now(),
  seller     text not null default '',
  items      jsonb not null default '[]'::jsonb,
  gross      bigint not null default 0,
  discount   bigint not null default 0,
  total      bigint not null default 0,
  paid       bigint not null default 0,
  change     bigint not null default 0,
  is_debt    boolean not null default false,
  customer   text not null default '',
  note       text not null default '',
  voided     boolean not null default false,
  voided_at  timestamptz,
  created_by uuid references auth.users(id) default auth.uid()
);
create index if not exists orders_shop_day on public.orders (shop_id, day desc, ts desc);

create table if not exists public.debts (
  id       text primary key,
  shop_id  uuid not null references public.shops(id) on delete cascade,
  ts       timestamptz not null default now(),
  customer text not null,
  amount   bigint not null,                       -- dương = nợ thêm, âm = khách trả
  note     text not null default '',
  order_id text,
  by_name  text not null default ''
);
create index if not exists debts_shop_cust on public.debts (shop_id, customer);

-- ───────── HÀM TIỆN ÍCH ─────────

-- Kiểm tra thành viên. security definer để chính sách RLS không gọi vòng lẫn nhau.
create or replace function public.is_member(p_shop uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.shop_members
                 where shop_id = p_shop and user_id = auth.uid());
$$;

-- Mở quầy mới: tạo shop + tự thêm mình làm chủ. Trả về id quầy.
create or replace function public.create_shop(p_name text, p_pin text, p_seller text)
returns public.shops language plpgsql security definer set search_path = public as $$
declare s public.shops; c text;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  loop
    c := lower(regexp_replace(p_name, '[^a-zA-Z0-9]', '', 'g'));
    c := left(coalesce(nullif(c,''), 'quay'), 12) || substr(md5(random()::text), 1, 4);
    exit when not exists (select 1 from public.shops where join_code = c);
  end loop;
  insert into public.shops (name, join_code, pin, owner)
  values (p_name, c, coalesce(p_pin,'0000'), auth.uid()) returning * into s;
  insert into public.shop_members (shop_id, user_id, name, role)
  values (s.id, auth.uid(), coalesce(nullif(p_seller,''),'Chủ quầy'), 'owner');
  return s;
end $$;

-- Máy thứ hai (tài khoản khác) xin vào quầy bằng mã + PIN.
create or replace function public.join_shop(p_code text, p_pin text, p_seller text)
returns public.shops language plpgsql security definer set search_path = public as $$
declare s public.shops;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  select * into s from public.shops where join_code = lower(trim(p_code));
  if not found then raise exception 'Không có quầy nào mang mã này'; end if;
  if s.pin <> p_pin then raise exception 'Mã PIN chưa đúng'; end if;
  insert into public.shop_members (shop_id, user_id, name)
  values (s.id, auth.uid(), coalesce(nullif(p_seller,''),'Người bán'))
  on conflict (shop_id, user_id) do update set name = excluded.name;
  return s;
end $$;

-- Doanh thu theo ngày — báo cáo tuần/tháng chỉ tốn 1 lượt gọi.
create or replace function public.shop_daily(p_shop uuid, p_from date, p_to date)
returns table (day date, rev bigint, cost bigint, cnt bigint)
language sql stable security definer set search_path = public as $$
  select o.day,
         sum(o.total)::bigint as rev,
         coalesce(sum((select sum((i->>'qty')::numeric * (i->>'cost')::numeric)
                       from jsonb_array_elements(o.items) i)), 0)::bigint as cost,
         count(*)::bigint as cnt
  from public.orders o
  where o.shop_id = p_shop and public.is_member(p_shop)
    and o.voided = false and o.day between p_from and p_to
  group by o.day order by o.day;
$$;

-- Hàng bán chạy trong khoảng ngày.
create or replace function public.shop_top_items(p_shop uuid, p_from date, p_to date, p_limit int default 20)
returns table (code text, name text, qty numeric, revenue numeric)
language sql stable security definer set search_path = public as $$
  select i->>'code' as code,
         max(i->>'name') as name,
         sum((i->>'qty')::numeric) as qty,
         sum((i->>'qty')::numeric * (i->>'price')::numeric) as revenue
  from public.orders o, lateral jsonb_array_elements(o.items) i
  where o.shop_id = p_shop and public.is_member(p_shop)
    and o.voided = false and o.day between p_from and p_to
  group by 1 order by qty desc limit p_limit;
$$;

-- Số dư nợ từng khách.
create or replace function public.shop_debt_balance(p_shop uuid)
returns table (customer text, balance bigint, last_ts timestamptz, n int)
language sql stable security definer set search_path = public as $$
  select d.customer, sum(d.amount)::bigint, max(d.ts), count(*)::int
  from public.debts d
  where d.shop_id = p_shop and public.is_member(p_shop)
  group by d.customer having sum(d.amount) <> 0 order by 2 desc;
$$;

-- Tồn kho ước tính = số đã nhập trừ số bán ra kể từ lúc nhập.
create or replace function public.shop_stock(p_shop uuid)
returns table (code text, name text, stock_base int, sold numeric, remain numeric)
language sql stable security definer set search_path = public as $$
  select p.code, p.name, p.stock_base,
         coalesce((select sum((i->>'qty')::numeric)
                   from public.orders o, lateral jsonb_array_elements(o.items) i
                   where o.shop_id = p.shop_id and o.voided = false
                     and i->>'code' = p.code and o.ts >= p.stock_at), 0) as sold,
         p.stock_base - coalesce((select sum((i->>'qty')::numeric)
                   from public.orders o, lateral jsonb_array_elements(o.items) i
                   where o.shop_id = p.shop_id and o.voided = false
                     and i->>'code' = p.code and o.ts >= p.stock_at), 0) as remain
  from public.products p
  where p.shop_id = p_shop and public.is_member(p_shop) and p.stock_base is not null;
$$;

-- ───────── KHOÁ HÀNG (RLS) ─────────
-- Không có RLS thì ai có anon key cũng đọc được sổ của bạn. Bắt buộc bật.

alter table public.shops        enable row level security;
alter table public.shop_members enable row level security;
alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.debts        enable row level security;

drop policy if exists shops_read   on public.shops;
drop policy if exists shops_write  on public.shops;
create policy shops_read  on public.shops for select using (public.is_member(id));
create policy shops_write on public.shops for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_read on public.shop_members;
create policy members_read on public.shop_members for select using (public.is_member(shop_id));

drop policy if exists products_all on public.products;
create policy products_all on public.products for all
  using (public.is_member(shop_id)) with check (public.is_member(shop_id));

drop policy if exists orders_all on public.orders;
create policy orders_all on public.orders for all
  using (public.is_member(shop_id)) with check (public.is_member(shop_id));

drop policy if exists debts_all on public.debts;
create policy debts_all on public.debts for all
  using (public.is_member(shop_id)) with check (public.is_member(shop_id));

-- ───────── ĐỒNG BỘ TỨC THÌ giữa hai máy ─────────
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.debts;
alter table public.orders   replica identity full;
alter table public.products replica identity full;
alter table public.debts    replica identity full;


-- ═══════════════════════════════════════════════════════════════
--  BẢNG GIẤY PHÉP — dùng thử + kích hoạt
--  Thêm vào cuối schema.sql, chạy lại an toàn.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.licenses (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  trial_start  timestamptz not null default now(),   -- ngày tạo tài khoản = ngày bắt đầu dùng thử
  activated    boolean     not null default false,    -- true sau khi admin cấp kích hoạt
  activated_at timestamptz,
  note         text        not null default '',       -- admin ghi chú: đã thanh toán, gói nào...
  created_at   timestamptz not null default now()
);

alter table public.licenses enable row level security;

-- Người dùng chỉ đọc được dòng của mình (để app biết còn mấy ngày dùng thử / đã kích hoạt chưa)
drop policy if exists licenses_self_read on public.licenses;
create policy licenses_self_read on public.licenses
  for select using (auth.uid() = user_id);

-- Người dùng KHÔNG được tự sửa (chống gian lận)
-- Chỉ admin (service_role) mới update được — app dùng anon key nên không sửa được

-- Hàm tự tạo dòng license khi đăng ký tài khoản mới
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.licenses (user_id, trial_start)
  values (new.id, now())
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Hàm app gọi để lấy trạng thái giấy phép của mình
create or replace function public.my_license()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'trial_start', l.trial_start,
    'activated',   l.activated,
    'days_used',   extract(epoch from (now() - l.trial_start)) / 86400
  )
  from public.licenses l
  where l.user_id = auth.uid();
$$;
