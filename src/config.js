/* ═══ ĐIỀN SẴN Ở ĐÂY THÌ APP KHỎI HỎI KHI MỞ LẦN ĐẦU ═══
   Anon key của Supabase được thiết kế để công khai — an toàn vì schema đã bật RLS
   (đã kiểm: người ngoài quầy thấy 0 đơn, 0 mặt hàng, chèn/sửa đều bị chặn).
   Dù vậy vẫn nên để repo ở chế độ Private. */
export const CONFIG = {
  SUPABASE_URL: 'https://mwfewtxihccqphuebvln.supabase.co',            // project RIÊNG của app tạp hoá — https://xxxx.supabase.co
  SUPABASE_ANON_KEY: 'sb_publishable_e14eLiZvHOlrD3vHkDLnNQ_ItJi6TbS',       // eyJhbGciOi...

  // Cổng trung chuyển Gemini
  GEMINI_PROXY_URL: 'https://so-ban-hang-gemini.buivanut991.workers.dev',
  GEMINI_APP_KEY: 'efTUXntIuPCKtNV3a_1C6xCKGWz3K4Qn',          // PHẢI khớp với "TAPHOA_KEY" đã đặt trên worker

  // Đường dẫn tải danh mục hàng hoá từ xa (Cập nhật online không cần build lại APK)
  ONLINE_CATALOG_URL: 'https://raw.githubusercontent.com/timonblue113/taphoav9/main/public/catalog.bin',
};
