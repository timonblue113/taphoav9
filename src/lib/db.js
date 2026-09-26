/* Kết nối Supabase. URL + anon key lấy từ lúc build (.env) hoặc do người dùng nhập trong app. */
import { createClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { CONFIG } from '../config.js';

let client = null;
let conf = { url: '', anon: '' };

export async function loadConf() {
  const env = (import.meta && import.meta.env) || {};      // build không có .env thì vẫn chạy
  const envUrl = env.VITE_SUPABASE_URL || CONFIG.SUPABASE_URL || '';
  const envKey = env.VITE_SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY || '';
  const { value } = await Preferences.get({ key: 'sb.conf' });
  const saved = value ? JSON.parse(value) : {};
  // Ưu tiên thứ tự: người dùng tự nhập > secret lúc build > config.js
  conf = { url: saved.url || envUrl, anon: saved.anon || envKey };
  return conf;
}
export async function saveConf(c) {
  conf = { ...conf, ...c };
  await Preferences.set({ key: 'sb.conf', value: JSON.stringify(conf) });
  client = null;
  return conf;
}
export const getConf = () => ({ ...conf });
export const confReady = () => !!(conf.url && conf.anon);

export function sb() {
  if (!confReady()) throw new Error('Chưa cấu hình Supabase');
  if (!client) {
    client = createClient(conf.url, conf.anon, {
      auth: { persistSession: true, autoRefreshToken: true, storage: capStorage },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

/* Lưu phiên đăng nhập bằng Preferences để mở app lại không phải nhập mật khẩu */
const capStorage = {
  getItem: async (k) => (await Preferences.get({ key: k })).value,
  setItem: async (k, v) => { await Preferences.set({ key: k, value: v }); },
  removeItem: async (k) => { await Preferences.remove({ key: k }); },
};

/* ── Hàng đợi khi mất mạng: đơn vẫn bán được, có sóng thì tự đẩy lên ── */
const QK = 'sync.queue';
export async function queueGet() {
  const { value } = await Preferences.get({ key: QK });
  try { return value ? JSON.parse(value) : []; } catch { return []; }
}
export async function queuePut(list) {
  await Preferences.set({ key: QK, value: JSON.stringify(list.slice(-500)) });
}
export async function queueAdd(job) {
  const q = await queueGet();
  const next = q.filter((j) => j.k !== job.k).concat([job]);
  await queuePut(next);
  return next.length;
}
/** Đẩy hàng đợi lên. Trả về số việc còn lại. */
export async function queueFlush() {
  let q = await queueGet();
  if (!q.length) return 0;
  const left = [];
  for (const job of q) {
    try {
      const c = sb();
      if (job.t === 'order') await c.from('orders').upsert(job.d).throwOnError();
      else if (job.t === 'product') await c.from('products').upsert(job.d).throwOnError();
      else if (job.t === 'debt') await c.from('debts').upsert(job.d).throwOnError();
      else if (job.t === 'shop') await c.from('shops').update(job.d).eq('id', job.id).throwOnError();
      else if (job.t === 'delproduct') await c.from('products').delete().eq('shop_id', job.d.shop_id).eq('code', job.d.code).throwOnError();
    } catch { left.push(job); }
  }
  await queuePut(left);
  return left.length;
}

/* Bộ nhớ đệm để mở app là thấy số liệu ngay, chưa cần chờ mạng */
export async function cacheGet(k) {
  const { value } = await Preferences.get({ key: 'cache.' + k });
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
export async function cacheSet(k, v) {
  try { await Preferences.set({ key: 'cache.' + k, value: JSON.stringify(v) }); } catch { /* đầy bộ nhớ thì thôi */ }
}
