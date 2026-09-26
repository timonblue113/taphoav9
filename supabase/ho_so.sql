-- ⚠️  KHÔNG CẦN CHO CÁCH DÙNG HIỆN TẠI (khoá bí mật riêng, 2 Supabase project tách biệt).
-- File này chỉ dùng nếu sau này đổi sang phương án "dùng chung 1 Supabase project"
-- với app vật tư. Giữ lại để tham khảo, không cần chạy.

-- ═══════════════════════════════════════════════════════════════
-- Dùng CHUNG một Supabase project với app vật tư điện nước, để cổng AI
-- (Cloudflare Worker) nhận ra người bán tạp hoá.
--
-- Worker kiểm vé bằng cách hỏi thẳng bảng "ho_so":
--   GET {SUPABASE_URL}/rest/v1/ho_so?select=id,duyet   (kèm token người dùng)
-- Token hợp lệ + duyet=true thì mới cho gọi AI.
--
-- Nếu app vật tư đã có sẵn bảng "ho_so" thì đoạn CREATE TABLE bên dưới sẽ
-- bị bỏ qua (IF NOT EXISTS) — an toàn chạy chồng lên schema cũ.
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.ho_so (
  id         uuid primary key references auth.users(id) on delete cascade,
  duyet      boolean not null default false,
  ghi_chu    text not null default '',
  created_at timestamptz not null default now()
);

alter table public.ho_so enable row level security;

-- Người dùng đọc được đúng dòng của mình — worker cần quyền này để kiemVe() hoạt động.
drop policy if exists ho_so_tu_doc on public.ho_so;
create policy ho_so_tu_doc on public.ho_so for select using (auth.uid() = id);

-- Tự tạo dòng ho_so (chưa duyệt) ngay khi tài khoản mới đăng ký — admin chỉ
-- việc vào Table Editor bật cột "duyet" cho từng người bán, khỏi phải tự insert tay.
create or replace function public.tu_tao_ho_so()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ho_so (id, duyet) values (new.id, false)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists tren_nguoi_dung_moi on auth.users;
create trigger tren_nguoi_dung_moi
  after insert on auth.users
  for each row execute function public.tu_tao_ho_so();

-- Duyệt nhanh người bán tạp hoá đầu tiên (đổi email cho đúng rồi chạy):
-- update public.ho_so set duyet = true
--   where id = (select id from auth.users where email = 'banhang@gmail.com');
