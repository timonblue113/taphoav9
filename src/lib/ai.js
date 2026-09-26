/* Trợ lý AI — gọi qua cổng trung chuyển Gemini dùng CHUNG với app vật tư điện
   nước (Cloudflare Worker), nhưng qua đường XÁC THỰC RIÊNG bằng khoá bí mật
   tĩnh, không cần chung Supabase project với app vật tư (worker đã được vá
   thêm nhánh X-App-Key — xem ghi chú trong worker-vattu-daxong/index.js).

   Cổng chỉ nhận ẢNH, không tra được bằng riêng dãy số hay câu chữ:
     'vat_tu'   → ảnh 1 món hàng → tên gợi ý
     'chung_tu' → ảnh hoá đơn/đơn viết tay → nhiều dòng hàng */
import { CONFIG } from '../config.js';
import { deacc } from './util.js';
import { Preferences } from '@capacitor/preferences';

const PROXY = (CONFIG.GEMINI_PROXY_URL || '').replace(/\/+$/, '');
let _appKey = CONFIG.GEMINI_APP_KEY || '';
export const aiReady = () => !!(PROXY && _appKey);

const AI_KEY_STORE = 'gemini.app_key';

/** Nạp khoá AI đã lưu — gọi 1 lần khi khởi động. */
export async function loadAiKey() {
  try {
    const { value } = await Preferences.get({ key: AI_KEY_STORE });
    if (value && value.trim()) { _appKey = value.trim(); return; }
  } catch { /* Capacitor chưa sẵn sàng, thử localStorage */ }
  try {
    const v = localStorage.getItem(AI_KEY_STORE);
    if (v && v.trim()) _appKey = v.trim();
  } catch { /* bỏ qua */ }
}

/** Lưu khoá AI mới — gọi khi người dùng nhập từ Settings. */
export async function saveAiKey(key) {
  _appKey = (key || '').trim();
  try {
    await Preferences.set({ key: AI_KEY_STORE, value: _appKey });
  } catch { /* bỏ qua */ }
  try { localStorage.setItem(AI_KEY_STORE, _appKey); } catch { /* bỏ qua */ }
}

/** Định danh dùng để TÁCH HẠN MỨC riêng cho từng quầy/người bán trên worker —
 *  không phải để xác thực, chỉ để một quầy bán nhiều không "ăn" hết lượt của
 *  quầy khác. An toàn để lộ, không cần giữ bí mật. */
let danhTinh = 'khach';
/** HTTP header value BẮT BUỘC chỉ gồm ký tự ASCII (0–127) — tên người bán tiếng
 *  Việt có dấu (VD "Hương") sẽ làm fetch() ném lỗi ByteString nếu không lọc.
 *  deacc() bỏ dấu, rồi lọc thêm lần nữa phòng ký tự lạ khác lọt qua (emoji...). */
const antoanHeader = (s) => deacc(String(s || '')).replace(/[^\x20-\x7E]/g, '_').trim() || 'khach';

export function datDanhTinhAi(shopJoinCode, sellerName) {
  const a = antoanHeader(shopJoinCode).replace(/\s+/g, '');
  const b = antoanHeader(sellerName).toLowerCase().replace(/\s+/g, '');
  danhTinh = `${a || 'quay'}:${b || 'nv'}`.slice(0, 80);
}

async function goi(base64, mimeType, cheDo) {
  if (!PROXY) throw new Error('Chưa cấu hình cổng AI trong src/config.js.');
  if (!_appKey) throw new Error('Chưa nhập khoá AI — vào Cài đặt → Trợ lý AI để nhập.');
  let r;
  try {
    r = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Key': _appKey, 'X-App-User': danhTinh },
      body: JSON.stringify({ base64, mimeType: mimeType || 'image/jpeg', che_do: cheDo }),
    });
  } catch (e) {
    throw new Error('Không gọi được cổng AI — kiểm tra mạng.');
  }
  let d = {};
  try { d = await r.json(); } catch { /* thân rỗng, ví dụ 204/429 không kèm JSON */ }
  if (!r.ok) throw new Error(d.loi || ('Cổng AI báo lỗi ' + r.status));
  return d;
}

/** Chụp ảnh MỘT món hàng chưa có trong danh mục → tên gợi ý.
 *  Danh mục điện/nước/công cụ/khác của worker không hợp với tạp hoá nên bỏ qua,
 *  chỉ lấy "ten". */
export async function aiIdentifyPhoto(base64, mimeType) {
  const d = await goi(base64, mimeType, 'vat_tu');
  return { found: !!(d.ten && d.ten.trim()), name: (d.ten || '').trim() };
}

/** Chụp ảnh đơn hàng viết tay hoặc in → danh sách dòng hàng. */
export async function aiReadOrder(base64, mimeType) {
  const d = await goi(base64, mimeType, 'chung_tu');
  const lines = (Array.isArray(d.dong) ? d.dong : []).map((x) => ({
    name: x.ten || '', qty: Number(x.soLuong) || 1, price: Number(x.donGia) || 0,
  }));
  return { customer: '', lines };
}
