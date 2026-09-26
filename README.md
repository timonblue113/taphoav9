# Sổ tay bán hàng — tạp hoá

App Android: quét mã vạch, **nhớ giá một lần bán mãi**, chốt sổ ngày/tuần/tháng, hai người bán
cùng lúc không đè dữ liệu, sổ nợ khách, in bill máy nhiệt T82. Dữ liệu trên Supabase của bạn,
danh mục **153.685 mã hàng** đóng gói sẵn trong app, trợ lý AI đã nối sẵn qua cổng của bạn.

---

## Cài đặt — làm đúng thứ tự này

### 1. Supabase — làm đủ CẢ HAI bước, thiếu bước 2 sẽ không đăng ký được

1. [supabase.com](https://supabase.com) → **New project**.
2. **Authentication → Providers → Email → tắt "Confirm email" → Save.**
   *(Bỏ qua bước này thì tạo tài khoản xong app sẽ đứng lại chờ xác nhận qua email, không vào thẳng được.)*
3. **SQL Editor** → dán toàn bộ [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
4. **Settings → API** → chép **Project URL** và **anon public key**.

### 2. Điền sẵn để khỏi nhập tay trên điện thoại

Mở `src/config.js`, điền 2 dòng đầu:

```js
export const CONFIG = {
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  GEMINI_PROXY_URL: 'https://so-ban-hang-gemini.buivanut991.workers.dev',   // đã điền sẵn
  GEMINI_MODEL: 'gemini-2.5-flash',
};
```

> anon key được Supabase thiết kế để công khai — an toàn vì đã bật RLS (đã kiểm: người ngoài
> quầy thấy 0 đơn, 0 mặt hàng, chèn/sửa đều bị chặn). Vẫn nên để repo GitHub ở chế độ **Private**
> cho chắc, đặc biệt vì worker AI của bạn cũng lộ trong này.

**Muốn giấu hẳn, không đưa vào mã nguồn:** để `config.js` trống, vào GitHub repo →
**Settings → Secrets and variables → Actions** → thêm `SUPABASE_URL` và `SUPABASE_ANON_KEY`.
Workflow tự ưu tiên secret trước, config.js chỉ dùng khi không có secret.

### 3. Đưa lên GitHub

```bash
bash push-len-github.sh <tên-github-của-bạn> sotay-banhang
```

### 4. Lấy APK — GitHub tự dựng, không cần cài Android Studio

Repo → tab **Actions** → chờ ~5 phút → **Artifacts** → tải **SoTayBanHang-APK** → cài vào máy.

### 5. Mở app

Đã điền `config.js` thì app **vào thẳng màn tạo tài khoản**, không hỏi Supabase URL/key.
Tạo tài khoản → đặt tên quầy → bán ngay, không cần mở email xác nhận.

**Máy thứ hai:** đăng nhập **cùng email + mật khẩu**, chọn **tên người bán khác**.

---

## Trợ lý AI — dùng chung cổng với app vật tư, tách biệt hoàn toàn dữ liệu

Cổng `so-ban-hang-gemini.buivanut991.workers.dev` vốn viết riêng cho app vật tư điện nước
trước đó. App tạp hoá **giữ Supabase project riêng** (bước Cài đặt Supabase phía trên không đổi)
— worker được vá thêm một đường xác thực thứ hai bằng **khoá bí mật tĩnh**, không đụng gì tới
Supabase/`ho_so` của project vật tư.

Vì cổng chỉ nhận **ảnh**, còn lại **2 trong 5 tính năng AI** ban đầu:

| Tính năng | Trạng thái |
|---|---|
| Đọc ảnh đơn hàng viết tay/in | ✔ hoạt động — map sang chế độ `chung_tu` của cổng |
| Chụp ảnh món hàng chưa có mã để AI đoán tên | ✔ hoạt động — map sang chế độ `vat_tu` |
| Tra mã vạch lạ chỉ bằng dãy số (không ảnh) | ✘ bỏ — cổng luôn đòi ảnh |
| Đọc số mã vạch từ ảnh chụp | ✘ bỏ — cổng chỉ trả tên, không trả số |
| Viết lại tên viết tắt / gợi ý giá bán (chỉ chữ) | ✘ bỏ — cổng không có endpoint chỉ-chữ |

### Bước bắt buộc: vá + deploy lại worker (làm 1 lần)

1. Dán đè `worker-vattu-daxong/index.js` (đã vá) vào repo worker của bạn, `wrangler deploy`.
   Diff so với bản gốc: sửa lỗi 204 (6 dòng) + thêm nhánh xác thực khoá bí mật (~25 dòng),
   **không đổi logic cũ** — luồng app vật tư (Bearer JWT + `ho_so`) chạy y nguyên.
2. Sinh 1 khoá bí mật đủ mạnh, ví dụ chạy:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
3. `wrangler secret put TAPHOA_KEY` → dán khoá vừa sinh.
4. Dán **cùng khoá đó** vào `src/config.js` → `GEMINI_APP_KEY`.

Từ đó app tạp hoá gọi cổng qua header `X-App-Key` (khoá bí mật) + `X-App-User` (chỉ để tách hạn
mức riêng từng quầy, không dùng để xác thực) — hoàn toàn không chạm tới Supabase của project vật tư.

### Hai lỗi thật đã bắt được và vá — không phải đoán, đã chạy code thật để xác nhận

**1. Lỗi 204 body.** `worker-vattu-daxong/index.js` dòng 444 gọi `json({}, 204)` — status 204
**không được phép có body** theo chuẩn Fetch, Cloudflare ném lỗi ngay. Vì mọi request từ trình
duyệt đều bắn `OPTIONS` dò CORS trước, **worker chưa từng phục vụ được lượt gọi nào**, kể cả khoá
đúng. Kiểm bằng đúng lớp `Response` chuẩn Fetch — tái hiện đúng lỗi bạn gặp, sau vá thì hết.

**2. Lỗi header chứa dấu tiếng Việt.** Lúc đầu tôi để `X-App-User` mang thẳng tên người bán —
chạy thử với tên thật `"Hương"` thì vỡ ngay: `TypeError: Cannot convert argument to a ByteString`,
vì HTTP header chỉ được phép ký tự ASCII. Tên tiếng Việt hầu hết có dấu, nên lỗi này sẽ đụng
**gần như mọi người bán**. Đã vá bằng cách bỏ dấu trước khi đưa vào header, kiểm lại với "Hương",
"Tí", "Ngọc Ánh", "Đặng Văn Sáu" — cả bốn đều chạy đúng.

Cả hai lỗi đều được xác nhận bằng cách chạy thật `index.js` với `Request`/`Response` chuẩn Fetch
của Node 22 (cùng chuẩn Cloudflare Workers dùng), không phải đọc code rồi đoán.

### Không cần `supabase/ho_so.sql`

File này chỉ dùng nếu sau này đổi sang phương án dùng chung 1 Supabase project với app vật tư.
Giữ lại trong repo để tham khảo, cách dùng hiện tại (khoá bí mật riêng) không cần đụng tới.

---

## Quyền camera

Đã khai báo `CAMERA` trong AndroidManifest và xin quyền lúc mở màn quét. Nếu máy vẫn báo thiếu
quyền: **Cài đặt Android → Ứng dụng → Sổ tay bán hàng → Quyền → Máy ảnh → Cho phép**.
Nếu trước đó bạn từng chọn "Không hỏi lại", Android sẽ không tự hỏi lần hai — phải vào cài đặt hệ
thống bật tay.

---

## Vì sao trước đây không thấy danh mục

Nguyên nhân nhiều khả năng nhất: một số bản Android xử lý sẵn file đuôi `.gz` khi đóng gói APK,
khiến app giải nén lần hai và hỏng dữ liệu. Đã sửa hai lớp:

1. Đổi tên file thành `catalog.bin` (không đuôi `.gz`) và ép Android đóng gói dạng thô
   (`noCompress` trong `build.gradle`, script `patch-android.mjs` tự thêm).
2. App đọc byte đầu file trước khi giải nén — thấy đúng chữ ký gzip mới giải nén, không thì
   dùng thẳng làm văn bản. Vậy nên dù layer nào đã tự giải nén trước, app vẫn đọc đúng.

Đã kiểm bằng bộ giả lập (`node test/e2e.cjs`), nhưng hành vi WebView Android thật thì tôi
không có thiết bị để thử — nếu bạn build APK mà vẫn không thấy danh mục, báo lại nguyên văn
thông báo lỗi trong **Cài đặt → Danh mục** để tôi biết chính xác nguyên nhân.

---

## In bill máy T82

| Đường | Cách dùng |
|---|---|
| **RawBT** | Cài *RawBT Print Service* trên CH Play, ghép đôi máy in, bấm **Gửi RawBT** |
| **Bluetooth thẳng** | Bấm **Máy in Bluetooth** — chỉ chạy với máy in loại BLE |
| **In qua hệ thống** | Bấm **In** — cần driver máy in cài trên Android |

Khổ giấy đổi trong **Cài đặt → Máy in**.

---

## Thay danh mục hàng hoá

```bash
node scripts/make-catalog.mjs banggia-moi.tsv
git add public/catalog.bin && git commit -m "cập nhật bảng giá" && git push
```

Hoặc nạp thẳng file trong **Cài đặt → Danh mục → Nạp tệp khác**, khỏi build lại.

---

## Đã kiểm thử

| Phần | Cách kiểm | Kết quả |
|---|---|---|
| Tra 150k mã vạch | 20.000 lượt ngẫu nhiên | 20.000/20.000 đúng |
| Schema + RLS | PostgreSQL 16 thật | Người lạ thấy 0 đơn / 0 hàng; chèn, sửa đều bị chặn |
| Luồng app | jsdom + React thật, Supabase giả lập | 20/20 mục đạt (`node test/e2e.cjs`) |
| Danh mục giải nén | byte gzip + byte đã giải nén sẵn | Cả hai trường hợp đều đọc đúng |
| Cổng AI | máy chủ giả lập theo đúng hình dạng REST | Gửi/nhận đúng định dạng JSON |

**Chưa kiểm được vì sandbox không có thiết bị thật:** camera Android thật, máy in T82 thật,
và worker AI thật của bạn (đã dò xác nhận còn sống, chưa xác nhận được đúng định dạng path).

---

## Cấu trúc

```
src/config.js        điền Supabase + cổng AI vào đây, khỏi nhập tay trên máy
src/lib/util.js       tiện ích + bộ tra danh mục 150k mã (tìm nhị phân)
src/lib/db.js         kết nối Supabase, hàng đợi offline, bộ nhớ đệm
src/lib/store.js      kho dữ liệu quầy + realtime + làm mới dự phòng
src/lib/ai.js         gọi cổng trung chuyển Gemini
src/lib/scan.js       ML Kit / BarcodeDetector
src/lib/print.js      dựng bill, ESC/POS, RawBT
src/App.jsx           toàn bộ màn hình
supabase/schema.sql   lược đồ + RLS + realtime
scripts/patch-android.mjs   quyền Android + chống nén lại catalog.bin
```
