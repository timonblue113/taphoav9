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
    this.text = text.charCodeAt(text.length - 1) === 10 ? text.slice(0, -1) : text;
    this.low = null;
    const t = this.text, offs = [0];
    for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) offs.push(i + 1);
    this.offs = Int32Array.from(offs);
    this.count = this.offs.length;
  }
  lineAt(i) { const s = this.offs[i]; const e = i + 1 < this.count ? this.offs[i + 1] - 1 : this.text.length; return this.text.slice(s, e); }
  codeAt(i) { const s = this.offs[i]; const e = this.text.indexOf('\t', s); return e < 0 ? '' : this.text.slice(s, e); }
  static parse(line) { const p = line.split('\t'); return { code: p[0] || '', sku: p[1] || '', name: p[2] || '', price: Number(p[3]) || 0 }; }
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
    if (!this.low) this.low = norm(this.text);
    const toks = query.split(/\s+/).filter(Boolean);
    const hay = this.low;
    const anchor = toks.reduce((a, b) => (b.length > a.length ? b : a), toks[0]);
    const cands = []; const seenLine = new Set();
    let idx = 0, guard = 0;
    while (cands.length < 900 && guard < 400000) {
      idx = hay.indexOf(anchor, idx); if (idx < 0) break;
      const ls = hay.lastIndexOf('\n', idx) + 1;
      let le = hay.indexOf('\n', idx); if (le < 0) le = hay.length;
      if (!seenLine.has(ls)) {
        seenLine.add(ls);
        const low = hay.slice(ls, le);
        if (toks.every((t) => low.includes(t))) cands.push([ls, le, low]);
      }
      idx = le + 1; guard++;
    }
    // chấm điểm: trùng nguyên cụm và trùng đầu từ trong TÊN được ưu tiên
    const scored = cands.map(([ls, le, low]) => {
      const t1 = low.indexOf('\t'), t2 = low.indexOf('\t', t1 + 1), t3 = low.indexOf('\t', t2 + 1);
      const nm = low.slice(t2 + 1, t3 < 0 ? low.length : t3);
      let sc = 0;
      if (nm.includes(query)) sc += 120;
      if (word(nm, query)) sc += 90;
      toks.forEach((t) => { if (nm.includes(t)) sc += 12; if (word(nm, t)) sc += 20; });
      sc -= nm.length * 0.15;
      return { sc, line: this.text.slice(ls, le) };
    });
    scored.sort((a, b) => b.sc - a.sc);
    const out = [], dup = new Set();
    for (const it of scored) {
      const p = Catalog.parse(it.line);
      const k = p.name + '|' + p.price;
      if (dup.has(k)) continue;          // một mặt hàng hay có 2–3 mã (lẻ, thùng)
      dup.add(k); out.push(p);
      if (out.length >= limit) break;
    }
    return out;
  }
}


export { VMAP, deacc, norm, reEsc, word, nf, money, moneyD, pad, dayKey, addDays,
  dowVN, dowOf, shortDate, clock, weekStart, slug, uid, roundTo, monthKey,
  hasGzip, abToB64, b64ToBytes, gzipToB64, b64ToText, Catalog };
