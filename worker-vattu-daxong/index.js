/**
 * Cổng trung gian giữ khóa Gemini.
 *
 * Vì sao cần: khóa EXPO_PUBLIC_* bị đóng gói thẳng vào file APK. Bất kỳ ai
 * tải app về, giải nén ra là lấy được khóa và tiêu tiền của chủ app.
 *
 * Cổng này giữ khóa ở phía máy chủ, và CHỈ phục vụ tài khoản đã đăng nhập
 * VÀ đã được người quản trị duyệt.
 *
 * Hai chế độ:
 *   che_do = 'vat_tu'   → ảnh một món hàng → { ten, danhMuc }
 *   che_do = 'chung_tu' → ảnh tờ giấy      → { loaiPhieu, dong: [...] }
 *
 * Triển khai:
 *   wrangler kv namespace create NHIP_DO     → dán id vào wrangler.toml
 *   wrangler secret put GEMINI_API_KEY
 *   wrangler secret put SUPABASE_URL
 *   wrangler secret put SUPABASE_ANON_KEY
 *   wrangler deploy
 */

const MODEL = 'gemini-3.1-flash-lite';
const GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const DANH_MUC = ['điện', 'nước', 'công cụ', 'khác'];

// Ảnh một món chụp ở quality 0.5 cỡ vài trăm KB; ảnh chứng từ nét hơn nên
// rộng tay hơn. Chặn ở đây để không ai nhét file khổng lồ cho tốn token.
const TOI_DA = { vat_tu: 6 * 1024 * 1024, chung_tu: 10 * 1024 * 1024 };

// Số lượt mỗi tài khoản. Đọc chứng từ tốn token gấp mấy lần nên tính 3 lượt.
const HAN_GIO = 60;
const HAN_NGAY = 400;
const GIA_LUOT = { vat_tu: 1, chung_tu: 3 };

const HAN_GIO_GEMINI = { vat_tu: 25000, chung_tu: 70000 };

// Thử tối đa bấy nhiêu khóa trong một lượt gọi. Để cao hơn thì người dùng
// ngồi chờ quá lâu trước khi được báo hỏng.
const TOI_DA_THU = 4;

/* ------------------------------------------------------------------ */
/*  Bể khóa Gemini                                                     */
/*                                                                     */
/*  Nạp nhiều khóa cách nhau bằng dấu phẩy:                            */
/*    wrangler secret put GEMINI_API_KEYS                              */
/*    → AIza...1,AIza...2,AIza...3                                     */
/*                                                                     */
/*  GEMINI_API_KEY cũ vẫn dùng được, nó được gộp vào cuối danh sách.   */
/*                                                                     */
/*  LƯU Ý: hạn mức miễn phí của Google tính theo PROJECT, không theo   */
/*  khóa. Mười khóa trong cùng một project dùng chung một hạn mức —    */
/*  xoay vòng không được gì. Muốn có tác dụng thì mỗi khóa phải thuộc  */
/*  một project riêng.                                                 */
/* ------------------------------------------------------------------ */
const layKhoa = (env) => [...new Set(
  [env.GEMINI_API_KEYS, env.GEMINI_API_KEY]
    .filter(Boolean).join(',')
    .split(/[,\s]+/).map((k) => k.trim()).filter(Boolean)
)];

/** Khóa nào đang bị cho nghỉ thì bỏ qua, khỏi tốn một lượt gọi vô ích. */
async function dangNghi(env, i) {
  if (!env.NHIP_DO) return false;
  return (await env.NHIP_DO.get(`khoa:${i}`)) !== null;
}

/**
 * Cho một khóa nghỉ.
 *
 * Hết hạn mức theo phút thì nghỉ ngắn, hết theo ngày thì nghỉ tới sáng mai,
 * còn khóa hỏng hẳn thì nghỉ một ngày và ghi log để người quản trị biết mà
 * thay. KV không cho hạn dưới 60 giây.
 */
async function chonNghi(env, i, giay, lyDo) {
  console.log(`Khóa #${i + 1} nghỉ ${giay}s: ${lyDo}`);
  if (!env.NHIP_DO) return;
  await env.NHIP_DO.put(`khoa:${i}`, lyDo, { expirationTtl: Math.max(60, giay) });
}

/** Số giây còn lại tới 0h theo giờ Thái Bình Dương — mốc Google reset hạn ngày. */
const toiSangMai = () => {
  const now = new Date();
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const mai = new Date(pt);
  mai.setHours(24, 0, 5, 0);
  return Math.max(60, Math.round((mai - pt) / 1000));
};

/**
 * Gọi Gemini, tự đổi khóa khi khóa đang dùng bị chặn.
 *
 * Đổi khóa CHỈ khi lỗi thuộc về khóa: hết hạn mức (429) hoặc khóa sai (400,
 * 403). Model bị tắt hay máy chủ Google trục trặc thì đổi bao nhiêu khóa
 * cũng vô ích, dừng luôn cho nhanh.
 */
async function goiGemini(env, than, cheDo, colo = '?') {
  const ds = layKhoa(env);
  if (!ds.length) return { ma: 500, loi: 'Chưa nạp khóa Gemini vào Worker.' };

  // Bắt đầu từ một vị trí xoay theo thời gian để tải rải đều trên các khóa,
  // thay vì khóa đầu tiên lúc nào cũng gánh hết rồi chết trước.
  const batDau = Math.floor(Date.now() / 1000) % ds.length;
  const hetGio = Date.now() + HAN_GIO_GEMINI[cheDo];
  let daThu = 0;
  let cuoiCung = null;

  for (let k = 0; k < ds.length && daThu < TOI_DA_THU; k++) {
    const i = (batDau + k) % ds.length;
    if (await dangNghi(env, i)) continue;

    const conLai = hetGio - Date.now();
    if (conLai < 5000) break;   // không đủ giờ cho một lượt tử tế nữa

    daThu += 1;
    const bo = new AbortController();
    const dongHo = setTimeout(() => bo.abort(), conLai);
    let res;
    try {
      res = await goiQuaTram(env, ds[i], than, bo.signal);
    } catch (e) {
      clearTimeout(dongHo);
      if (e?.name === 'AbortError')
        return { ma: 504, loi: 'Đọc lâu quá nên đã dừng. Phiếu dài thì chụp làm hai lần, mỗi lần nửa tờ.' };
      cuoiCung = { ma: 502, loi: 'Không gọi được Gemini. Thử lại sau.' };
      continue;   // mạng chập chờn — thử khóa khác cũng là thử lại
    } finally {
      clearTimeout(dongHo);
    }

    if (res.ok) return { res, khoa: i + 1 };

    const chiTiet = await res.text().catch(() => '');
    console.log(`Gemini ${res.status} (khóa #${i + 1}, colo ${colo}): ${chiTiet.slice(0, 300)}`);

    if (res.status === 429) {
      // Hết theo ngày thì nghỉ tới sáng mai, hết theo phút thì nghỉ một phút.
      const theoNgay = /PerDay|per day|daily/i.test(chiTiet);
      await chonNghi(env, i, theoNgay ? toiSangMai() : 60,
        theoNgay ? 'hết hạn mức ngày' : 'hết hạn mức phút');
      cuoiCung = { ma: 429, loi: 'Hết lượt nhận diện. Chờ ít phút rồi thử lại.' };
      continue;
    }

    if (res.status === 400 || res.status === 403) {
      if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|SERVICE_DISABLED/i.test(chiTiet)) {
        await chonNghi(env, i, 86400, 'khóa hỏng hoặc chưa bật Generative Language API');
        cuoiCung = { ma: 502, loi: 'Nhận diện thất bại. Nhập tên hàng bằng tay.' };
        continue;
      }

      // "User location is not supported" — Google chặn theo VỊ TRÍ MÁY CHỦ
      // đang gọi, không liên quan gì tới khóa. Đổi khóa vô ích vì khóa nào
      // cũng gọi từ đúng cái máy chủ đó.
      //
      // Tuyệt đối KHÔNG đem khóa đi nghỉ ở nhánh này: một lần trục trặc vùng
      // sẽ khóa sạch cả bể suốt 24 giờ trong khi khóa hoàn toàn lành lặn.
      if (/FAILED_PRECONDITION|location is not supported|not available in your country/i.test(chiTiet)) {
        console.log(`CHẶN KHU VỰC tại colo ${colo}. Không phải lỗi khóa.`
          + (env.TRAM ? ' Trạm Mỹ ĐANG BẬT mà vẫn bị chặn — báo lại để tìm cách khác.'
                      : ' Chưa bật trạm Mỹ: khai durable_objects trong wrangler.toml rồi deploy lại.'));
        return {
          ma: 502,
          loi: 'Máy chủ nhận diện đang bị Google chặn theo khu vực. Báo người quản trị.',
        };
      }

      // Model không hiểu trường thinkingConfig. Báo ngược lên để gọi lại
      // ngay, chứ đừng bắt người bán chụp lại tấm ảnh.
      if (/thinking|thinkingConfig|Unknown name|Invalid JSON payload/i.test(chiTiet))
        return { ma: 502, loi: 'Nhận diện thất bại. Nhập tên hàng bằng tay.', thinkingHong: true };

      // 400 vì ảnh hoặc yêu cầu sai — đổi khóa cũng thế
      return { ma: 502, loi: 'Nhận diện thất bại. Nhập tên hàng bằng tay.' };
    }

    if (res.status === 404)
      return { ma: 502, loi: 'Model đã bị Google tắt. Báo người quản trị đổi MODEL.' };

    cuoiCung = { ma: 502, loi: 'Nhận diện thất bại. Nhập tên hàng bằng tay.' };
  }

  return cuoiCung ?? { ma: 429, loi: 'Tất cả khóa đều đang hết lượt. Chờ ít phút rồi thử lại.' };
}

const PROMPT_VAT_TU = `Hãy nhận diện vật tư điện nước trong hình, trả về JSON gồm: tên sản phẩm ngắn gọn, danh mục (điện, nước, công cụ, khác).

Quy tắc:
- "ten": tên tiếng Việt như người bán vật tư hay gọi, tối đa 8 từ. Ghi kèm quy cách nếu nhìn rõ trên sản phẩm (ví dụ: "Ống nhựa PVC phi 27", "Dây điện Cadivi 2x1.5", "Aptomat 2P 32A").
- "danhMuc": chọn đúng một trong: điện, nước, công cụ, khác.
- Không thấy vật tư nào hoặc ảnh quá mờ: "ten" để chuỗi rỗng, "danhMuc" là "khác".
- Chỉ trả JSON, không giải thích thêm.`;

const PROMPT_CHUNG_TU = `Đọc chứng từ vật tư điện nước trong hình và trả về JSON.

BƯỚC 1 — Xác định loại chứng từ, ghi vào "loaiPhieu":
- "hoa_don": hóa đơn, phiếu tính tiền, phiếu thanh toán, phiếu giao hàng, phiếu xuất kho, hoặc đơn hàng viết tay. Dấu hiệu: CÓ cột hoặc con số chỉ SỐ LƯỢNG từng mặt hàng.
- "bang_gia": bảng giá, báo giá, biểu giá. Dấu hiệu: có đơn giá cho từng mặt hàng nhưng KHÔNG có số lượng.
- "khac": ảnh mờ, không phải chứng từ hàng hóa, hoặc không đọc được. Khi đó "dong" là mảng rỗng.

BƯỚC 2 — Đọc từng dòng hàng vào "dong".

"ten" — phải đủ để một mình cái tên đó xác định được mặt hàng:
- Ghép cột Tên và cột Quy cách thành một chuỗi.
- Nếu trong dòng chỉ ghi quy cách mà chủng loại nằm ở tiêu đề chứng từ thì lấy chủng loại từ tiêu đề xuống. Ví dụ tiêu đề "BẢNG GIÁ ỐNG NHỰA PVC-U", dòng ghi "Ø 21" và quy cách "21 x 1,3mm" thì "ten" là "Ống nhựa PVC-U Ø21 x 1,3mm".
- Ô gộp trải nhiều dòng: lặp lại tên đó cho từng dòng con, mỗi quy cách một phần tử riêng.
- Bỏ số thứ tự và mã hàng ra khỏi tên. Tối đa 12 từ.

"soLuong":
- Lấy đúng con số ở cột số lượng.
- loaiPhieu là "bang_gia": để 0.
- Có cột số lượng nhưng ô đó trống hoặc không đọc nổi: để 1.

"donGia" — giá của MỘT đơn vị, không phải thành tiền:
- Có nhiều cột giá (ví dụ "Chưa thuế" và "Thanh toán", hoặc "Đơn giá" và "Sau VAT"): lấy cột SỐ TIỀN THỰC TRẢ, tức cột đã gồm thuế, thường là cột cuối.
- Chỉ ghi thành tiền: lấy thành tiền chia số lượng.
- Không có giá: để 0.
- Tiền Việt dùng dấu chấm ngăn nghìn: "1.250.000" nghĩa là 1250000. Trả số thuần, không dấu chấm, không chữ "đ".

"donVi": cái, mét, cây, bộ, kg, cuộn... Lấy được từ tiêu đề cột cũng được, ví dụ "Đơn giá (đồng/mét)" thì đơn vị là "mét". Không có thì để chuỗi rỗng.

"danhMuc": chọn đúng một trong: điện, nước, công cụ, khác.

BƯỚC 3 — Những thứ phải bỏ qua: dòng tổng cộng, cộng thành tiền, thuế VAT, chiết khấu, tiền công, phí vận chuyển, tạm ứng, ghi chú, chữ ký.

Chữ viết tay: đọc thật kỹ chữ số. Con số nào không chắc thì để 0 và giữ nguyên tên hàng — người bán sẽ tự điền, còn đoán bừa một con số sai thì họ không phát hiện ra.

Chỉ trả JSON, không giải thích thêm.`;

const SCHEMA_VAT_TU = {
  type: 'OBJECT',
  properties: {
    ten: { type: 'STRING' },
    danhMuc: { type: 'STRING', enum: DANH_MUC },
  },
  required: ['ten', 'danhMuc'],
};

const SCHEMA_CHUNG_TU = {
  type: 'OBJECT',
  properties: {
    loaiPhieu: { type: 'STRING', enum: ['hoa_don', 'bang_gia', 'khac'] },
    dong: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          ten: { type: 'STRING' },
          danhMuc: { type: 'STRING', enum: DANH_MUC },
          soLuong: { type: 'NUMBER' },
          donGia: { type: 'NUMBER' },
          donVi: { type: 'STRING' },
        },
        required: ['ten', 'danhMuc', 'soLuong', 'donGia'],
      },
    },
  },
  required: ['loaiPhieu', 'dong'],
};


/* ==================================================================
 *  TRẠM MỸ — ép lượt gọi Gemini đi ra từ Bắc Mỹ
 *
 *  Bệnh: Cloudflare chạy Worker ở trung tâm dữ liệu gần người dùng nhất.
 *  Người dùng ở Việt Nam thì hay rơi vào colo HKG (Hồng Kông), mà Gemini
 *  không phục vụ Hồng Kông — Google trả về "User location is not supported".
 *  Đổi khóa vô ích vì khóa nào cũng đi ra từ đúng cái máy chủ đó.
 *
 *  Cách chữa: Durable Object nhận được "gợi ý vị trí" lúc tạo, và nó nằm
 *  lì ở đó. Đặt nó ở wnam (miền tây Bắc Mỹ) rồi cho nó gọi Gemini hộ —
 *  lượt gọi đi ra từ Mỹ, vùng Google phục vụ bình thường.
 *
 *  Khác Smart Placement ở chỗ: cái kia là gợi ý, Cloudflare tự cân nhắc
 *  và cần thời gian học. Cái này là ép cứng, có hiệu lực ngay.
 * ================================================================== */
/**
 * Đặt trạm ở đâu. Cloudflare nhận diện trạm theo TÊN, nên tên đã gắn sẵn
 * vị trí — đổi hằng số này là tự động sinh trạm mới ở vùng mới, khỏi lo
 * dính lại trạm cũ.
 *
 *   'wnam' miền tây Bắc Mỹ — chắc chắn Google phục vụ, nhưng xa Việt Nam.
 *   'apac' châu Á TBD      — nhanh hơn nhiều NẾU rơi vào Singapore hoặc
 *                            Tokyo; rơi vào Hồng Kông thì lại bị chặn.
 *   'oc'   châu Đại Dương  — Sydney, được phục vụ, gần hơn Mỹ một chút.
 *
 * Đang để 'wnam' vì chắc ăn. Muốn nhanh hơn thì thử 'apac' — chạy được
 * thì giữ, gặp lại lỗi CHẶN KHU VỰC thì đổi về 'wnam', mất 30 giây.
 */
const VI_TRI_TRAM = 'wnam';

export class TramMy {
  async fetch(request) {
    const khoa = request.headers.get('x-khoa') ?? '';
    const dich = request.headers.get('x-dich') ?? '';
    const than = await request.text();

    const res = await fetch(dich, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': khoa },
      body: than,
    });

    return new Response(await res.text(), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Gọi Gemini — qua trạm Mỹ nếu có, không thì gọi thẳng.
 *
 * Chưa khai Durable Object trong wrangler.toml thì env.TRAM không tồn tại
 * và hàm này tự lui về cách gọi cũ. App vẫn chạy, chỉ là dính lại lỗi khu vực.
 */
function goiQuaTram(env, khoa, than, signal) {
  if (!env.TRAM) {
    return fetch(GEMINI, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': khoa },
      body: than,
    });
  }

  const id = env.TRAM.idFromName(`gemini-${VI_TRI_TRAM}`);
  const tram = env.TRAM.get(id, { locationHint: VI_TRI_TRAM });

  return tram.fetch('https://tram.noi-bo/goi', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-khoa': khoa, 'x-dich': GEMINI },
    body: than,
  });
}

// Mã 101/204/205/304 KHÔNG được phép có body — chuẩn Fetch chặn, Cloudflare
// ném lỗi ngay. json({}, 204) trước đây gửi body "{}" kèm status 204 nên vỡ
// ngay từ bước OPTIONS — mọi lượt gọi từ trình duyệt đều gãy tại đây trước
// khi tới được phần logic bên dưới.
const KHONG_DUOC_CO_BODY = new Set([101, 204, 205, 304]);
const json = (data, status = 200) =>
  new Response(KHONG_DUOC_CO_BODY.has(status) ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });

/**
 * Kiểm vé: hỏi thẳng bảng ho_so bằng chính token của người dùng.
 *
 * Một lượt gọi trả về hai câu trả lời: token còn sống không (sai token thì
 * Supabase trả 401), và tài khoản đã được duyệt chưa (RLS chỉ cho thấy đúng
 * dòng của người đó).
 */
/** Vé đã kiểm thì nhớ trong bấy nhiêu giây, khỏi hỏi Supabase lại. */
const NHO_VE = 90;

const bam = async (s) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
};

/**
 * Kiểm vé: token còn sống không, và tài khoản đã được duyệt chưa.
 *
 * Kết quả được nhớ 90 giây. Người bán chụp liên tiếp năm món thì chỉ lượt
 * đầu phải hỏi Supabase, bốn lượt sau đỡ được mỗi lượt vài trăm mili giây
 * — đứng trước mặt khách thì từng đó là thấy được.
 *
 * Cái giá: khóa một tài khoản thì chậm nhất 90 giây sau mới chặn được, chứ
 * không tức thì như trước. Đổi được, vì 90 giây không đủ để ai phá hoại
 * đáng kể, mà hạn mức theo giờ và theo ngày vẫn chặn song song.
 */
/** So sánh 2 chuỗi mà không để lộ qua thời gian xử lý (khác độ dài thì luôn coi là sai). */
function baiKhopKhoa(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let khac = 0;
  for (let i = 0; i < a.length; i++) khac |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return khac === 0;
}

async function kiemVe(token, env) {
  const khoaVe = env.NHIP_DO ? `ve:${await bam(token)}` : null;

  if (khoaVe) {
    const nho = await env.NHIP_DO.get(khoaVe);
    if (nho) {
      const [id, d] = nho.split('|');
      return { id, duyet: d === '1' };
    }
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ho_so?select=id,duyet`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;

  const ds = await res.json().catch(() => null);
  const ho = Array.isArray(ds) ? ds[0] : null;
  if (!ho?.id) return null;

  const ve = { id: ho.id, duyet: ho.duyet === true };

  // Chỉ nhớ vé hợp lệ. Vé bị từ chối thì lượt sau hỏi lại — vừa được duyệt
  // xong là dùng được ngay, không phải ngồi chờ hết hạn nhớ.
  if (khoaVe && ve.duyet)
    await env.NHIP_DO.put(khoaVe, `${ve.id}|1`, { expirationTtl: NHO_VE });

  return ve;
}

/** Đếm lượt dùng theo giờ và theo ngày. Không gắn KV thì bỏ qua, app vẫn chạy. */
async function quaHan(userId, gia, env) {
  if (!env.NHIP_DO) return null;

  const luc = new Date().toISOString();
  const kGio = `${userId}:g:${luc.slice(0, 13)}`;
  const kNgay = `${userId}:n:${luc.slice(0, 10)}`;

  const [gio, ngay] = await Promise.all([
    env.NHIP_DO.get(kGio),
    env.NHIP_DO.get(kNgay),
  ]);
  const dGio = Number(gio ?? 0);
  const dNgay = Number(ngay ?? 0);

  if (dGio + gia > HAN_GIO)
    return 'Dùng nhận diện quá nhiều trong một giờ. Nghỉ chút rồi thử lại.';
  if (dNgay + gia > HAN_NGAY)
    return 'Hết lượt nhận diện của hôm nay. Mai dùng tiếp, hoặc nhập tay.';

  await Promise.all([
    env.NHIP_DO.put(kGio, String(dGio + gia), { expirationTtl: 3900 }),
    env.NHIP_DO.put(kNgay, String(dNgay + gia), { expirationTtl: 90000 }),
  ]);
  return null;
}

const boRao = (s) =>
  s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

/** "1.250.000" → 1250000. Gemini thỉnh thoảng vẫn trả chuỗi dù schema là NUMBER. */
const so = (v) => {
  if (typeof v === 'number' && isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^\d]/g, ''));
  return isFinite(n) ? n : 0;
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({}, 204);
    if (request.method !== 'POST') return json({ loi: 'Chỉ nhận POST' }, 405);

    // --- 1. Kiểm vé ---
    //
    // Hai đường vào:
    //  a) App vật tư: Authorization: Bearer <JWT Supabase> — kiểm qua bảng ho_so như cũ.
    //  b) App khác dùng chung worker này (ví dụ app tạp hoá, project Supabase riêng,
    //     JWT của nó không xác minh được ở đây): X-App-Key: <khoá bí mật> — nếu khớp
    //     env.TAPHOA_KEY thì cho qua thẳng, không đụng tới Supabase/ho_so của project này.
    //     X-App-User (tuỳ chọn) chỉ dùng để TÁCH HẠN MỨC riêng cho từng quầy/người bán,
    //     không dùng để xác thực — ai cũng có thể tự đặt giá trị này, nên đừng tin nó
    //     cho việc phân quyền, chỉ dùng để đếm lượt cho công bằng giữa các quầy.
    let nguoi;
    const khoaApp = request.headers.get('X-App-Key') ?? '';

    if (env.TAPHOA_KEY && khoaApp && baiKhopKhoa(khoaApp, env.TAPHOA_KEY)) {
      const idKhach = (request.headers.get('X-App-User') || 'khach').slice(0, 80);
      nguoi = { id: 'taphoa:' + idKhach, duyet: true };
    } else {
      const auth = request.headers.get('Authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return json({ loi: 'Chưa đăng nhập' }, 401);

      nguoi = await kiemVe(token, env);
      if (!nguoi) return json({ loi: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại.' }, 401);
      if (!nguoi.duyet)
        return json({ loi: 'Tài khoản chưa được duyệt. Liên hệ người quản trị.' }, 403);
    }

    // --- 2. Đọc yêu cầu ---
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ loi: 'Dữ liệu gửi lên không đọc được' }, 400);
    }

    const { base64, mimeType } = body ?? {};
    // 'hoa_don' là tên cũ, vẫn nhận để bản app cũ trên máy khách không chết.
    const cheDo = (body?.che_do === 'chung_tu' || body?.che_do === 'hoa_don')
      ? 'chung_tu' : 'vat_tu';

    if (!base64 || typeof base64 !== 'string') return json({ loi: 'Thiếu ảnh' }, 400);
    if (base64.length > TOI_DA[cheDo]) return json({ loi: 'Ảnh quá lớn' }, 413);

    const chan = await quaHan(nguoi.id, GIA_LUOT[cheDo], env);
    if (chan) return json({ loi: chan }, 429);

    // --- 3. Gọi Gemini bằng khóa nằm ở đây, không nằm trong app ---
    const chungTu = cheDo === 'chung_tu';

    /**
     * Dựng thân yêu cầu.
     *
     * Nhận một món hàng là việc nhìn-rồi-gọi-tên, không cần model ngồi suy
     * luận. Tắt phần suy nghĩ cắt được kha khá thời gian chờ. Ngược lại,
     * đọc hóa đơn thì phải ghép cột, chia thành tiền cho số lượng, lần theo
     * ô gộp — để model suy nghĩ, chậm hơn nhưng đúng hơn, mà đúng mới là
     * thứ đáng tiền ở tờ hóa đơn.
     *
     * @param {boolean} suyNghi false = kèm thinkingBudget 0
     */
    const dungThan = (suyNghi) => JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: chungTu ? PROMPT_CHUNG_TU : PROMPT_VAT_TU },
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: chungTu ? SCHEMA_CHUNG_TU : SCHEMA_VAT_TU,
        maxOutputTokens: chungTu ? 8192 : 96,
        temperature: 0,
        ...(suyNghi ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      },
    });

    // Không phải model nào cũng nhận trường thinkingConfig. Lần đầu gặp từ
    // chối, ghi nhớ lại rồi từ đó thôi gửi — tự chữa, khỏi phải sửa code.
    const khoaTat = 'khong-ho-tro-thinking';
    const daBiTuChoi = env.NHIP_DO ? await env.NHIP_DO.get(khoaTat) : null;
    const tatSuyNghi = !chungTu && !daBiTuChoi;

    const than = dungThan(!tatSuyNghi);

    // colo = mã trung tâm dữ liệu Cloudflare đang chạy Worker này. Cần nó
    // để biết Google chặn ở đâu khi gặp lỗi khu vực.
    const colo = request.cf?.colo ?? '?';
    let goi = await goiGemini(env, than, cheDo, colo);

    if (!goi.res && tatSuyNghi && goi.thinkingHong) {
      console.log('Model không nhận thinkingConfig — ghi nhớ và gọi lại bình thường.');
      if (env.NHIP_DO) await env.NHIP_DO.put(khoaTat, '1', { expirationTtl: 2592000 });
      goi = await goiGemini(env, dungThan(true), cheDo, colo);
    }

    if (!goi.res) return json({ loi: goi.loi }, goi.ma);
    const res = goi.res;

    // --- 4. Bóc kết quả ---
    const data = await res.json();
    if (data?.promptFeedback?.blockReason)
      return json({ loi: 'Ảnh bị từ chối xử lý. Chụp lại ảnh khác.' }, 502);

    const chu = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '').join('').trim();
    if (!chu) return json({ loi: 'Không đọc được kết quả' }, 502);

    let kq;
    try {
      kq = JSON.parse(boRao(chu));
    } catch {
      return json({ loi: 'Kết quả trả về không hợp lệ' }, 502);
    }

    if (chungTu) {
      const dong = (Array.isArray(kq?.dong) ? kq.dong : [])
        .map((d) => ({
          ten: typeof d?.ten === 'string' ? d.ten.trim() : '',
          danhMuc: DANH_MUC.includes(d?.danhMuc) ? d.danhMuc : 'khác',
          // KHÔNG ép về 1. Số 0 là tin thật: bảng giá, hoặc chữ viết tay
          // không đọc nổi. Người bán cần thấy 0 để tự điền.
          soLuong: so(d?.soLuong),
          donGia: so(d?.donGia),
          donVi: typeof d?.donVi === 'string' ? d.donVi.trim() : '',
        }))
        .filter((d) => d.ten)
        .slice(0, 80);

      const loaiPhieu = ['hoa_don', 'bang_gia', 'khac'].includes(kq?.loaiPhieu)
        ? kq.loaiPhieu : 'khac';

      return json({ loaiPhieu, dong });
    }

    return json({
      ten: typeof kq?.ten === 'string' ? kq.ten.trim() : '',
      danhMuc: DANH_MUC.includes(kq?.danhMuc) ? kq.danhMuc : 'khác',
    });
  },
};
