/* Supabase + Capacitor giả lập, đủ để chạy thử toàn bộ luồng app */
const mem = { pref: {}, shops: [], members: [], products: [], orders: [], debts: [] };
globalThis.__mem = mem;
const uid = () => Math.random().toString(36).slice(2, 10);
let AUTH = null;
const CUR = () => (AUTH ? AUTH.user.id : null);
const isMember = (sid) => mem.members.some((m) => m.shop_id === sid && m.user_id === CUR());

function table(name) {
  const q = { name, filters: [], _order: null, _limit: null };
  const rows = () => mem[name].filter((r) => q.filters.every(([k, v]) => r[k] === v))
                              .filter((r) => (r.shop_id ? isMember(r.shop_id) : (name === 'shops' ? isMember(r.id) : true)));
  const api = {
    select() { return api; },
    eq(k, v) { q.filters.push([k, v]); return api; },
    order() { return api; },
    limit() { return api; },
    throwOnError() { return api; },
    async insert(d) { const a = Array.isArray(d) ? d : [d]; a.forEach((r) => mem[name].push({ ...r })); return { data: a, error: null }; },
    async upsert(d) {
      const a = Array.isArray(d) ? d : [d];
      a.forEach((r) => {
        const key = name === 'products' ? (x) => x.shop_id === r.shop_id && x.code === r.code : (x) => x.id === r.id;
        const i = mem[name].findIndex(key);
        if (i >= 0) mem[name][i] = { ...mem[name][i], ...r }; else mem[name].push({ ...r });
      });
      return { data: a, error: null };
    },
    async update(d) { rows().forEach((r) => Object.assign(r, d)); return { data: null, error: null }; },
    async delete() { const del = rows(); mem[name] = mem[name].filter((r) => !del.includes(r)); return { error: null }; },
    then(res) { return Promise.resolve({ data: rows(), error: null }).then(res); },
  };
  return api;
}

const RPC = {
  create_shop: ({ p_name, p_pin, p_seller }) => {
    const s = { id: uid(), name: p_name, join_code: p_name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) + uid().slice(0, 4), pin: p_pin, addr: '', phone: '', paper: 80, no_accent: true, ai_on: true, owner: CUR(), created_at: new Date().toISOString() };
    mem.shops.push(s); mem.members.push({ shop_id: s.id, user_id: CUR(), name: p_seller, role: 'owner' });
    return s;
  },
  join_shop: ({ p_code, p_pin, p_seller }) => {
    const s = mem.shops.find((x) => x.join_code === p_code);
    if (!s) throw new Error('Không có quầy nào mang mã này');
    if (s.pin !== p_pin) throw new Error('Mã PIN chưa đúng');
    mem.members.push({ shop_id: s.id, user_id: CUR(), name: p_seller, role: 'seller' });
    return s;
  },
  shop_daily: ({ p_shop, p_from, p_to }) => {
    const by = {};
    mem.orders.filter((o) => o.shop_id === p_shop && !o.voided && o.day >= p_from && o.day <= p_to).forEach((o) => {
      const t = by[o.day] || (by[o.day] = { day: o.day, rev: 0, cost: 0, cnt: 0 });
      t.rev += o.total; t.cnt++;
      (o.items || []).forEach((i) => { t.cost += (i.cost || 0) * i.qty; });
    });
    return Object.values(by);
  },
  shop_top_items: ({ p_shop, p_from, p_to }) => {
    const by = {};
    mem.orders.filter((o) => o.shop_id === p_shop && !o.voided && o.day >= p_from && o.day <= p_to)
      .forEach((o) => (o.items || []).forEach((i) => {
        const t = by[i.code] || (by[i.code] = { code: i.code, name: i.name, qty: 0, revenue: 0 });
        t.qty += i.qty; t.revenue += i.qty * i.price;
      }));
    return Object.values(by).sort((a, b) => b.qty - a.qty);
  },
  shop_stock: ({ p_shop }) => mem.products.filter((p) => p.shop_id === p_shop && p.stock_base != null).map((p) => {
    const sold = mem.orders.filter((o) => o.shop_id === p_shop && !o.voided)
      .reduce((s, o) => s + (o.items || []).filter((i) => i.code === p.code).reduce((t, i) => t + i.qty, 0), 0);
    return { code: p.code, name: p.name, stock_base: p.stock_base, sold, remain: p.stock_base - sold };
  }),
};

export const createClient = () => ({
  from: table,
  rpc: async (fn, args) => { try { return { data: RPC[fn](args || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
  auth: {
    getSession: async () => ({ data: { session: AUTH } }),
    signUp: async ({ email }) => { AUTH = { user: { id: uid(), email } }; return { data: { session: AUTH }, error: null }; },
    signInWithPassword: async ({ email, password }) => {
      if (password === 'sai') return { data: {}, error: { message: 'Invalid login credentials' } };
      AUTH = AUTH || { user: { id: uid(), email } };
      return { data: { session: AUTH }, error: null };
    },
    signOut: async () => { AUTH = null; return {}; },
  },
  channel: () => { const ch = { on: () => ch, subscribe: () => ch, track: async () => {}, presenceState: () => ({}) }; return ch; },
  removeChannel: () => {},
});

export const Preferences = {
  get: async ({ key }) => ({ value: mem.pref[key] ?? null }),
  set: async ({ key, value }) => { mem.pref[key] = value; },
  remove: async ({ key }) => { delete mem.pref[key]; },
};
export const Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
export const BarcodeScanner = {};
export const BarcodeFormat = {};
export const AppLauncher = { canOpenUrl: async () => ({ value: false }), openUrl: async () => {} };
