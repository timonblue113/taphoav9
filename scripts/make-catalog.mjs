/* Chuyển bảng giá mới (.xlsx đã lưu thành .tsv/.csv) thành public/catalog.bin
   Dùng khi bạn có danh mục cập nhật: node scripts/make-catalog.mjs input.tsv */
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';

const inp = process.argv[2];
if (!inp) { console.error('Cách dùng: node scripts/make-catalog.mjs <tệp.tsv|.csv>\nCột: mã vạch, mã nội bộ, tên hàng, giá'); process.exit(1); }

const raw = fs.readFileSync(inp, 'utf8');
const sep = raw.includes('\t') ? '\t' : ',';
const rows = [];
const seen = new Set();
for (const line of raw.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const c = line.split(sep).map((x) => x.replace(/^"|"$/g, '').trim());
  const upc = (c[0] || '').replace(/\D/g, '');
  const sku = (c[1] || '').replace(/\D/g, '');
  const name = (c[2] || '').replace(/[\t|]/g, ' ').trim();
  const price = Math.round(Number(String(c[3] || '').replace(/[^\d.]/g, '')) || 0);
  if (!name) continue;
  const key = upc || 'S' + sku;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push([upc, sku, name, price].join('\t'));
}
rows.sort();                       // BẮT BUỘC sắp theo mã vạch — app tra bằng tìm nhị phân
const text = rows.join('\n');
fs.writeFileSync('public/catalog.bin', gzipSync(text, { level: 9 }));
console.log(`✔ ${rows.length.toLocaleString('vi-VN')} mã → public/catalog.bin (${(fs.statSync('public/catalog.bin').size / 1048576).toFixed(2)} MB)`);
