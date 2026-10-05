/* Quét mã vạch: ML Kit khi chạy trên Android, BarcodeDetector khi mở bằng trình duyệt. */
import { Capacitor } from '@capacitor/core';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';

export const isNative = () => Capacitor.isNativePlatform();
export const hasWebDetector = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;
export const WEB_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
const NATIVE_FORMATS = [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA,
  BarcodeFormat.UpcE, BarcodeFormat.Code128, BarcodeFormat.Code39, BarcodeFormat.Itf, BarcodeFormat.QrCode];

/** Bảo đảm mô-đun quét của Google đã sẵn sàng (máy Android tải 1 lần, vài MB) */
export async function ensureScanner() {
  if (!isNative()) return { ok: hasWebDetector(), note: hasWebDetector() ? '' : 'Trình duyệt này không tự đọc được mã — dùng nút chụp ảnh.' };
  try {
    const { supported } = await BarcodeScanner.isSupported();
    if (!supported) return { ok: false, note: 'Máy không hỗ trợ quét trực tiếp — dùng nút chụp ảnh.' };
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) {
      // Yêu cầu Google Play Services tải mô-đun ML Kit ở nền
      BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => {});
      return { ok: false, note: 'Đang tải mô-đun quét mã của Google (ML Kit)... Vui lòng chờ vài giây rồi bấm quét lại!' };
    }
    return { ok: true, note: '' };
  } catch (e) {
    return { ok: false, note: e.message || 'Không khởi tạo được camera.' };
  }
}

export async function requestCam() {
  if (!isNative()) return true;
  try {
    const check = await BarcodeScanner.checkPermissions();
    if (check.camera === 'granted' || check.camera === 'limited') return true;
    const { camera } = await BarcodeScanner.requestPermissions();
    return camera === 'granted' || camera === 'limited';
  } catch {
    return false;
  }
}

/** Quét MỘT lần (dùng cho luồng bán hàng) */
export async function scanOnce() {
  if (!isNative()) throw new Error('web');
  if (!(await requestCam())) throw new Error('Bạn chưa cấp quyền sử dụng camera trong Cài đặt máy.');
  const { barcodes } = await BarcodeScanner.scan({ formats: NATIVE_FORMATS });
  if (!barcodes || !barcodes.length) return '';
  return String(barcodes[0].rawValue || barcodes[0].displayValue || '').trim();
}

/** Quét LIÊN TỤC — dùng scan() lặp lại thay vì startScanning() chưa có trên Android.
 *  Mỗi lần quét xong tự gọi lại, camera mở gần như liên tục.
 *  Trả về hàm stop() để thoát vòng lặp. */
export async function startContinuousScan(onCode, onStop) {
  if (!isNative()) throw new Error('web');
  if (!(await requestCam())) throw new Error('Bạn chưa cấp quyền sử dụng camera.');

  let running = true;
  let lastCode = '';
  let lastAt = 0;
  const COOLDOWN = 1500; // ms — tránh đọc lại cùng 1 mã

  const loop = async () => {
    while (running) {
      try {
        const { barcodes } = await BarcodeScanner.scan({ formats: NATIVE_FORMATS });
        if (!running) break;
        if (barcodes && barcodes.length) {
          const code = String(barcodes[0].rawValue || barcodes[0].displayValue || '').trim();
          if (code) {
            const now = Date.now();
            if (code !== lastCode || now - lastAt >= COOLDOWN) {
              lastCode = code; lastAt = now;
              onCode(code);
            }
          }
        }
        // scan() trả về rỗng = người dùng bấm back hoặc hủy → thoát vòng lặp
        else { running = false; break; }
      } catch { running = false; break; }
    }
    if (onStop) onStop();
  };

  loop(); // chạy nền, không await

  return async () => { running = false; };
}

/** Đọc mã từ một tấm ảnh đã chụp (dự phòng, không cần camera trực tiếp) */
export async function readFromImage(file) {
  if (hasWebDetector()) {
    try {
      const bmp = await createImageBitmap(file);
      const det = new window.BarcodeDetector({ formats: WEB_FORMATS });
      const codes = await det.detect(bmp);
      if (codes && codes.length) return String(codes[0].rawValue || '').trim();
    } catch { /* rơi xuống AI */ }
  }
  return '';
}

export const fileToB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res({ b64: String(r.result).split(',')[1], mime: file.type || 'image/jpeg' });
  r.onerror = () => rej(new Error('Không đọc được ảnh'));
  r.readAsDataURL(file);
});

/** Nén ảnh trước khi gửi AI — resize về tối đa maxPx, quality 0.75
 *  Giảm từ vài MB xuống ~100KB → gọi Gemini nhanh hơn 3–5x */
export function compressImage(file, maxPx = 800, quality = 0.75) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((blob) => {
        if (!blob) { rej(new Error('Nén ảnh thất bại')); return; }
        const r2 = new FileReader();
        r2.onload = () => res({ b64: String(r2.result).split(',')[1], mime: 'image/jpeg' });
        r2.onerror = () => rej(new Error('Đọc ảnh nén lỗi'));
        r2.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Không load được ảnh')); };
    img.src = url;
  });
}
