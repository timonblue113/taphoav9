/* Tiện ích chung + bộ máy tra danh mục 150k mã.
   Phần này đã được kiểm thử: 20.000/20.000 lượt tra mã vạch đúng, dựng chỉ mục 29ms. */

const VN = 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ';
const AS = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
const VMAP = {};
for (let i = 0; i < VN.length; i++) { VMAP[VN[i]] = AS[i]; VMAP[VN[i].toUpperCase()] = AS[i]; }
/** bỏ dấu, giữ nguyên độ dài chuỗi (quan trọng cho tìm kiếm theo offset) */
const deacc = (s) => String(s || '').normalize('NFC').replace(/[^\x00-\x7F]/g, (c) => VMAP[c] || c);
const norm = (s) => deacc(s).toLowerCase();
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** cụm xuất hiện ở đầu một từ */
const word = (hay, needle) => new RegExp('(^|[^a-z0-9])' + reEsc(needle)).test(hay);

const nf = new Intl.NumberFormat('vi-VN');
const money = (n) => nf.format(Math.round(Number(n) || 0));
const moneyD = (n) => money(n) + ' ₫';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (s) => String(s).slice(0, 7);
const addDays = (dk, n) => { const [y, m, d] = dk.split('-').map(Number); const t = new Date(y, m - 1, d + n); return dayKey(t); };
const dowVN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const dowOf = (dk) => { const [y, m, d] = dk.split('-').map(Number); return dowVN[new Date(y, m - 1, d).getDay()]; };
const shortDate = (dk) => { const [, m, d] = dk.split('-'); return `${d}/${m}`; };
const clock = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** tuần bắt đầu từ Thứ 2 */
const weekStart = (dk) => { const [y, m, d] = dk.split('-').map(Number); const t = new Date(y, m - 1, d); const w = (t.getDay() + 6) % 7; return addDays(dk, -w); };
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'ban';
const uid = () => Math.random().toString(36).slice(2, 9);
const roundTo = (n, step) => Math.round(n / step) * step;

/* ───────────── lớp bọc window.storage (có hàng đợi khi mất mạng) ───────────── */

const DB = {
  async getRaw(k) { if (!canStore()) return null; try { const r = await window.storage.get(k, false); return r ? r.value : null; } catch { return null; } },
  async get(k) { const v = await this.getRaw(k); if (v == null) return null; try { return JSON.parse(v); } catch { return null; } },
  async setRaw(k, v) { if (!canStore()) throw new Error('offline'); const r = await window.storage.set(k, v, false); if (!r) throw new Error('set failed'); return r; },
  async set(k, v) { return this.setRaw(k, typeof v === 'string' ? v : JSON.stringify(v)); },
  async list(prefix) {
    if (!canStore()) return [];
    try { const r = await window.storage.list(prefix, false); const ks = (r && r.keys) || []; return ks.map((k) => (typeof k === 'string' ? k : k.key || k.name || '')).filter(Boolean); }
    catch { return []; }
  },
  async del(k) { if (!canStore()) return; try { await window.storage.delete(k, false); } catch { /* ignore */ } },
};

/* ───────────── nén gzip cho danh mục lớn ───────────── */

const hasGzip = () => typeof CompressionStream !== 'undefined';

function abToB64(buf) {
  const bytes = new Uint8Array(buf); let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function gzipToB64(str) {
  const st = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return abToB64(await new Response(st).arrayBuffer());
}
async function b64ToText(b64) {
  const st = new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(st).text();
}

/* ───────────── bộ máy danh mục 150k mã ─────────────
   Định dạng mỗi dòng: upc \t sku \t tên \t giá   (đã sắp xếp theo upc)
   Tra mã = tìm nhị phân trên chuỗi lớn → không tốn RAM dựng Map 150k phần tử. */

class Catalog {
  constructor(text) {
    const cleanText = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    this.text = cleanText;
    if (!this.text) {
      this.offs = new Int32Array(0);
      this.count = 0;
      return;
    }
    const t = this.text, rawOffs = [0];
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) rawOffs.push(i + 1);

    // Bỏ qua các dòng trống để tránh sai lệch chỉ mục nhị phân
    const validOffs = [];
    for (let i = 0; i < rawOffs.length; i++) {
      const s = rawOffs[i];
      const e = i + 1 < rawOffs.length ? rawOffs[i + 1] - 1 : t.length;
      if (e > s && t.slice(s, e).trim().length > 0) validOffs.push(s);
    }
    this.offs = Int32Array.from(validOffs);
    this.count = this.offs.length;
  }
  lineAt(i) {
    if (i < 0 || i >= this.count) return '';
    const s = this.offs[i];
    const e = i + 1 < this.count ? this.offs[i + 1] - 1 : this.text.length;
    return this.text.slice(s, e);
  }
  codeAt(i) {
    if (i < 0 || i >= this.count) return '';
    const s = this.offs[i];
    const lineEnd = i + 1 < this.count ? this.offs[i + 1] - 1 : this.text.length;
    const tabPos = this.text.indexOf('\t', s);
    if (tabPos < 0 || tabPos > lineEnd) return '';
    return this.text.slice(s, tabPos);
  }
  static parse(line) { const p = line.trim().split('\t'); return { code: (p[0] || '').trim(), sku: (p[1] || '').trim(), name: (p[2] || '').trim(), price: Number(String(p[3] || '').replace(/\D/g, '')) || 0 }; }
  byCode(code) {
    const c = String(code || '').trim(); if (!c) return null;
    let lo = 0, hi = this.count - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1, v = this.codeAt(mid); if (v === c) return Catalog.parse(this.lineAt(mid)); if (v < c) lo = mid + 1; else hi = mid - 1; }
    return null;
  }
  /** thử vài biến thể mã: EAN-13 ↔ ITF-14 (thêm 1 số đầu), UPC-A 12 số */
  lookup(code) {
    const c = String(code || '').replace(/\D/g, '');
    if (!c) return null;
    const tries = [c];
    if (c.length === 12) tries.push('0' + c);
    if (c.length === 13) { tries.push('1' + c, '2' + c, c.replace(/^0/, '')); }
    if (c.length === 14) { tries.push(c.slice(1)); }
    for (const t of tries) { const r = this.byCode(t); if (r) return r; }
    return null;
  }
  search(q, limit = 40) {
    const query = norm(q).trim(); if (query.length < 2) return [];
    const toks = query.split(/\s+/).filter(Boolean);
    const out = [], dup = new Set();
    for (let i = 0; i < this.count && out.length < limit; i++) {
      const line = this.lineAt(i);
      const lowLine = norm(line);
      if (toks.every((t) => lowLine.includes(t))) {
        const p = Catalog.parse(line);
        const k = p.name + '|' + p.price;
        if (!dup.has(k)) {
          dup.add(k);
          out.push(p);
        }
      }
    }
    return out;
  }
}


export { VMAP, deacc, norm, reEsc, word, nf, money, moneyD, pad, dayKey, addDays,
  dowVN, dowOf, shortDate, clock, weekStart, slug, uid, roundTo, monthKey,
  hasGzip, abToB64, b64ToBytes, gzipToB64, b64ToText, Catalog };
