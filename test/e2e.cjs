const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="r"></div></body></html>', { url: 'https://x.test/' });
const w = dom.window;
Object.defineProperty(global, 'navigator', { value: w.navigator, configurable: true, writable: true });
Object.assign(global, { window: w, document: w.document, HTMLElement: w.HTMLElement,
  Node: w.Node, Event: w.Event, MouseEvent: w.MouseEvent, KeyboardEvent: w.KeyboardEvent, Blob: w.Blob,
  getComputedStyle: w.getComputedStyle, requestAnimationFrame: (f) => setTimeout(f, 8), cancelAnimationFrame: clearTimeout });
global.IS_REACT_ACT_ENVIRONMENT = w.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(w.navigator, 'vibrate', { value: () => true, configurable: true });
w.navigator.clipboard = { writeText: async () => {} };
// fetch trả về tệp danh mục thật đã nén
const fs = require('fs');
global.fetch = async (u) => {
  if (String(u).includes('catalog')) {
    const buf = fs.readFileSync('public/catalog.bin');
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  return { ok: false, status: 404 };
};

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const App = require('./bundle.cjs').default;
const mem = global.__mem;

const root = createRoot(document.getElementById('r'));
const tick = async (ms = 40) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const all = (s) => Array.from(document.querySelectorAll(s));
const byText = (s, t) => all(s).find((e) => (e.textContent || '').includes(t));
const click = async (el, what) => { if (!el) throw new Error('không thấy: ' + (what || '?')); await act(async () => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }); await tick(); };
const type = async (el, v, what) => {
  if (!el) throw new Error('không thấy ô nhập: ' + (what || '?'));
  const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement : w.HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
  await act(async () => { set.call(el, v); el.dispatchEvent(new w.Event('input', { bubbles: true })); });
  await tick();
};
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fail++; };

(async () => {
  await act(async () => { root.render(React.createElement(App)); });
  await tick(120);

  console.log('\n1) NỐI SUPABASE');
  ok(!!byText('div', 'Project URL'), 'hiện màn nhập Supabase');
  await type(all('input.field')[0], 'https://abcdxyz.supabase.co', 'url');
  await type(all('textarea.field')[0], 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefghijklmnopqrstuvwxyz0123456789', 'anon');
  await click(byText('button', 'Kiểm tra & lưu'), 'nút lưu');
  await tick(120);
  ok(!!byText('div', 'Đăng nhập'), 'chuyển sang màn đăng nhập');

  console.log('\n2) TẠO TÀI KHOẢN + MỞ QUẦY');
  await click(byText('button.chip', 'Tạo tài khoản'), 'tab tạo tk');
  await type(all('input.field')[0], 'baxuan@gmail.com');
  await type(all('input[type=password]')[0], 'matkhau123');
  await click(byText('button.btn.pay', 'Tạo tài khoản'), 'nút tạo tk');
  await tick(150);
  ok(!!byText('div', 'Ai đang bán ca này'), 'sang màn chọn quầy');
  await type(all('input.field')[0], 'Hương', 'tên người bán');
  const nameInputs = all('input.field');
  await type(nameInputs[1], 'Tạp hoá Ba Xuân', 'tên quầy');
  await type(all('input.field.num')[0], '1234', 'pin');
  await click(byText('button.btn.pay', 'Mở quầy'), 'nút mở quầy');
  await tick(400);
  ok(!!byText('.top', 'Tạp hoá Ba Xuân'), 'vào được màn bán');
  ok(mem.shops.length === 1, 'quầy đã ghi vào Supabase');

  console.log('\n3) DANH MỤC ĐÓNG GÓI SẴN TRONG APP');
  await tick(1500);
  const cnt = (document.body.textContent.match(/tra được\s*([\d.]+)/) || [])[1];
  ok(!!byText('.top', 'Tạp hoá'), 'app vẫn chạy sau khi nạp danh mục');
  await type(document.querySelector('input.search'), 'mi hao hao', 'ô tìm');
  await tick(200);
  const res = all('.card button.item');
  ok(res.length > 0, `giải nén + tra danh mục OK — tìm ra ${res.length} kết quả "mi hao hao"`);
  console.log('     ' + (res[0] ? (res[0].textContent || '').slice(0, 40) : ''));

  console.log('\n4) ĐẶT GIÁ → NHỚ GIÁ');
  await click(res[0], 'kết quả đầu');
  await tick(80);
  for (const d of ['5', '000']) await click(byText('.key', d), 'phím ' + d);
  await click(byText('.sheet .sf button', 'Lưu giá'), 'nút lưu giá');
  await tick(250);
  ok(document.body.textContent.includes('1 món'), 'giỏ có 1 món');
  ok(mem.products.length === 1 && mem.products[0].price === 5000, 'giá 5.000 đã lưu lên Supabase: ' + (mem.products[0] || {}).name);

  console.log('\n5) QUÉT LẠI → TỰ NHỚ GIÁ, KHÔNG HỎI LẠI');
  const code = mem.products[0].code;
  await type(document.querySelector('input.search'), code);
  await act(async () => { document.querySelector('input.search').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await tick(200);
  ok(document.body.textContent.includes('2 món'), 'thêm thẳng vào giỏ với giá đã nhớ');

  console.log('\n6) TÍNH TIỀN');
  await click(byText('.dock button', 'Tính tiền'), 'nút tính tiền');
  await tick(100);
  const payIn = all('.sheet input.field.num').find((i) => i.placeholder && i.placeholder.includes('khách đưa'));
  await type(payIn, '20000', 'khách đưa');
  ok(document.body.textContent.includes('10.000'), 'tiền thối = 10.000');
  await click(byText('.sheet .sf button', 'Xong'), 'nút xong');
  await tick(350);
  ok(mem.orders.length === 1 && mem.orders[0].total === 10000, 'đơn 10.000 đã lên Supabase');
  ok(!document.body.textContent.includes('2 món'), 'giỏ trống lại');

  console.log('\n7) MÁY THỨ HAI BÁN CÙNG LÚC');
  const sid = mem.shops[0].id;
  const today = mem.orders[0].day;
  mem.orders.push({ id: 'ti-1', shop_id: sid, day: today, ts: new Date().toISOString(), seller: 'Tí',
    items: [{ code: 'X1', name: 'Bia Sài Gòn', qty: 24, price: 15000, cost: 13500 }],
    gross: 360000, discount: 0, total: 360000, paid: 400000, change: 40000, is_debt: false, voided: false });
  await click(byText('.tab', 'Số liệu'), 'thẻ số liệu');
  await tick(500);
  const t = document.body.textContent;
  ok(t.includes('370.000'), 'doanh thu gộp hai máy = 370.000');
  ok(t.includes('2 đơn'), 'đếm đúng 2 đơn');
  ok(t.includes('Tí'), 'bảng ai-bán-bao-nhiêu có Tí');

  console.log('\n8) CÔNG NỢ');
  await click(byText('.tab', 'Nợ'), 'thẻ nợ');
  await tick(150);
  await click(byText('button', 'Ghi nợ tay'), 'nút ghi nợ');
  await tick(100);
  const df = all('.sheet input.field');
  await type(df[0], 'Cô Bảy'); await type(all('.sheet input.field.num')[0], '200000');
  await click(byText('.sheet .sf button', 'Ghi vào sổ'), 'nút ghi sổ');
  await tick(250);
  ok(mem.debts.length === 1 && mem.debts[0].amount === 200000, 'nợ 200.000 đã lên Supabase');
  ok(document.body.textContent.includes('Cô Bảy'), 'Cô Bảy hiện trong sổ nợ');

  console.log('\n9) HUỶ ĐƠN');
  await click(byText('.tab', 'Đơn'), 'thẻ đơn');
  await tick(200);
  await click(all('.card button.item')[0], 'đơn đầu');
  await tick(120);
  await click(byText('.sheet .sf button', 'Huỷ'), 'nút huỷ');
  await tick(300);
  ok(mem.orders.some((o) => o.voided), 'đơn đã đánh dấu huỷ trên Supabase');

  console.log(fail === 0 ? '\nTẤT CẢ ĐẠT.' : `\nCÒN ${fail} MỤC HỎNG.`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('\nLỖI:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
