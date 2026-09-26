/* In bill: trình duyệt · Bluetooth ESC/POS · RawBT.
   Đã kiểm: bill khớp đúng 48 ký tự khổ 80mm (T82) và 32 ký tự khổ 58mm. */
import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';
import { deacc, money, clock, shortDate } from './util.js';

const receiptLines = (order, shop, width) => {
  const W = width === 58 ? 32 : 48;
  const line = (ch) => ch.repeat(W);
  const two = (l, r) => { const s = Math.max(1, W - l.length - r.length); return l + ' '.repeat(s) + r; };
  const mid = (s) => { const p = Math.max(0, Math.floor((W - s.length) / 2)); return ' '.repeat(p) + s; };
  const out = [];
  out.push(mid((shop.name || 'TẠP HOÁ').toUpperCase()));
  if (shop.addr) out.push(mid(shop.addr));
  if (shop.phone) out.push(mid('ĐT: ' + shop.phone));
  out.push(line('='));
  out.push(two('Đơn ' + String(order.id).slice(-6), clock(order.ts)));
  out.push(two('Ngày ' + shortDate(order.day), 'NV: ' + order.seller));
  out.push(line('-'));
  order.items.forEach((it, i) => {
    out.push(`${i + 1}. ${it.name}`.slice(0, W));
    out.push(two(`   ${it.qty} x ${money(it.price)}`, money(it.qty * it.price)));
  });
  out.push(line('-'));
  out.push(two('Tổng cộng', money(order.gross)));
  if (order.discount > 0) out.push(two('Giảm giá', '-' + money(order.discount)));
  out.push(two('PHẢI TRẢ', money(order.total)));
  if (order.debt) out.push(two('GHI NỢ — ' + (order.customer || 'khách'), money(order.total)));
  else { out.push(two('Khách đưa', money(order.paid))); out.push(two('Tiền thối', money(Math.max(0, order.paid - order.total)))); }
  out.push(line('='));
  out.push(mid('Cảm ơn quý khách!'));
  out.push(mid('Hẹn gặp lại'));
  return out;
};

const receiptText = (o, s, w) => receiptLines(o, s, w).join('\n');

function escposBytes(order, shop, width, stripAccents = true) {
  const lines = receiptLines(order, shop, width);
  const body = (stripAccents ? deacc(lines.join('\n')) : lines.join('\n')) + '\n\n\n\n';
  const enc = new TextEncoder();
  const head = new Uint8Array([0x1b, 0x40, 0x1b, 0x74, 0x00]); // reset + code page
  const tail = new Uint8Array([0x1d, 0x56, 0x42, 0x00]);       // cắt giấy
  const mid = enc.encode(body);
  const out = new Uint8Array(head.length + mid.length + tail.length);
  out.set(head, 0); out.set(mid, head.length); out.set(tail, head.length + mid.length);
  return out;
}

function printViaBrowser(order, shop, width) {
  const txt = receiptText(order, shop, width);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bill</title><style>
    @page { size: ${width}mm auto; margin: 2mm; }
    body { margin:0; font-family: 'Courier New', ui-monospace, monospace; font-size: ${width === 58 ? 10.2 : 9.4}px; line-height:1.38; white-space:pre; }
  </style></head><body>${txt.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  f.srcdoc = html;
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* ignore */ } setTimeout(() => f.remove(), 1500); };
}

const BT_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', '0000ff00-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];

async function btConnect() {
  if (!navigator.bluetooth) throw new Error('Trình duyệt này không có Bluetooth. Mở app bằng Chrome trên Android.');
  const dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
  const srv = await dev.gatt.connect();
  for (const u of BT_SERVICES) {
    try {
      const s = await srv.getPrimaryService(u);
      const chars = await s.getCharacteristics();
      const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (w) return { dev, char: w };
    } catch { /* thử service kế tiếp */ }
  }
  throw new Error('Không tìm thấy cổng ghi trên máy in. Kiểm tra máy in đã ghép đôi và đang bật.');
}
async function btWrite(char, bytes) {
  const CH = 180;
  for (let i = 0; i < bytes.length; i += CH) {
    const part = bytes.slice(i, i + CH);
    if (char.writeValueWithoutResponse) await char.writeValueWithoutResponse(part);
    else await char.writeValue(part);
    await new Promise((r) => setTimeout(r, 24));
  }
}


/* ── in qua RawBT (đường ổn định nhất trên Android cho máy in nhiệt Bluetooth/USB) ── */
export async function printRawBT(order, shop, width, stripAccents = true) {
  const txt = stripAccents ? deacc(receiptText(order, shop, width)) : receiptText(order, shop, width);
  const url = 'rawbt:' + encodeURIComponent(txt);
  if (Capacitor.isNativePlatform()) {
    const { value } = await AppLauncher.canOpenUrl({ url: 'rawbt:' });
    if (!value) throw new Error('Chưa cài RawBT. Tải "RawBT Print Service" trên CH Play rồi thử lại.');
    await AppLauncher.openUrl({ url });
  } else { window.location.href = url; }
}

export { receiptLines, receiptText, escposBytes, printViaBrowser, btConnect, btWrite, BT_SERVICES };
