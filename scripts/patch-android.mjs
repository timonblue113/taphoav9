/* Chèn quyền Bluetooth/mạng và tên app vào dự án Android sau khi `cap sync`.
   Chạy được nhiều lần, không nhân bản. */
import fs from 'node:fs';

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const STRINGS = 'android/app/src/main/res/values/strings.xml';

const PERMS = `    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />`;

// Cho phép mở RawBT bằng Intent (Android 11+ bắt buộc khai báo)
const QUERIES = `    <queries>
        <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="rawbt" /></intent>
    </queries>`;

// Tự động tải mô-đun Google Barcode Scanner UI khi cài ứng dụng
const METADATA = `        <meta-data
            android:name="com.google.mlkit.vision.DEPENDENCIES"
            android:value="barcode_ui" />`;

if (!fs.existsSync(MANIFEST)) { console.error('Chưa có android/. Chạy: npx cap add android'); process.exit(1); }
let m = fs.readFileSync(MANIFEST, 'utf8');
if (!m.includes('android.permission.CAMERA')) m = m.replace('</manifest>', PERMS + '\n</manifest>');
if (!m.includes('android:scheme="rawbt"')) m = m.replace('</manifest>', QUERIES + '\n</manifest>');
if (!m.includes('com.google.mlkit.vision.DEPENDENCIES')) m = m.replace('</application>', METADATA + '\n    </application>');
fs.writeFileSync(MANIFEST, m);
console.log('✔ AndroidManifest: quyền CAMERA, đọc ảnh, Bluetooth, RawBT, MLKit metadata');

if (fs.existsSync(STRINGS)) {
  let s = fs.readFileSync(STRINGS, 'utf8');
  s = s.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Sổ tay bán hàng</string>')
       .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Sổ tay bán hàng</string>');
  fs.writeFileSync(STRINGS, s);
  console.log('✔ Tên app: Sổ tay bán hàng');
}

// Bắt buộc đóng gói .bin dạng thô, không nén lần hai trong APK — tránh sai lệch dữ liệu nhị phân.
const GRADLE = 'android/app/build.gradle';
if (fs.existsSync(GRADLE)) {
  let g = fs.readFileSync(GRADLE, 'utf8');
  if (!g.includes("noCompress")) {
    g = g.replace(/android\s*{/, `android {\n    aaptOptions { noCompress "bin" }`);
    fs.writeFileSync(GRADLE, g);
    console.log('✔ build.gradle: catalog.bin đóng gói dạng thô (noCompress)');
  }
}
