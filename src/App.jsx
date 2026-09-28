import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search, Camera, Plus, Minus, Trash2, X, Check, ScanLine, Settings, Package,
  ReceiptText, Wallet, BarChart3, Store, LogOut, Upload, Printer, RefreshCw,
  Sparkles, FileText, AlertTriangle, ChevronRight, Users, Loader2, CircleDollarSign,
  TrendingUp, Download, Pencil, CloudOff, Cloud, KeyRound, Database, LogIn, Scale,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { gunzipSync, strFromU8 } from 'fflate';
import { Preferences } from '@capacitor/preferences';

import {
  nf, money, moneyD, pad, dayKey, addDays, dowOf, shortDate, clock, weekStart,
  slug, uid, roundTo, monthKey, norm, deacc, Catalog,
} from './lib/util.js';
import { sb, loadConf, saveConf, getConf, confReady } from './lib/db.js';
import { useShop } from './lib/store.js';
import { aiReady, aiIdentifyPhoto, aiReadOrder, datDanhTinhAi, loadAiKey, saveAiKey } from './lib/ai.js';
import { ensureScanner, scanOnce, startContinuousScan, readFromImage, compressImage, fileToB64, isNative } from './lib/scan.js';
import { receiptText, escposBytes, printViaBrowser, printRawBT, btConnect, btWrite } from './lib/print.js';

const CATALOG_URL = 'catalog.bin';

/* ════════ DÙNG THỬ — 3 ngày miễn phí, sau đó yêu cầu kích hoạt ════════
   Khoá kích hoạt được tạo bằng: btoa(userId.slice(0,8) + ':SOTAY2025')
   Chủ app tính tay hoặc dùng script để cấp cho từng khách.
   ════════════════════════════════════════════════════════════════════════ */

const TRIAL_DAYS = 3;

/** Hỏi Supabase để lấy trạng thái giấy phép — không thể giả mạo vì chỉ admin
 *  (service_role) mới sửa được bảng licenses. Có cache 60s để không gọi mạng mỗi giây. */
let _licenseCache = null;
let _licenseCacheAt = 0;

async function checkTrial(userId) {
  // Cache 30 giây để tránh gọi mạng quá dồn dập
  if (_licenseCache && Date.now() - _licenseCacheAt < 30000) return _licenseCache;
  try {
    const { data, error } = await sb().rpc('my_license');
    if (error) throw error;
    const d = data || {};
    const daysUsed = Number(d.days_used) || 0;
    const activated = !!d.activated;
    const daysLeft = Math.max(0, Math.ceil(TRIAL_DAYS - daysUsed));
    const expired = !activated && (daysUsed >= TRIAL_DAYS || daysLeft <= 0);
    _licenseCache = { expired, daysLeft: expired ? 0 : daysLeft, activated, userId };
    _licenseCacheAt = Date.now();
    return _licenseCache;
  } catch {
    // Mất mạng: nếu đã có cache cũ thì dùng, không thì tạm thời cho qua (tránh khóa nhầm khi mất mạng)
    return _licenseCache || { expired: false, daysLeft: TRIAL_DAYS, activated: false, userId };
  }
}

/** Admin dùng Supabase Dashboard hoặc script để set activated=true.
 *  App chỉ cần gọi checkTrial() lại để lấy trạng thái mới. */
async function reloadLicense(userId) {
  _licenseCache = null; // xoá cache, lần sau sẽ hỏi lại Supabase
  return checkTrial(userId);
}

function TrialLockScreen({ info, onActivated, onSignOut, say }) {
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    const fresh = await reloadLicense(info.userId);
    if (fresh.activated || !fresh.expired) {
      say('Đã kích hoạt — mời vào!');
      onActivated();
    } else {
      say('Chưa thấy kích hoạt — liên hệ nhà phát triển.');
    }
    setBusy(false);
  };

  return (
    <div className="body" style={{ background: 'var(--chassis)' }}>
      <Brand sub="Hết thời gian dùng thử" />
      <div className="paperbox">
        <div className="banner err" style={{ marginBottom: 16 }}>
          <AlertTriangle size={18} />
          <div>
            Thời gian dùng thử <b>{TRIAL_DAYS} ngày</b> đã kết thúc.
            Vui lòng liên hệ nhà phát triển để được kích hoạt sử dụng chính thức.
          </div>
        </div>

        {/* Thẻ liên hệ nhà phát triển */}
        <div className="card pad" style={{ background: 'linear-gradient(135deg, #161A17, #242C26)', color: '#fff', border: 'none', marginBottom: 16 }}>
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 42, borderRadius: 12, background: 'var(--gold)', display: 'grid', placeItems: 'center', flex: 'none', color: '#1A2614', fontWeight: 800, fontSize: 19 }}>
              T
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>Hỗ trợ kích hoạt: Timon (ut)</div>
              <div className="num" style={{ fontWeight: 700, fontSize: 16, color: 'var(--gold)', marginTop: 2 }}>📞 0946 296 269</div>
            </div>
          </div>
          <div className="tiny" style={{ marginTop: 10, color: '#94A3B8', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
            Mã tài khoản (User ID) của bạn: <br />
            <b className="num" style={{ color: '#fff', fontSize: 13, wordBreak: 'break-all' }}>{info.userId || ''}</b>
          </div>
        </div>

        <div className="banner info" style={{ marginBottom: 16 }}>
          <Users size={17} />
          <div>
            Sau khi liên hệ kích hoạt xong, bấm nút bên dưới để kiểm tra và tiếp tục bán hàng.
          </div>
        </div>

        <button className="btn pay" style={{ width: '100%' }} disabled={busy} onClick={retry}>
          {busy ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />} Kiểm tra kích hoạt ngay
        </button>
        <button className="btn ghost sm2" style={{ width: '100%', marginTop: 12, color: 'var(--pay)', borderColor: '#F1B9C5' }} onClick={onSignOut}>
          <LogOut size={16} /> Thoát tài khoản
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════ GỐC ỨNG DỤNG ═══════════════════ */

export default function App() {
  const [phase, setPhase] = useState('boot');   // boot | setup | auth | shop | run | trial
  const [trialInfo, setTrialInfo] = useState(null); // { daysLeft, expired, activationCode }
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [toast, setToast] = useState('');
  const say = useCallback((m) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? '' : t)), 2600); }, []);

  useEffect(() => {
    (async () => {
      await loadAiKey();
      const c = await loadConf();
      if (!c.url || !c.anon) { setPhase('setup'); return; }
      try {
        const { data } = await sb().auth.getSession();
        if (data && data.session) {
          const u = data.session.user;
          setUser(u);
          // Kiểm tra dùng thử
          const info = await checkTrial(u.id);
          if (info.expired) { setTrialInfo(info); setPhase('trial'); }
          else setPhase('shop');
        }
        else setPhase('auth');
      } catch { setPhase('setup'); }
    })();
  }, []);

  const signOut = useCallback(async () => {
    try { await sb().auth.signOut(); } catch { /* bỏ qua */ }
    setSession(null); setUser(null); setPhase('auth');
  }, []);

  return (
    <div className="st">
      {phase === 'boot' && <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}><Loader2 className="spin" size={26} color="#6C7A70" /></div>}
      {phase === 'setup' && <SetupScreen onDone={() => setPhase('auth')} say={say} />}
      {phase === 'auth' && <AuthScreen onIn={async (u) => {
        setUser(u);
        const info = await checkTrial(u.id);
        if (info.expired) { setTrialInfo(info); setPhase('trial'); }
        else setPhase('shop');
      }} onBack={() => setPhase('setup')} say={say} />}
      {phase === 'shop' && <ShopPicker user={user} onIn={(s) => { setSession(s); setPhase('run'); }} onSignOut={signOut} say={say} />}
      {phase === 'trial' && trialInfo && <TrialLockScreen info={trialInfo} onActivated={() => { setTrialInfo(null); setPhase('shop'); }} onSignOut={signOut} say={say} />}
      {phase === 'run' && session && <Shell session={session} say={say} onExit={() => { setSession(null); setPhase('shop'); }} onSignOut={signOut} onLockTrial={(info) => { setTrialInfo(info); setPhase('trial'); }} />}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

/* ───────────── 1. Nối vào Supabase ───────────── */

function SetupScreen({ onDone, say }) {
  const c0 = getConf();
  const [url, setUrl] = useState(c0.url || '');
  const [anon, setAnon] = useState(c0.anon || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const test = async () => {
    setErr(''); setBusy(true);
    try {
      const u = url.trim().replace(/\/+$/, '');
      if (!/^https:\/\/.+\.supabase\.co$/.test(u)) throw new Error('Địa chỉ phải có dạng https://xxxx.supabase.co');
      if (anon.trim().length < 40) throw new Error('Khoá anon trông chưa đúng');
      await saveConf({ url: u, anon: anon.trim() });
      const { error } = await sb().from('shops').select('id').limit(1);
      if (error && error.code !== 'PGRST116' && !/permission|row-level/i.test(error.message || '')) throw new Error(error.message);
      say('Nối Supabase thành công');
      onDone();
    } catch (e) { setErr(e.message || 'Không nối được'); }
    setBusy(false);
  };

  return (
    <div className="body" style={{ background: 'var(--chassis)' }}>
      <Brand sub="Nối vào kho dữ liệu của bạn" />
      <div className="paperbox">
        {err ? <div className="banner err" style={{ marginBottom: 12 }}><AlertTriangle size={17} /><div>{err}</div></div> : null}
        <div className="banner info" style={{ marginBottom: 14 }}>
          <Database size={17} />
          <div>Vào supabase.com → dự án của bạn → <b>Settings → API</b>, chép <b>Project URL</b> và <b>anon public key</b> dán vào đây. Chỉ làm một lần.</div>
        </div>
        <div className="lab">Project URL</div>
        <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcdxyz.supabase.co" autoCapitalize="none" autoCorrect="off" />
        <div className="lab" style={{ marginTop: 12 }}>anon public key</div>
        <textarea className="field" style={{ height: 84, padding: 10, resize: 'none' }} value={anon}
          onChange={(e) => setAnon(e.target.value)} placeholder="eyJhbGciOi…" autoCapitalize="none" autoCorrect="off" />
        <button className="btn pay" style={{ width: '100%', marginTop: 14 }} disabled={busy} onClick={test}>
          {busy ? <Loader2 className="spin" size={18} /> : <Check size={18} />} Kiểm tra & lưu
        </button>
      </div>
    </div>
  );
}

const Brand = ({ sub }) => (
  <div style={{ padding: '38px 20px 20px', color: '#fff' }}>
    <div className="row" style={{ gap: 12 }}>
      <div style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--gold)', display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Store size={24} color="#221A00" />
      </div>
      <div>
        <div style={{ fontFamily: 'var(--disp)', fontSize: 26, fontWeight: 700, letterSpacing: '.02em', lineHeight: 1, textTransform: 'uppercase' }}>Sổ tay bán hàng</div>
        <div className="tiny" style={{ color: '#8F9C8E', marginTop: 5 }}>{sub}</div>
      </div>
    </div>
  </div>
);

/* ───────────── 2. Đăng nhập tài khoản ───────────── */

function AuthScreen({ onIn, onBack, say }) {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { (async () => {
    const { value } = await Preferences.get({ key: 'last.email' });
    if (value) setEmail(value);
  })(); }, []);

  const go = async () => {
    setErr(''); setBusy(true);
    try {
      const c = sb();
      const cred = { email: email.trim().toLowerCase(), password: pw };
      if (!cred.email.includes('@')) throw new Error('Email chưa đúng');
      if (pw.length < 6) throw new Error('Mật khẩu cần ít nhất 6 ký tự');
      const { data, error } = mode === 'in' ? await c.auth.signInWithPassword(cred) : await c.auth.signUp(cred);
      if (error) throw new Error(
        /Invalid login/i.test(error.message) ? 'Sai email hoặc mật khẩu'
        : /already registered|already exists/i.test(error.message) ? 'Email này đã có tài khoản — chọn Đăng nhập'
        : /email not confirmed/i.test(error.message) ? 'Tài khoản chưa xác nhận email. Vào Supabase → Authentication → Providers → Email → tắt "Confirm email" rồi thử lại.'
        : error.message);
      if (!data.session) {
        // Dự án đang bật "Confirm email" → client không thể vượt qua bước xác nhận.
        // Thử đăng nhập lại phòng khi máy chủ vừa xác nhận tức thì (một số cấu hình cho phép).
        const retry = await c.auth.signInWithPassword(cred);
        if (retry.data && retry.data.session) { onIn(retry.data.session.user); setBusy(false); return; }
        throw new Error('Dự án Supabase đang bắt xác nhận email trước khi vào. Cách vào ngay không cần mở hộp thư: vào Supabase → Authentication → Providers → Email → tắt "Confirm email" → Save, rồi bấm Tạo tài khoản lại.');
      }
      await Preferences.set({ key: 'last.email', value: cred.email });
      onIn(data.session.user);
    } catch (e) { setErr(e.message || 'Không đăng nhập được'); }
    setBusy(false);
  };

  return (
    <div className="body" style={{ background: 'var(--chassis)' }}>
      <Brand sub={mode === 'in' ? 'Đăng nhập để mở sổ' : 'Tạo tài khoản mới'} />
      <div className="paperbox">
        {err ? <div className="banner err" style={{ marginBottom: 12 }}><AlertTriangle size={17} /><div>{err}</div></div> : null}
        <div className="chips" style={{ marginBottom: 14 }}>
          <button className={'chip' + (mode === 'in' ? ' on' : '')} onClick={() => { setMode('in'); setErr(''); }}>Đăng nhập</button>
          <button className={'chip' + (mode === 'up' ? ' on' : '')} onClick={() => { setMode('up'); setErr(''); }}>Tạo tài khoản</button>
        </div>
        <div className="lab">Email</div>
        <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="banhang@gmail.com" />
        <div className="lab" style={{ marginTop: 12 }}>Mật khẩu</div>
        <input className="field" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••" />
        <button className="btn pay" style={{ width: '100%', marginTop: 14 }} disabled={busy} onClick={go}>
          {busy ? <Loader2 className="spin" size={18} /> : <LogIn size={18} />} {mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}
        </button>
        <div className="banner info" style={{ marginTop: 14 }}>
          <Users size={17} />
          <div>Hai người bán cùng lúc thì <b>cùng đăng nhập một tài khoản này</b> trên hai máy, rồi mỗi người chọn tên riêng ở bước sau.</div>
        </div>
        <button className="btn ghost sm2" style={{ width: '100%', marginTop: 12 }} onClick={onBack}>Đổi kho dữ liệu Supabase</button>
      </div>
    </div>
  );
}

/* ───────────── 3. Chọn quầy + tên người bán ───────────── */

function ShopPicker({ user, onIn, onSignOut, say }) {
  const [shops, setShops] = useState(null);
  const [mode, setMode] = useState('list');
  const [seller, setSeller] = useState('');
  const [pick, setPick] = useState(null);
  const [nName, setNName] = useState('');
  const [nPin, setNPin] = useState('');
  const [jCode, setJCode] = useState('');
  const [jPin, setJPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { (async () => {
    const { value } = await Preferences.get({ key: 'seller.name' });
    if (value) setSeller(value);
    try {
      const { data, error } = await sb().from('shops').select('*').order('created_at');
      if (error) throw error;
      setShops(data || []);
      if ((data || []).length === 1) setPick(data[0]);
      if (!(data || []).length) setMode('new');
    } catch (e) { setErr(e.message || 'Không tải được danh sách quầy'); setShops([]); }
  })(); }, []);

  const enter = async (s) => {
    const nm = seller.trim();
    if (!nm) { setErr('Nhập tên người bán ca này'); return; }
    await Preferences.set({ key: 'seller.name', value: nm });
    onIn({ shop: s, seller: nm, user });
  };

  const create = async () => {
    setErr(''); setBusy(true);
    try {
      if (nName.trim().length < 2) throw new Error('Đặt tên quầy đã');
      if (nPin.length < 4) throw new Error('PIN cần ít nhất 4 số');
      if (!seller.trim()) throw new Error('Nhập tên người bán');
      const { data, error } = await sb().rpc('create_shop', { p_name: nName.trim(), p_pin: nPin, p_seller: seller.trim() });
      if (error) throw new Error(error.message);
      const s = Array.isArray(data) ? data[0] : data;
      say('Đã mở quầy ' + s.name);
      await enter(s);
    } catch (e) { setErr(e.message || 'Không mở được quầy'); }
    setBusy(false);
  };

  const join = async () => {
    setErr(''); setBusy(true);
    try {
      if (!seller.trim()) throw new Error('Nhập tên người bán');
      const { data, error } = await sb().rpc('join_shop', { p_code: jCode.trim().toLowerCase(), p_pin: jPin, p_seller: seller.trim() });
      if (error) throw new Error(error.message);
      const s = Array.isArray(data) ? data[0] : data;
      await enter(s);
    } catch (e) { setErr(e.message || 'Không vào được quầy'); }
    setBusy(false);
  };

  return (
    <div className="body" style={{ background: 'var(--chassis)' }}>
      <Brand sub={user ? user.email : ''} />
      <div className="paperbox">
        {err ? <div className="banner err" style={{ marginBottom: 12 }}><AlertTriangle size={17} /><div>{err}</div></div> : null}

        <div className="lab">Ai đang bán ca này?</div>
        <input className="field" value={seller} onChange={(e) => { setSeller(e.target.value); setErr(''); }} placeholder="Hương" />
        <div className="tiny muted" style={{ margin: '6px 3px 0' }}>Hai máy phải đặt <b>tên khác nhau</b> để biết đơn của ai.</div>

        {shops === null && <div className="row" style={{ marginTop: 18, gap: 10 }}><Loader2 size={18} className="spin" /><span className="sm">Đang tìm quầy…</span></div>}

        {mode === 'list' && shops && shops.length > 0 && (
          <>
            <div className="eyebrow">Quầy của bạn</div>
            <div className="card">
              {shops.map((s) => (
                <button key={s.id} className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => { setPick(s); enter(s); }}>
                  <Store size={18} className="muted" />
                  <div style={{ flex: 1 }}><div className="nm">{s.name}</div><div className="mt num">{s.join_code}</div></div>
                  <ChevronRight size={18} className="muted" />
                </button>
              ))}
            </div>
            <div className="split" style={{ marginTop: 12 }}>
              <button className="btn ghost sm2" style={{ height: 44 }} onClick={() => { setMode('new'); setErr(''); }}><Plus size={16} /> Quầy mới</button>
              <button className="btn ghost sm2" style={{ height: 44 }} onClick={() => { setMode('join'); setErr(''); }}><KeyRound size={16} /> Vào quầy có sẵn</button>
            </div>
          </>
        )}

        {mode === 'new' && (
          <>
            <div className="eyebrow">Mở quầy mới</div>
            <div className="lab">Tên cửa hàng</div>
            <input className="field" value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Tạp hoá Ba Xuân" />
            <div className="lab" style={{ marginTop: 12 }}>Đặt PIN mời (4–6 số)</div>
            <input className="field num" value={nPin} inputMode="numeric" onChange={(e) => setNPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••" />
            <div className="tiny muted" style={{ margin: '6px 3px 0' }}>PIN dùng khi mời máy khác vào quầy bằng tài khoản riêng.</div>
            <button className="btn pay" style={{ width: '100%', marginTop: 14 }} disabled={busy} onClick={create}>
              {busy ? <Loader2 className="spin" size={18} /> : <Plus size={18} />} Mở quầy
            </button>
            {shops && shops.length > 0 ? <button className="btn ghost sm2" style={{ width: '100%', marginTop: 8 }} onClick={() => setMode('list')}>Quay lại</button> : null}
          </>
        )}

        {mode === 'join' && (
          <>
            <div className="eyebrow">Vào quầy có sẵn</div>
            <div className="lab">Mã mời</div>
            <input className="field" value={jCode} onChange={(e) => setJCode(e.target.value)} autoCapitalize="none" placeholder="tphobaxun8afe" />
            <div className="lab" style={{ marginTop: 12 }}>PIN</div>
            <input className="field num" value={jPin} inputMode="numeric" onChange={(e) => setJPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••" />
            <button className="btn pay" style={{ width: '100%', marginTop: 14 }} disabled={busy} onClick={join}>
              {busy ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />} Vào quầy
            </button>
            <button className="btn ghost sm2" style={{ width: '100%', marginTop: 8 }} onClick={() => setMode(shops && shops.length ? 'list' : 'new')}>Quay lại</button>
          </>
        )}

        <button className="btn ghost sm2" style={{ width: '100%', marginTop: 16, color: 'var(--pay)', borderColor: '#F1B9C5' }} onClick={onSignOut}>
          <LogOut size={16} /> Thoát tài khoản
        </button>
      </div>
    </div>
  );
}


/* ---- mảnh giao diện dùng lại ---- */

const Sheet = ({ open, onClose, title, icon, children, footer, wide }) => {
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" style={wide ? { maxHeight: '96%' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sh">
          {icon}
          <div style={{ flex: 1, fontWeight: 700, fontSize: 15.5 }}>{title}</div>
          <button className="iconbtn" style={{ background: '#EFF2EC', color: 'var(--ink)' }} onClick={onClose}><X size={19} /></button>
        </div>
        <div className="sb">{children}</div>
        {footer ? <div className="sf">{footer}</div> : null}
      </div>
    </div>
  );
};

const NumPad = ({ value, onChange, onOk, okLabel = 'Xong', quick = [], hideOk = false }) => {
  const tap = (k) => {
    if (k === 'del') onChange(String(value).slice(0, -1));
    else if (k === 'c') onChange('');
    else if (k === '000') onChange((String(value) + '000').replace(/^0+(?=\d)/, '').slice(0, 12));
    else onChange((String(value) + k).replace(/^0+(?=\d)/, '').slice(0, 12));
    if (navigator.vibrate) navigator.vibrate(8);
  };
  return (
    <div>
      {quick.length > 0 && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {quick.map((q, i) => (
            <button key={q.v + '·' + i} className="chip" onClick={() => onChange(String(q.v))}>{q.t}</button>
          ))}
        </div>
      )}
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del'].map((k) => (
          <button key={k} className="key" onClick={() => tap(k)}>
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>
      {!hideOk && <button className="btn pay" style={{ width: '100%', marginTop: 10 }} onClick={onOk}>{okLabel}</button>}
    </div>
  );
};

/* ───────────── khung chính ───────────── */

function Shell({ session, onExit, say, onSignOut, onLockTrial }) {
  const shop = useShop(session);
  const { ME, meta, products } = shop;

  // Đặt danh tính cho các lượt gọi AI — chỉ để tách hạn mức riêng theo quầy,
  // không dùng để xác thực (xem ghi chú trong src/lib/ai.js).
  useEffect(() => { datDanhTinhAi(shop.meta ? shop.meta.join_code : session.shop.join_code, ME); }, [shop.meta, session, ME]);

  const catRef = useRef(null);
  const [cat, setCat] = useState({ ready: false, count: 0, loading: true, progress: 0, note: 'Đang mở danh mục…' });
  const [tab, setTab] = useState('sell');
  const [cart, setCart] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState(null);

  const shopMeta = meta || session.shop;

  // Kiểm tra thời hạn dùng thử liên tục — nếu hết 3 ngày thì khoá ngay lập tức!
  useEffect(() => {
    if (!session || !session.user) return;
    const verify = async () => {
      try {
        const info = await checkTrial(session.user.id);
        if (info.expired) {
          if (onLockTrial) onLockTrial(info);
        } else {
          setTrialDaysLeft(info.daysLeft);
        }
      } catch { /* bỏ qua */ }
    };
    verify();
    const timer = setInterval(verify, 30000); // Tự động kiểm tra lại mỗi 30 giây
    return () => clearInterval(timer);
  }, [session, onLockTrial]);

  /* Danh mục 153k mã đóng gói sẵn trong app — mở là dùng, không cần mạng */
  /** Đọc bytes rồi mới quyết định có cần giải nén hay không — một số WebView Android
   *  tự giải nén sẵn các asset .gz khi đóng gói APK, gunzip lần hai sẽ hỏng dữ liệu. */
  const bytesToText = (buf, name) => {
    const u8 = new Uint8Array(buf);
    const isGzip = u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
    if (isGzip) return strFromU8(gunzipSync(u8));
    if (name && /\.gz$/i.test(name)) throw new Error('tệp .gz nhưng không đọc được — có thể tệp hỏng khi tải xuống');
    return new TextDecoder('utf-8').decode(u8);
  };

  const loadCatalog = useCallback(async (file) => {
    setCat({ ready: false, count: 0, loading: true, progress: 10, note: 'Đang mở danh mục…' });
    try {
      let text = '';
      if (file) {
        text = bytesToText(await file.arrayBuffer(), file.name);
      } else {
        const tryUrls = [CATALOG_URL, './' + CATALOG_URL, '/' + CATALOG_URL];
        let r = null, lastErr = '';
        for (const u of tryUrls) {
          try { const res = await fetch(u); if (res.ok) { r = res; break; } lastErr = 'HTTP ' + res.status; }
          catch (e) { lastErr = e.message; }
        }
        if (!r) throw new Error('không thấy tệp danh mục trong app (' + lastErr + ')');
        setCat((c) => ({ ...c, progress: 55, note: 'Đang giải nén…' }));
        text = bytesToText(await r.arrayBuffer(), CATALOG_URL);
      }
      if (!text || text.length < 20) throw new Error('tệp rỗng hoặc đọc sai định dạng');
      setCat((c) => ({ ...c, progress: 85, note: 'Đang dựng chỉ mục…' }));
      const c = new Catalog(text);
      if (c.count < 1) throw new Error('không đọc được dòng nào trong danh mục');
      catRef.current = c;
      setCat({ ready: true, count: c.count, loading: false, progress: 100, note: '' });
      if (file) say(`Đã nạp ${nf.format(c.count)} mã hàng`);
    } catch (e) {
      setCat({ ready: false, count: 0, loading: false, progress: 0, note: 'Không mở được danh mục: ' + (e.message || '') });
    }
  }, [say]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  /* ---- giỏ hàng ---- */
  const addToCart = useCallback((p, qty = 1) => {
    setCart((c) => {
      const i = c.findIndex((x) => x.code === p.code && x.price === p.price);
      if (i >= 0) { const n = c.slice(); n[i] = { ...n[i], qty: n[i].qty + qty }; return n; }
      return c.concat([{ code: p.code, name: p.name, price: p.price, cost: p.cost || 0, unit: p.unit || '', qty }]);
    });
    if (navigator.vibrate) navigator.vibrate(18);
  }, []);
  const setQty = useCallback((idx, q) => setCart((c) => (q <= 0 ? c.filter((_, i) => i !== idx) : c.map((x, i) => (i === idx ? { ...x, qty: q } : x)))), []);
  const clearCart = useCallback(() => setCart([]), []);
  const cartTotal = useMemo(() => cart.reduce((s, i) => s + i.qty * i.price, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.qty, 0), [cart]);

  /* ---- xử lý một mã vạch ---- */
  const onCode = useCallback((raw) => {
    const code = String(raw || '').replace(/\s/g, '');
    if (!code) return;
    const mine = products[code];
    if (mine && mine.price > 0) { addToCart(mine); say(`${mine.name} · ${moneyD(mine.price)}`); return; }
    const found = catRef.current ? catRef.current.lookup(code) : null;
    if (found) { setSheet({ type: 'price', data: { code: found.code || code, name: found.name, suggest: found.price, sku: found.sku, isNew: true } }); return; }
    if (mine) { setSheet({ type: 'price', data: { code, name: mine.name, suggest: 0, isNew: false } }); return; }
    setSheet({ type: 'unknown', data: { code } });
  }, [products, addToCart, say]);

  const commitPrice = useCallback(async (data, price, extra = {}) => {
    const old = products[data.code];
    const rec = {
      code: data.code, name: data.name, price: Number(price) || 0,
      cost: extra.cost != null ? Number(extra.cost) || 0 : (old ? old.cost : 0),
      unit: extra.unit || (old ? old.unit : '') || '',
      stockBase: old ? old.stockBase : undefined, stockAt: old ? old.stockAt : undefined,
    };
    await shop.saveProduct(rec);
    addToCart(rec, extra.qty || 1);
    setSheet(null);
    say(`Đã nhớ giá ${moneyD(rec.price)} cho ${rec.name}`);
  }, [shop, products, addToCart, say]);

  const tabs = [
    { id: 'sell', ic: ScanLine, t: 'Bán' },
    { id: 'bulk', ic: Scale, t: 'Hàng xá' },
    { id: 'goods', ic: Package, t: 'Hàng' },
    { id: 'orders', ic: ReceiptText, t: 'Đơn' },
    { id: 'debt', ic: Wallet, t: 'Nợ' },
    { id: 'stats', ic: BarChart3, t: 'Số liệu' },
  ];

  const ctx = { shop, cat, catRef, say, setSheet, addToCart, onCode, shopMeta, loadCatalog };

  return (
    <>
      <div className="top" style={{ padding: '8px 12px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--gold)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <Store size={17} color="#221A00" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 16 }}>{shopMeta.name}</div>
          <div className="sub row" style={{ gap: 5, fontSize: 11.5, flexWrap: 'wrap', marginTop: 1 }}>
            <span className={'dot' + (shop.sync.ok ? ' on' : '')} />
            <span style={{ fontWeight: 700, color: '#F8FAFC' }}>{ME}</span>
            {trialDaysLeft !== null && (
              <span style={{ color: '#FBBF24', fontWeight: 700, background: 'rgba(245, 158, 11, 0.2)', padding: '0px 5px', borderRadius: 4, fontSize: 11 }}>
                {trialDaysLeft === 0 ? '• Dùng thử: Ngày cuối' : `• Dùng thử: Còn ${trialDaysLeft} ngày`}
              </span>
            )}
            {shop.live.filter((l) => slug(l.name) !== slug(ME)).map((l, i) => <span key={l.name + i}>· {l.name} đang bán</span>)}
            {shop.queue > 0 ? <span style={{ color: 'var(--gold)' }}>· {shop.queue} chờ gửi</span> : null}
          </div>
        </div>
        <button className="iconbtn" style={{ width: 34, height: 34 }} onClick={() => shop.pull()} title="Đồng bộ ngay">
          {shop.sync.busy ? <RefreshCw size={16} className="spin" /> : shop.sync.ok ? <Cloud size={16} /> : <CloudOff size={16} color="#F2B21B" />}
        </button>
        <button className="iconbtn" style={{ width: 34, height: 34 }} onClick={() => setShowSettings(true)}><Settings size={16} /></button>
      </div>

      {tab === 'sell' && <SellScreen ctx={ctx} cart={cart} setQty={setQty} clearCart={clearCart} total={cartTotal} count={cartCount} />}
      {tab === 'bulk' && <BulkScreen ctx={ctx} />}
      {tab === 'goods' && <GoodsScreen ctx={ctx} />}
      {tab === 'orders' && <OrdersScreen ctx={ctx} />}
      {tab === 'debt' && <DebtScreen ctx={ctx} />}
      {tab === 'stats' && <StatsScreen ctx={ctx} />}

      <div className="tabs">
        {tabs.map((t) => {
          const Ic = t.ic;
          return (
            <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} onClick={() => { setTab(t.id); shop.refresh(); }}>
              <Ic size={20} /><span>{t.t}</span><span className="tdot" />
            </button>
          );
        })}
      </div>

      {sheet && sheet.type === 'price' && (
        <PriceSheet data={sheet.data} onClose={() => setSheet(null)} onOk={commitPrice} products={products} aiOn={shopMeta.aiOn !== false} />
      )}
      {sheet && sheet.type === 'unknown' && (
        <UnknownSheet code={sheet.data.code} aiOn={shopMeta.aiOn !== false} onClose={() => setSheet(null)}
          onPick={(name) => setSheet({ type: 'price', data: { code: sheet.data.code, name, suggest: 0, isNew: true } })} />
      )}
      {showSettings && <SettingsSheet ctx={ctx} onClose={() => setShowSettings(false)} onExit={onExit} onSignOut={onSignOut} />}
    </>
  );
}

/* ───────────── màn hình BÁN ───────────── */

function SellScreen({ ctx, cart, setQty, clearCart, total, count }) {
  const { shop, cat, catRef, say, setSheet, addToCart, onCode, shopMeta } = ctx;
  const { products } = shop;
  const [q, setQ] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [lastScanned, setLastScanned] = useState(null); // { name, price, code }
  const [quickSheet, setQuickSheet] = useState(null); // data for QuickScanSheet
  const [bulkCalcItem, setBulkCalcItem] = useState(null);
  const inputRef = useRef(null);
  const wedge = useRef({ buf: '', t: 0 });

  /* máy quét cầm tay cắm USB/Bluetooth gõ rất nhanh rồi Enter → bắt lấy */
  useEffect(() => {
    const onKey = (e) => {
      if (scanOpen || ocrOpen || payOpen) return;
      const tgt = e.target;
      const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
      if (typing) return;   // ô nhập tự xử lý, tránh thêm hàng hai lần
      const now = Date.now();
      if (now - wedge.current.t > 90) wedge.current.buf = '';
      wedge.current.t = now;
      if (/^[0-9]$/.test(e.key)) wedge.current.buf += e.key;
      else if (e.key === 'Enter' && wedge.current.buf.length >= 6) {
        const code = wedge.current.buf; wedge.current.buf = '';
        e.preventDefault(); setQ(''); onCode(code);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCode, scanOpen, ocrOpen, payOpen]);

  /* kết quả tìm: hàng của quầy trước, danh mục 150k sau */
  const results = useMemo(() => {
    const s = q.trim();
    if (s.length < 2) return [];
    const key = norm(s);
    const own = Object.values(products)
      .filter((p) => norm(p.name).includes(key) || p.code.includes(s))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 12)
      .map((p) => ({ ...p, own: true }));
    const ownCodes = new Set(own.map((p) => p.code));
    let more = [];
    if (catRef.current) {
      more = catRef.current.search(s, 30).filter((r) => !ownCodes.has(r.code))
        .map((r) => ({ code: r.code || 'S' + r.sku, name: r.name, price: 0, suggest: r.price, sku: r.sku, own: false }));
    }
    return own.concat(more).slice(0, 34);
  }, [q, products, catRef, cat.ready]);

  const pick = (r) => {
    setQ('');
    if (r.unit === 'kg' || r.unit === 'g' || (r.code && r.code.startsWith('HX_'))) {
      setBulkCalcItem(r);
      return;
    }
    if (r.own && r.price > 0) { addToCart(r); say(`${r.name} · ${moneyD(r.price)}`); }
    else setSheet({ type: 'price', data: { code: r.code, name: r.name, suggest: r.suggest || r.price || 0, sku: r.sku, isNew: !r.own } });
  };

  // ML Kit scan loop — mỗi lần quét xong gọi lại ngay, không cần bấm thêm
  const scanLoopRef = useRef(false);
  const onCamCodeRef = useRef(null); // ref tránh circular dep

  const doScan = useCallback(async () => {
    if (scanLoopRef.current) return;
    scanLoopRef.current = true;
    try {
      const st = await ensureScanner();
      if (!st.ok) { say(st.note || 'Không mở được camera'); scanLoopRef.current = false; return; }
      const code = await scanOnce();
      scanLoopRef.current = false;
      if (code && onCamCodeRef.current) onCamCodeRef.current(code);
    } catch (e) {
      scanLoopRef.current = false;
      if (e.message && e.message !== 'web') say(e.message);
    }
  }, [say]);

  // Tự động quét khi bật camOn
  useEffect(() => {
    if (camOn && isNative()) doScan();
    if (!camOn) { scanLoopRef.current = false; setLastScanned(null); }
  // eslint-disable-next-line
  }, [camOn]);

  const onCamCode = useCallback((raw) => {
    const code = String(raw || '').replace(/\s/g, '');
    if (!code) return;
    const mine = products[code];
    const found = catRef.current ? catRef.current.lookup(code) : null;
    // Luôn mở QuickScanSheet — điền sẵn tên + giá nếu đã có
    setQuickSheet({
      code,
      name: (mine && mine.name) || (found && found.name) || '',
      suggest: (found && found.price) || 0,
      sku: found && found.sku,
    });
  }, [products, catRef]);

  // Sync ref để doScan luôn gọi phiên bản mới nhất của onCamCode
  useEffect(() => { onCamCodeRef.current = onCamCode; }, [onCamCode]);

  // Xác nhận từ QuickScanSheet → lưu giá + thêm giỏ + quét tiếp
  const onQuickConfirm = useCallback(async (name, price) => {
    if (!quickSheet) return;
    const old = products[quickSheet.code] || {};
    const rec = {
      code: quickSheet.code, name, price: Number(price) || 0,
      cost: old.cost || 0, unit: old.unit || '',
      stockBase: old.stockBase, stockAt: old.stockAt,
    };
    await shop.saveProduct(rec);
    addToCart(rec, 1);
    say(`${name} · ${moneyD(price)}`);
    setLastScanned({ name, price, code: quickSheet.code });
    setQuickSheet(null);
    // Quét tiếp ngay
    setTimeout(() => doScan(), 300);
  }, [quickSheet, products, shop, addToCart, say, doScan]);

  // Chuyển sang PriceSheet đầy đủ từ QuickScanSheet
  const onQuickEditFull = useCallback(() => {
    if (!quickSheet) return;
    const mine = products[quickSheet.code];
    setSheet({ type: quickSheet.name ? 'price' : 'unknown',
      data: { code: quickSheet.code, name: quickSheet.name, suggest: quickSheet.suggest, sku: quickSheet.sku, isNew: !mine } });
    setQuickSheet(null);
  }, [quickSheet, products, setSheet]);

  const submit = () => {
    const s = q.trim();
    if (!s) return;
    if (/^\d{6,14}$/.test(s)) { setQ(''); onCode(s); return; }
    if (results.length) pick(results[0]);
  };

  const todaySum = (shop.sums && shop.sums[shop.viewMonth] && shop.sums[shop.viewMonth][dayKey()]) || { rev: 0, cost: 0, cnt: 0 };
  const todayRev = todaySum.rev || 0;
  const todayCost = todaySum.cost || 0;
  const todayCnt = todaySum.cnt || 0;

  return (
    <>
      <div className="body">
        <div className="pad" style={{ paddingBottom: 4 }}>
          {/* Doanh thu hôm nay (Gọn đẹp - Tiết kiệm không gian) */}
          <div className="card pad" style={{ background: 'linear-gradient(135deg, #0F172A, #1E293B)', color: '#fff', marginBottom: 8, padding: '7px 12px', borderRadius: 12, border: 'none' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
              <div className="row" style={{ gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase' }}>T{dowOf(dayKey())} {shortDate(dayKey())}</span>
                <span className="num" style={{ fontSize: 18, fontWeight: 800, color: '#34D399' }}>{money(todayRev)} ₫</span>
              </div>
              <div className="row" style={{ gap: 8, fontSize: 12, fontWeight: 600 }}>
                <span style={{ color: '#A7F3D0' }}>Thu: <b className="num">{money(todayRev)}</b> ({todayCnt} đơn)</span>
                <span style={{ color: '#FCA5A5' }}>Vốn: <b className="num">{money(todayCost)}</b></span>
              </div>
            </div>
          </div>

          <div className="row">
            <div className="searchwrap">
              <Search size={19} className="sicon" />
              <input ref={inputRef} className="search" value={q} placeholder="Quét mã, gõ tên hoặc mã hàng…"
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                inputMode="search" autoComplete="off" />
              {q ? <button className="sclear" onClick={() => setQ('')}><X size={18} /></button> : null}
            </div>
          </div>

          <div className="split" style={{ marginTop: 8 }}>
            <button className={camOn ? 'btn pay' : 'btn dark'} onClick={() => { setCamOn((v) => !v); setLastScanned(null); }}>
              <ScanLine size={19} /> {camOn ? 'Tắt camera' : 'Quét mã'}
            </button>
            <button className="btn gold" onClick={() => setOcrOpen(true)}><FileText size={19} /> Ảnh đơn</button>
          </div>
          {shopMeta.aiOn !== false && aiReady() && (
            <button className="btn" style={{ width: '100%', marginTop: 6 }}
              onClick={() => setSheet({ type: 'unknown', data: { code: '' } })}>
              <Camera size={18} /> Chụp ảnh hàng — AI nhận dạng tên
            </button>
          )}

          {camOn && (
            <div style={{ marginTop: 10 }}>
              {/* Kết quả quét gần nhất */}
              {lastScanned ? (
                <div className="card pad" style={{ borderLeft: '3px solid var(--ok)', marginBottom: 8 }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="nm">{lastScanned.name}</div>
                      <div className="tiny muted num">{lastScanned.code}</div>
                    </div>
                    <div className="num" style={{ fontWeight: 700, fontSize: 17, color: 'var(--ok)' }}>{money(lastScanned.price)} ✓</div>
                  </div>
                </div>
              ) : (
                <div className="banner info" style={{ marginBottom: 8 }}>
                  <ScanLine size={16} />
                  <div className="tiny">Bấm nút bên dưới → hướng camera vào mã vạch → tự nhận ngay</div>
                </div>
              )}
              <button className="btn pay" style={{ width: '100%' }} onClick={doScan}>
                <ScanLine size={20} /> Bấm để quét mã tiếp theo
              </button>
            </div>
          )}

          {!cat.ready && !cat.loading && (
            <div className="banner warn" style={{ marginTop: 10 }}>
              <AlertTriangle size={17} />
              <div>Chưa nạp danh mục hàng hoá. Vào <b>Cài đặt → Danh mục</b> để nhập tệp một lần, sau đó máy nào cũng dùng được.</div>
            </div>
          )}
          {cat.loading && (
            <div className="card pad" style={{ marginTop: 10 }}>
              <div className="row tiny" style={{ justifyContent: 'space-between', marginBottom: 6 }}><span>{cat.note}</span><span className="num">{cat.progress}%</span></div>
              <div className="progress"><i style={{ width: cat.progress + '%' }} /></div>
            </div>
          )}
        </div>

        {results.length > 0 && (
          <div className="pad" style={{ paddingTop: 4 }}>
            <div className="card">
              {results.map((r, i) => (
                <button key={r.code + i} className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => pick(r)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{r.name}</div>
                    <div className="mt row" style={{ gap: 6 }}>
                      <span className="num">{r.code}</span>
                      {r.own ? <span className="badge ok">hàng của quầy</span> : <span className="badge">danh mục</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    {r.own && r.price > 0
                      ? <div className="num" style={{ fontWeight: 700, fontSize: 15 }}>{money(r.price)}</div>
                      : <div className="tiny muted">{r.suggest ? 'gợi ý ' + money(r.suggest) : 'chưa có giá'}</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pad" style={{ paddingTop: results.length ? 4 : 0 }}>
          <div className="eyebrow">Giỏ hàng {count > 0 ? `· ${count} món` : ''}</div>
          {cart.length === 0 ? (
            <div className="empty">
              <ScanLine size={30} strokeWidth={1.4} />
              <h4>Chưa có món nào</h4>
              <div className="sm">Quét mã vạch hoặc gõ tên hàng để thêm vào giỏ.</div>
            </div>
          ) : (
            <div className="card">
              {cart.map((it, i) => (
                <div className="item" key={it.code + i}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{it.name}</div>
                    <div className="mt num">{money(it.price)} × {it.qty} = <b>{money(it.price * it.qty)}</b></div>
                  </div>
                  <div className="stepper">
                    <button onClick={() => setQty(i, it.qty - 1)}>{it.qty === 1 ? <Trash2 size={15} /> : <Minus size={15} />}</button>
                    <div className="q">{it.qty}</div>
                    <button onClick={() => setQty(i, it.qty + 1)}><Plus size={15} /></button>
                  </div>
                </div>
              ))}
              <div className="item" style={{ justifyContent: 'space-between' }}>
                <button className="btn sm2 ghost" onClick={clearCart}><Trash2 size={15} /> Xoá giỏ</button>
                <span className="tiny muted">Bấm số lượng để sửa nhanh</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="dock">
        <div className="lcd">
          <div className="lab"><span>{count} món</span><span>{shopMeta.name}</span></div>
          <div className="big">{money(total)}<small>₫</small></div>
        </div>
        <button className="btn pay" style={{ width: '100%', marginTop: 9 }} disabled={!cart.length} onClick={() => setPayOpen(true)}>
          <CircleDollarSign size={20} /> Tính tiền
        </button>
      </div>

      {scanOpen && <ScanSheet onClose={() => setScanOpen(false)} onCode={(c) => { setScanOpen(false); onCode(c); }} say={say} aiOn={shopMeta.aiOn !== false} />}
      {quickSheet && <QuickScanSheet data={quickSheet} products={products} onConfirm={onQuickConfirm} onClose={() => { setQuickSheet(null); setTimeout(() => doScan(), 200); }} onEditFull={onQuickEditFull} />}
      {ocrOpen && <OcrSheet ctx={ctx} onClose={() => setOcrOpen(false)} />}
      {payOpen && <PaySheet ctx={ctx} cart={cart} total={total} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); clearCart(); }} />}
      {bulkCalcItem && <BulkCalcSheet item={bulkCalcItem} onClose={() => setBulkCalcItem(null)} ctx={ctx} />}
    </>
  );
}

/* ═══ QUICK SCAN SHEET — hiện ngay sau khi quét, bấm ✓ thêm giỏ rồi quét tiếp ═══ */
function QuickScanSheet({ data, products, onConfirm, onClose, onEditFull }) {
  const existing = products[data.code] || {};
  const [name, setName] = useState(data.name || existing.name || '');
  const [price, setPrice] = useState(String(existing.price || data.suggest || ''));
  const suggest = Number(data.suggest) || 0;

  const p = Number(price) || 0;
  const canOk = name.trim() && p > 0;

  const quickPrices = [];
  if (suggest > 0) {
    quickPrices.push({ v: suggest, t: `Vốn ${money(suggest)}` });
    quickPrices.push({ v: roundTo(suggest * 1.1, 500), t: `+10%` });
    quickPrices.push({ v: roundTo(suggest * 1.2, 1000), t: `+20%` });
  }
  [5000,10000,15000,20000,25000,30000,50000].forEach((v) => {
    if (!quickPrices.find((q) => q.v === v)) quickPrices.push({ v, t: money(v) });
  });

  return (
    <Sheet open onClose={onClose} title="Xác nhận hàng" icon={<ScanLine size={20} />}
      footer={
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm2" style={{ flex: 'none' }} onClick={onEditFull}>
            <Settings size={16} /> Chi tiết
          </button>
          <button className="btn pay" style={{ flex: 1 }} disabled={!canOk} onClick={() => onConfirm(name.trim(), p)}>
            <Check size={20} /> Thêm vào giỏ
          </button>
        </div>
      }>

      {/* Tên hàng */}
      <div className="lab">Tên hàng</div>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Tên hàng…" autoCapitalize="words" />

      {/* Mã + badge */}
      <div className="row tiny muted" style={{ marginTop: 6, gap: 8 }}>
        <span className="num">{data.code}</span>
        {existing.price > 0
          ? <span className="badge ok">đã có giá</span>
          : <span className="badge">hàng mới</span>}
        {suggest > 0 && <span className="badge gold">danh mục {money(suggest)}</span>}
      </div>

      {/* Giá — chọn nhanh */}
      <div className="lab" style={{ marginTop: 12 }}>Giá bán</div>
      <div className="lcd" style={{ marginBottom: 8 }}>
        <div className="big">{price ? money(price) : '0'}<small>₫</small></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {quickPrices.slice(0, 7).map((q) => (
          <button key={q.v} className={'btn sm2' + (Number(price) === q.v ? ' gold' : '')}
            onClick={() => setPrice(String(q.v))}>{q.t}</button>
        ))}
      </div>
      <NumPad value={price} onChange={setPrice} hideOk />
    </Sheet>
  );
}

/* ───────────── tấm QUÉT MÃ (ML Kit trên Android) ───────────── */

function ScanSheet({ onClose, onCode, say, aiOn }) {
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef(null);
  const stopRef = useRef(null);

  useEffect(() => {
    if (isNative()) startCam();
    return () => { if (stopRef.current) stopRef.current(); };
  // eslint-disable-next-line
  }, []);

  const startCam = async () => {
    setBusy(true); setNote('');
    try {
      const st = await ensureScanner();
      if (st.note) setNote(st.note);
      if (!st.ok) { setBusy(false); return; }
      if (isNative()) {
        setScanning(true); setBusy(false);
        const stop = await startContinuousScan((code) => { onCode(code); });
        stopRef.current = stop;
      } else {
        const code = await scanOnce();
        setBusy(false);
        if (code) onCode(code);
      }
    } catch (e) {
      setBusy(false); setScanning(false);
      setNote(e.message === 'web' ? 'Bản trình duyệt chưa mở camera được — dùng "Chụp ảnh mã".' : (e.message || 'Không mở được camera'));
    }
  };

  const stopCam = async () => {
    if (stopRef.current) { await stopRef.current(); stopRef.current = null; }
    setScanning(false);
  };

  const fromPhoto = async (file) => {
    if (!file) return;
    setBusy(true); setNote('');
    try {
      const direct = await readFromImage(file);
      if (direct) { setBusy(false); onCode(direct); return; }
      setNote('Ảnh chưa rõ mã. Chụp gần, đủ sáng, hoặc gõ tay dãy số bên dưới.');
    } catch (e) { setNote(e.message || 'Đọc ảnh lỗi'); }
    setBusy(false);
  };

  return (
    <Sheet open onClose={async () => { await stopCam(); onClose(); }} title="Quét mã vạch" icon={<ScanLine size={20} />}>
      {scanning ? (
        <div>
          <div className="banner ok" style={{ marginBottom: 10 }}>
            <ScanLine size={17} />
            <div>Camera đang bật — hướng vào mã vạch, quét liên tiếp không cần bấm gì.</div>
          </div>
          <button className="btn" style={{ width: '100%' }} onClick={stopCam}>
            <X size={18} /> Đóng camera
          </button>
        </div>
      ) : (
        <button className="btn pay" style={{ width: '100%' }} disabled={busy} onClick={startCam}>
          {busy ? <Loader2 size={19} className="spin" /> : <ScanLine size={20} />} Mở camera quét
        </button>
      )}
      {note ? <div className="banner warn" style={{ marginTop: 10 }}><AlertTriangle size={17} /><div>{note}</div></div> : null}
      {!scanning && <>
        <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
          <Camera size={18} /> Chụp ảnh mã (khi quét không ăn)
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; fromPhoto(f); }} />
        <div className="eyebrow">Gõ tay dãy số dưới mã vạch</div>
        <div className="row">
          <input className="field num" value={manual} inputMode="numeric" placeholder="8934xxxxxxxxx"
            onChange={(e) => setManual(e.target.value.replace(/\D/g, '').slice(0, 14))} />
          <button className="btn dark" disabled={manual.length < 6} onClick={() => onCode(manual)}><Check size={18} /></button>
        </div>
        <div className="banner info" style={{ marginTop: 12 }}>
          <ScanLine size={17} />
          <div>Có máy quét cầm tay cắm USB hoặc Bluetooth? Đóng tấm này rồi bắn thẳng vào màn hình bán — app tự nhận.</div>
        </div>
      </>}
    </Sheet>
  );
}

/* ───────────── tấm ĐẶT GIÁ (nhớ giá cho lần sau) ───────────── */

function PriceSheet({ data, onClose, onOk, products, aiOn }) {
  const existing = products[data.code];
  const [price, setPrice] = useState(existing && existing.price ? String(existing.price) : '');
  const [name, setName] = useState(data.name || '');
  const [cost, setCost] = useState(existing && existing.cost ? String(existing.cost) : '');
  const [unit, setUnit] = useState((existing && existing.unit) || '');
  const [more, setMore] = useState(false);
  const base = Number(data.suggest) || 0;
  const quick = [];
  if (base > 0) {
    quick.push({ v: roundTo(base, 500), t: 'Giá vốn ' + money(base) });
    quick.push({ v: roundTo(base * 1.1, 500), t: '+10% ' + money(roundTo(base * 1.1, 500)) });
    quick.push({ v: roundTo(base * 1.2, 1000), t: '+20% ' + money(roundTo(base * 1.2, 1000)) });
  }
  [5000, 10000, 15000, 20000, 25000, 30000, 50000].forEach((v) => quick.push({ v, t: money(v) }));
  const seenQ = new Set();
  const quickU = quick.filter((x) => (x.v > 0 && !seenQ.has(x.v) ? (seenQ.add(x.v), true) : false));

  const p = Number(price) || 0;
  const c = Number(cost) || 0;
  const lai = p - c;

  return (
    <Sheet open onClose={onClose} title={data.isNew ? 'Hàng mới — đặt giá bán' : 'Đặt lại giá bán'} icon={<CircleDollarSign size={20} />}
      footer={<button className="btn pay" style={{ width: '100%' }} disabled={p <= 0 || !name.trim()}
        onClick={() => onOk({ ...data, name: name.trim() || data.name }, p, { cost: c, unit })}>
        <Check size={19} /> Lưu giá & thêm vào giỏ
      </button>}>
      <div className="card pad" style={{ marginBottom: 12 }}>
        <div className="lab">Tên hàng</div>
        <div className="row">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="row tiny muted" style={{ marginTop: 7, gap: 8 }}>
          <span className="num">{data.code}</span>
          {data.sku ? <span className="badge">SKU {data.sku}</span> : null}
          {base > 0 ? <span className="badge gold">danh mục {money(base)}</span> : null}
        </div>
      </div>

      <div className="lcd" style={{ marginBottom: 12 }}>
        <div className="lab"><span>Giá bán</span><span>{lai !== 0 && c > 0 ? `lãi ${money(lai)}` : ''}</span></div>
        <div className="big">{price ? money(price) : '0'}<small>₫</small></div>
      </div>

      <NumPad value={price} onChange={setPrice} quick={quickU} okLabel="Lưu giá & thêm vào giỏ"
        onOk={() => { if (p > 0 && name.trim()) onOk({ ...data, name: name.trim() }, p, { cost: c, unit }); }} />

      <button className="btn ghost sm2" style={{ width: '100%', marginTop: 12 }} onClick={() => setMore((m) => !m)}>
        {more ? 'Ẩn' : 'Thêm'} giá vốn & đơn vị
      </button>
      {more && (
        <div className="card pad" style={{ marginTop: 8 }}>
          <div className="split">
            <div>
              <div className="lab">Giá vốn (để tính lãi)</div>
              <input className="field num" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} placeholder="0" />
            </div>
            <div>
              <div className="lab">Đơn vị</div>
              <input className="field" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="gói / chai / kg" />
            </div>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>Bỏ trống cũng được. Có giá vốn thì mục Số liệu sẽ hiện lãi thật.</div>
        </div>
      )}
    </Sheet>
  );
}

/* ───────────── tấm MÃ LẠ — chụp ảnh cho AI đoán tên ─────────────
   Cổng AI của bạn chỉ nhận ẢNH, không tra được bằng riêng dãy số mã vạch,
   nên đổi luồng: chụp ảnh món hàng thay vì tự động tra theo mã. */

function UnknownSheet({ code, aiOn, onClose, onPick }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [manual, setManual] = useState('');
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);

  const origin = code.startsWith('893') ? 'Hàng sản xuất tại Việt Nam' : code.startsWith('880') ? 'Hàng Hàn Quốc' : code.startsWith('49') ? 'Hàng Nhật' : code.startsWith('69') ? 'Hàng Trung Quốc' : '';

  const shoot = async (file) => {
    if (!file) return;
    setBusy(true); setErr(''); setRes(null);
    setPreview(URL.createObjectURL(file));
    try {
      const { b64, mime } = await compressImage(file, 800, 0.75); // nén trước khi gửi AI
      const r = await aiIdentifyPhoto(b64, mime);
      setRes(r);
      if (!r.found) setErr('Ảnh chưa rõ, hoặc AI không đoán ra. Gõ tên hàng vào bên dưới.');
    } catch (e) { setErr(e.message || 'Không nhận diện được'); }
    setBusy(false);
  };

  return (
    <Sheet open onClose={onClose} title="Mã này chưa có trong sổ" icon={<Search size={20} />}>
      <div className="lcd" style={{ marginBottom: 12 }}>
        <div className="lab"><span>Mã vạch</span><span>{origin}</span></div>
        <div className="big" style={{ fontSize: 26 }}>{code}</div>
      </div>

      {aiOn !== false ? (
        <>
          <button className="btn dark" style={{ width: '100%' }} disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
            {busy ? <Loader2 size={19} className="spin" /> : <Camera size={20} />} Chụp ảnh món hàng cho AI đoán tên
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; shoot(f); }} />
        </>
      ) : null}

      {preview ? <img alt="món hàng" src={preview} style={{ width: '100%', borderRadius: 12, margin: '10px 0', maxHeight: 170, objectFit: 'cover' }} /> : null}
      {err ? <div className="banner warn" style={{ margin: '10px 0' }}><AlertTriangle size={17} /><div>{err}</div></div> : null}

      {res && res.found && (
        <button className="card pad" style={{ width: '100%', textAlign: 'left', margin: '10px 0', borderColor: 'var(--gold)' }}
          onClick={() => onPick(res.name)}>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <Sparkles size={16} color="#D69A08" /><span className="badge gold">AI đoán</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{res.name}</div>
          <div className="row tiny" style={{ marginTop: 8, color: 'var(--pay)', fontWeight: 700 }}>Dùng tên này <ChevronRight size={14} /></div>
        </button>
      )}

      <div className="lab" style={{ marginTop: 12 }}>Hoặc tự gõ tên hàng</div>
      <div className="row">
        <input className="field" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Mì Hảo Hảo tôm chua cay 75g" />
        <button className="btn dark" disabled={manual.trim().length < 2} onClick={() => onPick(manual.trim())}><Check size={18} /></button>
      </div>
    </Sheet>
  );
}

/* ───────────── tấm ĐỌC ẢNH ĐƠN HÀNG ───────────── */

function OcrSheet({ ctx, onClose }) {
  const { catRef, shop, addToCart, say, setSheet } = ctx;
  const { products } = shop;
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState(null);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState('');
  const fileRef = useRef(null);

  const match = (name) => {
    const own = Object.values(products).find((p) => norm(p.name).includes(norm(name)) || norm(name).includes(norm(p.name)));
    if (own) return { ...own, matched: 'quầy' };
    if (catRef.current) {
      const r = catRef.current.search(name, 1)[0];
      if (r) return { code: r.code || 'S' + r.sku, name: r.name, price: 0, suggest: r.price, matched: 'danh mục' };
    }
    return null;
  };

  const run = async (file) => {
    if (!file) return;
    setBusy(true); setErr(''); setLines(null);
    setPreview(URL.createObjectURL(file));
    try {
      const { b64, mime } = await compressImage(file, 1200, 0.80); // hoá đơn cần rõ hơn
      const r = await aiReadOrder(b64, mime);
      const out = (r.lines || []).map((l) => {
        const m = match(l.name);
        return { raw: l.name, qty: Number(l.qty) || 1, price: Number(l.price) || (m ? m.price : 0) || 0, m };
      });
      setLines(out);
      if (!out.length) setErr('Không đọc ra dòng hàng nào. Chụp lại rõ hơn nhé.');
    } catch (e) { setErr(e.message || 'Đọc ảnh lỗi'); }
    setBusy(false);
  };

  const addAll = () => {
    let ok = 0, miss = 0;
    (lines || []).forEach((l) => {
      const price = l.price || (l.m && l.m.price) || 0;
      if (price > 0 && l.m) { addToCart({ code: l.m.code, name: l.m.name, price, cost: l.m.cost || 0 }, l.qty); ok++; }
      else miss++;
    });
    say(miss ? `Đã thêm ${ok} món, còn ${miss} món thiếu giá` : `Đã thêm ${ok} món vào giỏ`);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Đọc đơn từ ảnh" icon={<FileText size={20} />} wide
      footer={lines && lines.length
        ? <button className="btn pay" style={{ width: '100%' }} onClick={addAll}><Check size={19} /> Thêm hết vào giỏ</button>
        : <button className="btn dark" style={{ width: '100%' }} onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
            {busy ? <Loader2 size={18} className="spin" /> : <Camera size={19} />} {busy ? 'Đang đọc…' : 'Chụp / chọn ảnh đơn'}
          </button>}>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; run(f); }} />

      {!lines && !busy && (
        <div className="empty">
          <FileText size={30} strokeWidth={1.3} />
          <h4>Đơn giấy viết tay hay in đều được</h4>
          <div className="sm">Chụp tờ đơn, AI tách từng dòng hàng, dò tên trong danh mục rồi bỏ vào giỏ. Bạn chỉ việc soát lại.</div>
        </div>
      )}
      {preview ? <img alt="đơn hàng" src={preview} style={{ width: '100%', borderRadius: 12, marginBottom: 12, maxHeight: 190, objectFit: 'cover' }} /> : null}
      {busy ? <div className="card pad row" style={{ gap: 10 }}><Loader2 size={18} className="spin" /><span className="sm">Đang đọc chữ trên ảnh…</span></div> : null}
      {err ? <div className="banner err"><AlertTriangle size={17} /><div>{err}</div></div> : null}

      {lines && lines.length > 0 && (
        <div className="card">
          {lines.map((l, i) => (
            <div className="item" key={i}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nm">{l.m ? l.m.name : l.raw}</div>
                <div className="mt row" style={{ gap: 6 }}>
                  {l.m ? <span className="badge ok">khớp {l.m.matched}</span> : <span className="badge red">chưa khớp</span>}
                  <span className="num">SL {l.qty}</span>
                  {l.price > 0 ? <span className="num">· {money(l.price)}</span> : <span style={{ color: 'var(--pay)' }}>· thiếu giá</span>}
                </div>
              </div>
              {(!l.price || !l.m) && (
                <button className="btn sm2" onClick={() => {
                  const d = l.m ? { code: l.m.code, name: l.m.name, suggest: l.m.suggest || 0, isNew: !l.m.price }
                    : { code: 'T' + uid(), name: l.raw, suggest: 0, isNew: true };
                  onClose(); setSheet({ type: 'price', data: d });
                }}><Pencil size={15} /></button>
              )}
            </div>
          ))}
        </div>
      )}
      {lines ? <button className="btn ghost sm2" style={{ width: '100%', marginTop: 10 }} onClick={() => fileRef.current && fileRef.current.click()}>Chụp ảnh khác</button> : null}
    </Sheet>
  );
}

/* ───────────── tấm TÍNH TIỀN ───────────── */

function PaySheet({ ctx, cart, total, onClose, onDone }) {
  const { shop, shopMeta, say } = ctx;
  const [disc, setDisc] = useState('');
  const [paid, setPaid] = useState('');
  const [debt, setDebt] = useState(false);
  const [cust, setCust] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDisc, setShowDisc] = useState(false);

  const d = Math.min(Number(disc) || 0, total);
  const due = Math.max(0, total - d);
  const pay = Number(paid) || 0;
  const change = pay - due;

  const notes = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
  const suggest = Array.from(new Set([due, roundTo(due + 4999, 5000), roundTo(due + 9999, 10000), 50000, 100000, 200000, 500000].filter((v) => v >= due))).slice(0, 5);

  const finish = async (alsoPrint) => {
    setBusy(true);
    const order = {
      id: `${slug(shop.ME)}-${Date.now().toString(36)}-${uid().slice(0, 4)}`,
      ts: Date.now(), day: dayKey(), seller: shop.ME,
      items: cart.map((i) => ({ code: i.code, name: i.name, qty: i.qty, price: i.price, cost: i.cost || 0 })),
      gross: total, discount: d, total: due,
      paid: debt ? 0 : (pay || due), change: debt ? 0 : Math.max(0, change),
      debt, customer: cust.trim(), note: note.trim(),
    };
    try {
      await shop.saveOrder(order);
      if (debt && cust.trim()) await shop.addDebt({ customer: cust.trim(), amount: due, orderId: order.id, note: 'Mua hàng ghi sổ' });
      say(debt ? `Đã ghi nợ ${cust.trim() || 'khách'} ${moneyD(due)}` : `Xong đơn ${moneyD(due)}${change > 0 ? ' · thối ' + money(change) : ''}`);
      if (alsoPrint) printViaBrowser(order, shopMeta, shopMeta.paper || 80);
      onDone();
    } catch (e) { say('Lưu đơn lỗi, thử lại giúp mình'); }
    setBusy(false);
  };

  return (
    <Sheet open onClose={onClose} title="Tính tiền" icon={<CircleDollarSign size={20} />} wide
      footer={
        <div className="split" style={{ gap: 8 }}>
          <button className="btn ghost" disabled={busy} onClick={() => finish(true)}><Printer size={18} /> Lưu & in</button>
          <button className="btn pay" disabled={busy || (!debt && pay > 0 && change < 0)} onClick={() => finish(false)}>
            {busy ? <Loader2 size={18} className="spin" /> : <Check size={19} />} Xong
          </button>
        </div>}>
      <div className="lcd">
        <div className="lab"><span>{debt ? 'Ghi nợ' : 'Khách phải trả'}</span><span>{cart.reduce((s, i) => s + i.qty, 0)} món</span></div>
        <div className="big">{money(due)}<small>₫</small></div>
      </div>

      <div className="chips" style={{ marginTop: 10 }}>
        <button className={'chip' + (showDisc ? ' on' : '')} onClick={() => setShowDisc((s) => !s)}>Giảm giá{d > 0 ? ' ' + money(d) : ''}</button>
        <button className={'chip' + (debt ? ' on' : '')} onClick={() => setDebt((v) => !v)}><Wallet size={15} /> Ghi sổ nợ</button>
      </div>

      {showDisc && (
        <div className="card pad" style={{ marginTop: 10 }}>
          <div className="lab">Bớt cho khách</div>
          <input className="field num" inputMode="numeric" value={disc} onChange={(e) => setDisc(e.target.value.replace(/\D/g, ''))} placeholder="0" />
          <div className="chips" style={{ marginTop: 8 }}>
            {[1000, 2000, 5000, 10000].map((v) => <button key={v} className="chip" onClick={() => setDisc(String(v))}>-{money(v)}</button>)}
            <button className="chip" onClick={() => setDisc(String(total - roundTo(total, 1000) > 0 ? total - roundTo(total, 1000) : total % 1000))}>Chẵn nghìn</button>
          </div>
        </div>
      )}

      {debt ? (
        <div className="card pad" style={{ marginTop: 10 }}>
          <div className="lab">Tên khách nợ</div>
          <input className="field" value={cust} onChange={(e) => setCust(e.target.value)} placeholder="Cô Bảy đầu hẻm" />
          <div className="lab" style={{ marginTop: 10 }}>Ghi chú</div>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hẹn trả cuối tháng" />
        </div>
      ) : (
        <>
          <div className="eyebrow">Khách đưa</div>
          <div className="chips">
            {suggest.map((v) => <button key={v} className="chip" onClick={() => setPaid(String(v))}>{money(v)}</button>)}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {notes.map((v) => <button key={v} className="chip" onClick={() => setPaid(String((Number(paid) || 0) + v))}>+{money(v)}</button>)}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <input className="field num" inputMode="numeric" value={paid} onChange={(e) => setPaid(e.target.value.replace(/\D/g, ''))} placeholder="Số tiền khách đưa" />
            <button className="btn ghost" style={{ height: 48, width: 52 }} onClick={() => setPaid('')}><X size={18} /></button>
          </div>
          <div className="lcd" style={{ marginTop: 10 }}>
            <div className="lab"><span>Tiền thối lại</span><span>{pay > 0 && change < 0 ? 'còn thiếu ' + money(-change) : ''}</span></div>
            <div className="big" style={{ color: change < 0 ? '#7A1226' : undefined }}>{money(Math.max(0, change))}<small>₫</small></div>
          </div>
        </>
      )}

      <div className="eyebrow">Đơn hàng</div>
      <div className="card">
        {cart.map((it, i) => (
          <div className="item" key={i}>
            <div style={{ flex: 1 }}><div className="nm">{it.name}</div><div className="mt num">{it.qty} × {money(it.price)}</div></div>
            <div className="num" style={{ fontWeight: 700 }}>{money(it.qty * it.price)}</div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/* ───────────── màn hình ĐƠN ───────────── */

function OrdersScreen({ ctx }) {
  const { shop, shopMeta, say } = ctx;
  const { orders, viewDay, setViewDay } = shop;
  const [open, setOpen] = useState(null);

  const live = orders.filter((o) => !o.void);
  const rev = live.reduce((s, o) => s + o.total, 0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(dayKey(), -i));

  return (
    <>
      <div className="body">
      <div className="pad">
        <div className="chips">
          {days.map((d) => (
            <button key={d} className={'chip' + (d === viewDay ? ' on' : '')} onClick={() => setViewDay(d)}>
              {d === dayKey() ? 'Hôm nay' : `${dowOf(d)} ${shortDate(d)}`}
            </button>
          ))}
        </div>

        <div className="lcd" style={{ marginTop: 12 }}>
          <div className="lab"><span>{live.length} đơn</span><span>{viewDay === dayKey() ? 'Hôm nay' : shortDate(viewDay)}</span></div>
          <div className="big">{money(rev)}<small>₫</small></div>
        </div>

        <div className="eyebrow">Danh sách đơn</div>
        {orders.length === 0 ? (
          <div className="empty"><ReceiptText size={30} strokeWidth={1.3} /><h4>Chưa có đơn nào</h4><div className="sm">Bán xong đơn đầu tiên là nó hiện ở đây.</div></div>
        ) : (
          <div className="card">
            {orders.map((o) => (
              <button key={o.id} className="item" style={{ width: '100%', textAlign: 'left', opacity: o.void ? 0.45 : 1 }} onClick={() => setOpen(o)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nm row" style={{ gap: 7 }}>
                    <span className="num">{clock(o.ts)}</span>
                    <span className="muted tiny">{o.seller}</span>
                    {o.debt ? <span className="badge red">nợ</span> : null}
                    {o.void ? <span className="badge">đã huỷ</span> : null}
                  </div>
                  <div className="mt" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {o.items.map((i) => `${i.name} ×${i.qty}`).join(' · ')}
                  </div>
                </div>
                <div className="num" style={{ fontWeight: 700, fontSize: 15 }}>{money(o.total)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>

      {open && (
        <Sheet open onClose={() => setOpen(null)} title={`Đơn ${clock(open.ts)} · ${open.seller}`} icon={<ReceiptText size={20} />}
          footer={
            <div className="split3" style={{ gap: 8 }}>
              <button className="btn ghost sm2" style={{ height: 46 }} onClick={() => printViaBrowser(open, shopMeta, shopMeta.paper || 80)}><Printer size={17} /> In</button>
              <button className="btn ghost sm2" style={{ height: 46 }} onClick={async () => {
                try { await navigator.clipboard.writeText(receiptText(open, shopMeta, shopMeta.paper || 80)); say('Đã chép nội dung bill'); } catch { say('Máy không cho chép'); }
              }}><FileText size={17} /> Chép</button>
              <button className="btn sm2" style={{ height: 46, color: 'var(--pay)', borderColor: '#F1B9C5' }} disabled={open.void}
                onClick={async () => { await shop.voidOrder(open); say('Đã huỷ đơn'); setOpen(null); }}><Trash2 size={17} /> Huỷ</button>
            </div>}>
          <div className="card">
            {open.items.map((i, k) => (
              <div className="item" key={k}>
                <div style={{ flex: 1 }}><div className="nm">{i.name}</div><div className="mt num">{i.qty} × {money(i.price)}</div></div>
                <div className="num" style={{ fontWeight: 700 }}>{money(i.qty * i.price)}</div>
              </div>
            ))}
          </div>
          <div className="card pad" style={{ marginTop: 10 }}>
            {[['Tổng hàng', money(open.gross)], ['Giảm giá', open.discount ? '-' + money(open.discount) : '0'],
              ['Phải trả', money(open.total)], open.debt ? ['Ghi nợ', open.customer || 'khách'] : ['Khách đưa', money(open.paid)],
              open.debt ? null : ['Thối lại', money(open.change)]].filter(Boolean).map(([a, b], i) => (
              <div className="row" key={i} style={{ justifyContent: 'space-between', padding: '5px 0' }}>
                <span className="sm muted">{a}</span><span className="num" style={{ fontWeight: 600 }}>{b}</span>
              </div>
            ))}
            {open.note ? <div className="tiny muted" style={{ marginTop: 6 }}>Ghi chú: {open.note}</div> : null}
          </div>
          <BillPreview order={open} shopMeta={shopMeta} say={say} />
        </Sheet>
      )}
    </>
  );
}

/* ───────────── xem trước bill + in Bluetooth ───────────── */

function BillPreview({ order, shopMeta, say }) {
  const [bt, setBt] = useState(null);
  const [busy, setBusy] = useState(false);
  const w = shopMeta.paper || 80;

  const btPrint = async () => {
    setBusy(true);
    try {
      const conn = bt || await btConnect();
      setBt(conn);
      await btWrite(conn.char, escposBytes(order, shopMeta, w, shopMeta.no_accent !== false));
      say('Đã gửi lệnh in qua Bluetooth');
    } catch (e) { say(e.message || 'Không in được'); }
    setBusy(false);
  };

  return (
    <>
      <div className="eyebrow">Bill khổ {w}mm</div>
      <pre className="card" style={{ padding: 12, fontFamily: 'var(--num)', fontSize: 11, lineHeight: 1.42, whiteSpace: 'pre', overflowX: 'auto', margin: 0 }}>
        {receiptText(order, shopMeta, w)}
      </pre>
      <div className="split" style={{ marginTop: 10 }}>
        <button className="btn ghost sm2" style={{ height: 44 }} disabled={busy} onClick={btPrint}>
          {busy ? <Loader2 size={16} className="spin" /> : <Printer size={16} />} Máy in Bluetooth
        </button>
        <button className="btn ghost sm2" style={{ height: 44 }} onClick={async () => {
          try { await printRawBT(order, shopMeta, w, shopMeta.no_accent !== false); say('Đã gửi sang RawBT'); }
          catch (e) { say(e.message || 'Máy chưa cài RawBT'); }
        }}><Printer size={16} /> Gửi RawBT</button>
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        Máy in nhiệt T82 (80mm): ghép đôi Bluetooth trước rồi bấm “Máy in Bluetooth”. Nếu trình duyệt chặn, cài app RawBT rồi dùng nút bên cạnh — hoặc bấm “In” để in qua trình duyệt.
      </div>
    </>
  );
}

/* ───────────── DANH MỤC HÀNG XÁ (BÁN THEO KÍ / GRAM) ───────────── */

const PRESET_BULK_ITEMS = [
  { code: 'HX_banh_keo', name: 'Bánh kẹo / Bánh quy', price: 80000, unit: 'kg', cat: 'Bánh kẹo' },
  { code: 'HX_keo_deo', name: 'Kẹo dẻo các loại', price: 70000, unit: 'kg', cat: 'Bánh kẹo' },
  { code: 'HX_duong_cat', name: 'Đường cát / Đường trắng', price: 22000, unit: 'kg', cat: 'Gia vị' },
  { code: 'HX_duong_phen', name: 'Đường phèn / Đường thốt nốt', price: 45000, unit: 'kg', cat: 'Gia vị' },
  { code: 'HX_bot_ngot', name: 'Bột ngọt / Mì chính', price: 65000, unit: 'kg', cat: 'Gia vị' },
  { code: 'HX_ca_phe', name: 'Cà phê hạt / Cà phê xay', price: 160000, unit: 'kg', cat: 'Đồ uống' },
  { code: 'HX_muoi_an', name: 'Muối ăn / Muối hột', price: 10000, unit: 'kg', cat: 'Gia vị' },
  { code: 'HX_gao_te', name: 'Gạo tẻ / Gạo thơm', price: 20000, unit: 'kg', cat: 'Lương thực' },
  { code: 'HX_dau_xanh', name: 'Đậu xanh / Đậu đen / Đậu đỏ', price: 45000, unit: 'kg', cat: 'Nông sản' },
  { code: 'HX_hat_nem', name: 'Hạt nêm', price: 75000, unit: 'kg', cat: 'Gia vị' },
  { code: 'HX_tieu_xay', name: 'Tiêu xay / Tiêu hạt', price: 180000, unit: 'kg', cat: 'Gia vị' },
  { code: 'HX_ot_bot', name: 'Ớt bột / Gia vị kho', price: 90000, unit: 'kg', cat: 'Gia vị' },
  { code: 'HX_tom_kho', name: 'Tôm khô / Khô mực', price: 450000, unit: 'kg', cat: 'Đồ khô' },
  { code: 'HX_kho_ga', name: 'Khô gà lá chanh / Khô bò', price: 220000, unit: 'kg', cat: 'Đồ khô' },
  { code: 'HX_lap_xuong', name: 'Lạp xưởng / Chà bông', price: 180000, unit: 'kg', cat: 'Đồ khô' },
];

function BulkScreen({ ctx }) {
  const { shop, say } = ctx;
  const { products } = shop;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [calcItem, setCalcItem] = useState(null);
  const [editItem, setEditItem] = useState(null);

  // Tổng hợp danh sách hàng xá: hàng quầy đã lưu + mẫu mặc định
  const items = useMemo(() => {
    const map = new Map();
    PRESET_BULK_ITEMS.forEach((p) => {
      map.set(p.code, { ...p, isPreset: true, isSaved: false });
    });
    Object.values(products).forEach((p) => {
      if (p.unit === 'kg' || p.unit === 'g' || (p.code && p.code.startsWith('HX_'))) {
        const existing = map.get(p.code);
        map.set(p.code, {
          code: p.code,
          name: p.name,
          price: p.price || 0,
          cost: p.cost || 0,
          unit: p.unit || 'kg',
          cat: existing ? existing.cat : 'Tự lưu',
          isPreset: false,
          isSaved: true,
        });
      }
    });
    return Array.from(map.values());
  }, [products]);

  // Lọc theo từ khoá tìm kiếm & danh mục
  const filtered = useMemo(() => {
    let list = items;
    const query = norm(q.trim());
    if (query) {
      list = list.filter((it) => norm(it.name).includes(query) || (it.code && it.code.toLowerCase().includes(query)));
    }
    if (cat !== 'all') {
      if (cat === 'custom') list = list.filter((it) => it.isSaved);
      else list = list.filter((it) => it.cat === cat);
    }
    return list;
  }, [items, q, cat]);

  const exactMatch = useMemo(() => {
    const query = norm(q.trim());
    if (!query) return true;
    return items.some((it) => norm(it.name) === query);
  }, [items, q]);

  const categories = ['all', 'Bánh kẹo', 'Gia vị', 'Lương thực', 'Đồ khô', 'Đồ uống', 'Nông sản', 'custom'];

  return (
    <>
      <div className="body">
        <div className="pad">
          <div className="searchwrap">
            <Search size={19} className="sicon" />
            <input className="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm hoặc gõ tên hàng xá mới (bánh, kẹo, đường...)" />
            {q ? <button className="sclear" onClick={() => setQ('')}><X size={18} /></button> : null}
          </div>

          <div className="chips" style={{ marginTop: 10 }}>
            {categories.map((c) => {
              const label = c === 'all' ? 'Tất cả' : c === 'custom' ? 'Quầy đã lưu' : c;
              return (
                <button key={c} className={'chip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
                  {label}
                </button>
              );
            })}
          </div>

          {q.trim() && !exactMatch && (
            <button className="btn pay" style={{ width: '100%', marginTop: 10 }}
              onClick={() => setEditItem({ name: q.trim(), price: 0, cost: 0, unit: 'kg' })}>
              <Plus size={18} /> Thêm hàng xá mới: "{q.trim()}"
            </button>
          )}

          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 6 }}>
            <div className="eyebrow" style={{ margin: 0 }}>Danh mục Hàng xá ({filtered.length})</div>
            <button className="btn sm2 ghost" onClick={() => setEditItem({ name: '', price: 0, cost: 0, unit: 'kg' })}>
              <Plus size={15} /> Thêm loại mới
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              <Scale size={32} strokeWidth={1.3} />
              <h4>Không thấy hàng xá nào</h4>
              <div className="sm">Bấm nút trên để tạo loại hàng xá mới hoặc đổi từ khoá tìm kiếm.</div>
            </div>
          ) : (
            <div className="card">
              {filtered.map((it) => {
                const priceGram = Math.round(it.price / 1000);
                return (
                  <div key={it.code} className="item" style={{ alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setCalcItem(it)}>
                      <div className="nm">{it.name}</div>
                      <div className="mt row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <span className="badge ok">{money(it.price)} ₫/kg</span>
                        <span className="badge">{money(priceGram)} ₫/g</span>
                        {it.isSaved ? <span className="badge gold">đã lưu quầy</span> : <span className="badge">mẫu</span>}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flex: 'none' }}>
                      <button className="btn sm2 pay" onClick={() => setCalcItem(it)}>
                        <Scale size={15} /> Bán
                      </button>
                      <button className="iconbtn" style={{ background: '#F6F8F4', color: 'var(--ink)' }} onClick={() => setEditItem(it)} title="Sửa giá">
                        <Pencil size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {calcItem && <BulkCalcSheet item={calcItem} onClose={() => setCalcItem(null)} ctx={ctx} />}
      {editItem && <BulkEditSheet item={editItem} onClose={() => setEditItem(null)} shop={shop} say={say} />}
    </>
  );
}

function BulkCalcSheet({ item, onClose, ctx }) {
  const { addToCart, say } = ctx;
  const [unitPriceKg, setUnitPriceKg] = useState(String(item.price || ''));
  const [gramStr, setGramStr] = useState('250');
  const [kgStr, setKgStr] = useState('0.25');

  const pKg = Number(unitPriceKg) || 0;
  const pGram = Math.round(pKg / 1000);

  const handleGramChange = (v) => {
    const clean = v.replace(/\D/g, '');
    setGramStr(clean);
    const g = Number(clean) || 0;
    setKgStr(g ? String(Math.round((g / 1000) * 1000) / 1000) : '');
  };

  const handleKgChange = (v) => {
    const clean = v.replace(/[^0-9.]/g, '');
    setKgStr(clean);
    const k = Number(clean) || 0;
    setGramStr(k ? String(Math.round(k * 1000)) : '');
  };

  const setPresetWeight = (g) => {
    setGramStr(String(g));
    setKgStr(String(g / 1000));
  };

  const grams = Number(gramStr) || 0;
  const total = Math.round((grams / 1000) * pKg);

  const add = () => {
    if (grams <= 0 || pKg <= 0) return;
    const weightText = grams >= 1000 ? `${(grams / 1000).toLocaleString('vi-VN')} kg` : `${grams}g`;
    const rec = {
      code: item.code || ('HX_' + slug(item.name)),
      name: `${item.name} (${weightText})`,
      price: total,
      cost: item.cost ? Math.round((grams / 1000) * item.cost) : 0,
      unit: weightText,
    };
    addToCart(rec, 1);
    say(`Đã thêm ${rec.name} · ${moneyD(total)}`);
    onClose();
  };

  const weightPresets = [
    { g: 100, t: '100g' },
    { g: 200, t: '200g' },
    { g: 250, t: '250g' },
    { g: 300, t: '300g' },
    { g: 500, t: '500g (0.5kg)' },
    { g: 750, t: '750g' },
    { g: 1000, t: '1 kg' },
    { g: 1500, t: '1.5 kg' },
    { g: 2000, t: '2 kg' },
    { g: 3000, t: '3 kg' },
    { g: 5000, t: '5 kg' },
  ];

  return (
    <Sheet open onClose={onClose} title={`Tính tiền: ${item.name}`} icon={<Scale size={20} />}
      footer={
        <button className="btn pay" style={{ width: '100%' }} disabled={grams <= 0 || pKg <= 0} onClick={add}>
          <Check size={20} /> Thêm vào giỏ · {money(total)} ₫
        </button>
      }>

      {/* Đơn giá / kg */}
      <div className="card pad" style={{ marginBottom: 10 }}>
        <div className="lab">Đơn giá bán hiện tại</div>
        <div className="split" style={{ marginTop: 6 }}>
          <div>
            <div className="tiny muted">Giá 1 kg (₫/kg)</div>
            <input className="field num" inputMode="numeric" value={unitPriceKg}
              onChange={(e) => setUnitPriceKg(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <div className="tiny muted">Tương đương (₫/g)</div>
            <div className="field num" style={{ background: '#F6F8F4', display: 'flex', alignItems: 'center' }}>
              {money(pGram)} ₫/g
            </div>
          </div>
        </div>
      </div>

      {/* Nhập khối lượng gram hoặc kg */}
      <div className="lab" style={{ marginTop: 10 }}>Nhập khối lượng mua</div>
      <div className="split" style={{ marginTop: 4 }}>
        <div>
          <div className="tiny muted">Số Gram (g)</div>
          <input className="field num" inputMode="numeric" value={gramStr} onChange={(e) => handleGramChange(e.target.value)} placeholder="vd: 250" />
        </div>
        <div>
          <div className="tiny muted">Số Kí (kg)</div>
          <input className="field num" inputMode="decimal" value={kgStr} onChange={(e) => handleKgChange(e.target.value)} placeholder="vd: 0.25" />
        </div>
      </div>

      {/* Phím chọn nhanh khối lượng */}
      <div className="lab" style={{ marginTop: 12 }}>Chọn nhanh khối lượng cân</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 12 }}>
        {weightPresets.map((wp) => (
          <button key={wp.g} className={'btn sm2' + (grams === wp.g ? ' gold' : '')} onClick={() => setPresetWeight(wp.g)}>
            {wp.t}
          </button>
        ))}
      </div>

      {/* Màn hình LCD xem thành tiền */}
      <div className="lcd">
        <div className="lab">
          <span>Thành tiền</span>
          <span>{grams >= 1000 ? (grams / 1000) + ' kg' : grams + 'g'} × {money(pKg)}₫/kg</span>
        </div>
        <div className="big">{money(total)}<small>₫</small></div>
      </div>
    </Sheet>
  );
}

function BulkEditSheet({ item, onClose, shop, say }) {
  const [name, setName] = useState(item.name || '');
  const [priceKg, setPriceKg] = useState(String(item.price || ''));
  const [priceGram, setPriceGram] = useState(item.price ? String(Math.round(item.price / 1000 * 100) / 100) : '');
  const [costKg, setCostKg] = useState(item.cost ? String(item.cost) : '');
  const [busy, setBusy] = useState(false);

  const handlePriceKgChange = (v) => {
    const clean = v.replace(/\D/g, '');
    setPriceKg(clean);
    const pk = Number(clean) || 0;
    setPriceGram(pk ? String(Math.round((pk / 1000) * 100) / 100) : '');
  };

  const handlePriceGramChange = (v) => {
    const clean = v.replace(/[^0-9.]/g, '');
    setPriceGram(clean);
    const pg = Number(clean) || 0;
    setPriceKg(pg ? String(Math.round(pg * 1000)) : '');
  };

  const save = async () => {
    const pk = Number(priceKg) || 0;
    const ck = Number(costKg) || 0;
    if (!name.trim() || pk <= 0) return;
    setBusy(true);
    const rec = {
      code: item.code && item.isSaved ? item.code : ('HX_' + slug(name.trim()) + '_' + uid().slice(0, 4)),
      name: name.trim(),
      price: pk,
      cost: ck,
      unit: 'kg',
    };
    await shop.saveProduct(rec);
    say(`Đã lưu ${rec.name} · ${moneyD(pk)}/kg`);
    setBusy(false);
    onClose();
  };

  const quickPrices = [20000, 30000, 45000, 60000, 80000, 100000, 150000, 200000, 300000];

  return (
    <Sheet open onClose={onClose} title={item.code && item.isSaved ? 'Sửa giá hàng xá' : 'Thêm danh mục hàng xá mới'} icon={<Pencil size={20} />}
      footer={
        <div className="split">
          {item.isSaved ? (
            <button className="btn ghost" style={{ color: 'var(--pay)', borderColor: '#F1B9C5' }}
              onClick={async () => { await shop.removeProduct(item.code); say('Đã xoá ' + item.name); onClose(); }}>
              <Trash2 size={16} /> Xoá
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>Hủy</button>
          )}
          <button className="btn pay" disabled={!name.trim() || Number(priceKg) <= 0 || busy} onClick={save}>
            {busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />} Lưu & Nhớ giá
          </button>
        </div>
      }>

      <div className="lab">Tên loại hàng xá</div>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)}
        placeholder="vd: Đường cát, Bột sắn dây, Cà phê hạt..." autoCapitalize="words" />

      <div className="lab" style={{ marginTop: 12 }}>Đơn giá bán (Cho phép nhập theo kg hoặc gram)</div>
      <div className="split" style={{ marginTop: 4 }}>
        <div>
          <div className="tiny muted">Giá theo 1 KG (₫/kg)</div>
          <input className="field num" inputMode="numeric" value={priceKg} onChange={(e) => handlePriceKgChange(e.target.value)} placeholder="80000" />
        </div>
        <div>
          <div className="tiny muted">Giá theo 1 Gram (₫/g)</div>
          <input className="field num" inputMode="numeric" value={priceGram} onChange={(e) => handlePriceGramChange(e.target.value)} placeholder="80" />
        </div>
      </div>

      <div className="lab" style={{ marginTop: 10 }}>Chọn nhanh giá/kg mẫu</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 12 }}>
        {quickPrices.map((qp) => (
          <button key={qp} className={'btn sm2' + (Number(priceKg) === qp ? ' gold' : '')} onClick={() => handlePriceKgChange(String(qp))}>
            {money(qp)} ₫/kg
          </button>
        ))}
      </div>

      <div className="lab">Giá vốn 1 KG (Để tính lãi thật, không bắt buộc)</div>
      <input className="field num" inputMode="numeric" value={costKg} onChange={(e) => setCostKg(e.target.value.replace(/\D/g, ''))} placeholder="0" />

      <div className="banner info" style={{ marginTop: 12 }}>
        <Scale size={16} />
        <div className="tiny">Khi lưu, hàng này sẽ tự động lưu vào hệ thống. Lần sau gõ tên hoặc tìm kiếm sẽ hiện ngay với giá đã đặt.</div>
      </div>
    </Sheet>
  );
}

/* ───────────── màn hình HÀNG HOÁ ───────────── */

function GoodsScreen({ ctx }) {  // eslint-disable-line
  const { shop, cat, catRef, say, setSheet } = ctx;
  const { products, stock } = shop;
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [only, setOnly] = useState('all');

  const remainOf = useCallback((code) => (stock && stock[code] != null ? stock[code] : null), [stock]);

  const list = useMemo(() => {
    let arr = Object.values(products);
    if (q.trim().length >= 1) {
      const k = norm(q);
      arr = arr.filter((p) => norm(p.name).includes(k) || p.code.includes(q.trim()));
    }
    if (only === 'low') arr = arr.filter((p) => remainOf(p.code) != null && remainOf(p.code) <= 3);
    if (only === 'noprice') arr = arr.filter((p) => !p.price);
    return arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [products, q, only, remainOf]);

  return (
    <>
      <div className="body">
      <div className="pad">
        <div className="searchwrap">
          <Search size={19} className="sicon" />
          <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong hàng của quầy…" />
          {q ? <button className="sclear" onClick={() => setQ('')}><X size={18} /></button> : null}
        </div>
        <div className="chips" style={{ marginTop: 9 }}>
          <button className={'chip' + (only === 'all' ? ' on' : '')} onClick={() => setOnly('all')}>Tất cả · {Object.keys(products).length}</button>
          <button className={'chip' + (only === 'low' ? ' on' : '')} onClick={() => setOnly('low')}>Sắp hết</button>
          <button className={'chip' + (only === 'noprice' ? ' on' : '')} onClick={() => setOnly('noprice')}>Chưa có giá</button>
        </div>

        <div className="eyebrow">
          Hàng đã bán ở quầy{cat.ready ? ` · tra được ${nf.format(cat.count)} mã trong danh mục` : ''}
        </div>

        {list.length === 0 ? (
          <div className="empty">
            <Package size={30} strokeWidth={1.3} />
            <h4>Sổ hàng còn trống</h4>
            <div className="sm">Quét mã và đặt giá một lần — hàng tự vào sổ này, lần sau khỏi nhập lại.</div>
          </div>
        ) : (
          <div className="card">
            {list.map((p) => {
              const left = remainOf(p.code);
              return (
                <button key={p.code} className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => setEdit(p)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{p.name}</div>
                    <div className="mt row" style={{ gap: 6 }}>
                      <span className="num">{p.code}</span>
                      {p.cost > 0 ? <span className="badge">lãi {money(p.price - p.cost)}</span> : null}
                      {left != null ? <span className={'badge' + (left <= 3 ? ' red' : '')}>còn ~{left}</span> : null}
                    </div>
                  </div>
                  <div className="num" style={{ fontWeight: 700, fontSize: 15.5, color: p.price ? undefined : 'var(--pay)' }}>
                    {p.price ? money(p.price) : 'chưa giá'}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <button className="btn ghost" style={{ width: '100%', marginTop: 12 }}
          onClick={() => setSheet({ type: 'price', data: { code: 'T' + uid(), name: '', suggest: 0, isNew: true } })}>
          <Plus size={18} /> Thêm hàng không có mã vạch
        </button>
      </div>

      </div>
      {edit && <GoodEdit p={edit} onClose={() => setEdit(null)} shop={shop} say={say} left={remainOf(edit.code)} />}
    </>
  );
}

function GoodEdit({ p, onClose, shop, say, left }) {
  const [name, setName] = useState(p.name);
  const [price, setPrice] = useState(String(p.price || ''));
  const [cost, setCost] = useState(String(p.cost || ''));
  const [stock, setStock] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const rec = { ...p, name: name.trim() || p.name, price: Number(price) || 0, cost: Number(cost) || 0 };
    if (stock !== '') { rec.stockBase = Number(stock) || 0; rec.stockAt = Date.now(); }
    await shop.saveProduct(rec);
    say('Đã lưu ' + rec.name);
    setBusy(false); onClose();
  };

  return (
    <Sheet open onClose={onClose} title="Sửa mặt hàng" icon={<Package size={20} />}
      footer={<div className="split" style={{ gap: 8 }}>
        <button className="btn ghost" style={{ color: 'var(--pay)', borderColor: '#F1B9C5' }}
          onClick={async () => { await shop.removeProduct(p.code); say('Đã bỏ khỏi sổ hàng'); onClose(); }}><Trash2 size={18} /> Xoá</button>
        <button className="btn pay" disabled={busy} onClick={save}>{busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />} Lưu</button>
      </div>}>
      <div className="lab">Tên hàng</div>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="split" style={{ marginTop: 10 }}>
        <div><div className="lab">Giá bán</div>
          <input className="field num" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} /></div>
        <div><div className="lab">Giá vốn</div>
          <input className="field num" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} /></div>
      </div>
      <div className="eyebrow">Tồn kho (tuỳ chọn)</div>
      <div className="card pad">
        {left != null ? <div className="sm" style={{ marginBottom: 8 }}>Ước còn <b className="num">{left}</b> — tính từ lần cập nhật gần nhất trừ đi số đã bán.</div> : null}
        <div className="lab">Nhập số lượng đang có</div>
        <input className="field num" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} placeholder="ví dụ 24" />
        <div className="tiny muted" style={{ marginTop: 7 }}>Nên đếm và nhập vào đầu ngày. App tự trừ dần theo đơn bán của cả hai máy.</div>
      </div>
      <div className="tiny muted" style={{ marginTop: 10 }}>Mã: <span className="num">{p.code}</span>{p.by ? ` · ${p.by} sửa lần cuối` : ''}</div>
    </Sheet>
  );
}

/* ───────────── màn hình NỢ ───────────── */

function DebtScreen({ ctx }) {
  const { shop, say } = ctx;
  const { debts } = shop;
  const [open, setOpen] = useState(null);
  const [pay, setPay] = useState('');
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ customer: '', amount: '', note: '' });

  const byCust = useMemo(() => {
    const m = {};
    debts.forEach((d) => {
      const k = d.customer || 'Khách lạ';
      const t = m[k] || (m[k] = { customer: k, bal: 0, items: [] });
      t.bal += Number(d.amount) || 0; t.items.push(d);
    });
    return Object.values(m).sort((a, b) => b.bal - a.bal);
  }, [debts]);

  const totalDebt = byCust.reduce((s, c) => s + Math.max(0, c.bal), 0);

  return (
    <>
      <div className="body">
      <div className="pad">
        <div className="lcd">
          <div className="lab"><span>Khách đang nợ</span><span>{byCust.filter((c) => c.bal > 0).length} người</span></div>
          <div className="big">{money(totalDebt)}<small>₫</small></div>
        </div>
        <button className="btn dark" style={{ width: '100%', marginTop: 10 }} onClick={() => setAdding(true)}><Plus size={18} /> Ghi nợ tay</button>

        <div className="eyebrow">Sổ nợ</div>
        {byCust.length === 0 ? (
          <div className="empty"><Wallet size={30} strokeWidth={1.3} /><h4>Chưa ai nợ</h4><div className="sm">Khi tính tiền, bật “Ghi sổ nợ” là khách vào đây.</div></div>
        ) : (
          <div className="card">
            {byCust.map((c) => (
              <button key={c.customer} className="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => { setOpen(c); setPay(''); }}>
                <div style={{ flex: 1 }}>
                  <div className="nm">{c.customer}</div>
                  <div className="mt">{c.items.length} lần ghi · gần nhất {shortDate(dayKey(new Date(c.items[0].ts)))}</div>
                </div>
                <div className="num" style={{ fontWeight: 700, color: c.bal > 0 ? 'var(--pay)' : 'var(--ok)' }}>{money(c.bal)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>

      {adding && (
        <Sheet open onClose={() => setAdding(false)} title="Ghi nợ tay" icon={<Wallet size={20} />}
          footer={<button className="btn pay" style={{ width: '100%' }} disabled={!nc.customer.trim() || !Number(nc.amount)}
            onClick={async () => { await shop.addDebt({ customer: nc.customer.trim(), amount: Number(nc.amount), note: nc.note }); setNc({ customer: '', amount: '', note: '' }); setAdding(false); say('Đã ghi vào sổ nợ'); }}>
            <Check size={18} /> Ghi vào sổ</button>}>
          <div className="lab">Tên khách</div>
          <input className="field" value={nc.customer} onChange={(e) => setNc({ ...nc, customer: e.target.value })} placeholder="Chú Tám" />
          <div className="lab" style={{ marginTop: 10 }}>Số tiền nợ thêm</div>
          <input className="field num" inputMode="numeric" value={nc.amount} onChange={(e) => setNc({ ...nc, amount: e.target.value.replace(/\D/g, '') })} />
          <div className="lab" style={{ marginTop: 10 }}>Ghi chú</div>
          <input className="field" value={nc.note} onChange={(e) => setNc({ ...nc, note: e.target.value })} placeholder="Mua thiếu 2 thùng bia" />
        </Sheet>
      )}

      {open && (
        <Sheet open onClose={() => setOpen(null)} title={open.customer} icon={<Wallet size={20} />}
          footer={<button className="btn pay" style={{ width: '100%' }} disabled={!Number(pay)}
            onClick={async () => { await shop.addDebt({ customer: open.customer, amount: -Math.abs(Number(pay)), note: 'Khách trả tiền' }); setOpen(null); say(`${open.customer} đã trả ${moneyD(pay)}`); }}>
            <Check size={18} /> Khách trả {pay ? moneyD(pay) : ''}</button>}>
          <div className="lcd" style={{ marginBottom: 12 }}>
            <div className="lab"><span>Còn nợ</span><span>{open.customer}</span></div>
            <div className="big">{money(open.bal)}<small>₫</small></div>
          </div>
          <div className="lab">Khách trả bao nhiêu</div>
          <input className="field num" inputMode="numeric" value={pay} onChange={(e) => setPay(e.target.value.replace(/\D/g, ''))} placeholder="0" />
          <div className="chips" style={{ marginTop: 8 }}>
            <button className="chip" onClick={() => setPay(String(Math.max(0, open.bal)))}>Trả hết {money(Math.max(0, open.bal))}</button>
            {[50000, 100000, 200000].map((v) => <button key={v} className="chip" onClick={() => setPay(String(v))}>{money(v)}</button>)}
          </div>
          <div className="eyebrow">Lịch sử</div>
          <div className="card">
            {open.items.map((d) => (
              <div className="item" key={d.id}>
                <div style={{ flex: 1 }}>
                  <div className="nm">{d.note || (d.amount < 0 ? 'Khách trả tiền' : 'Mua hàng ghi sổ')}</div>
                  <div className="mt">{shortDate(dayKey(new Date(d.ts)))} {clock(d.ts)} · {d.by}</div>
                </div>
                <div className="num" style={{ fontWeight: 700, color: d.amount < 0 ? 'var(--ok)' : 'var(--ink)' }}>
                  {d.amount < 0 ? '−' : '+'}{money(Math.abs(d.amount))}
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}


/* ───────────── màn hình SỐ LIỆU ───────────── */

function download(name, text) {
  try {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return true;
  } catch { return false; }
}

function StatsScreen({ ctx }) {
  const { shop, say } = ctx;
  const {
    sums, topItems, orders, viewDay, viewMonth, setViewMonth, range, setRange,
    customFrom, setCustomFrom, customTo, setCustomTo,
  } = shop;
  const today = dayKey();
  const data = sums[viewMonth] || {};

  const dayRange = (a, b) => {
    const out = []; let d = a;
    for (let i = 0; i < 370 && d <= b; i++) { out.push(d); d = addDays(d, 1); }
    return out;
  };

  const days = useMemo(() => {
    if (range === 'day') return [today];
    if (range === 'last7') return Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
    if (range === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(today), i)).filter((d) => d <= today);
    if (range === 'custom') {
      const a = customFrom <= customTo ? customFrom : customTo;
      const b = customFrom <= customTo ? customTo : customFrom;
      return dayRange(a, b);
    }
    const [y, m] = viewMonth.split('-').map(Number);
    const n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => `${viewMonth}-${pad(i + 1)}`).filter((d) => d <= today || viewMonth < monthKey(today));
  }, [range, viewMonth, today, customFrom, customTo]);

  const agg = useMemo(() => {
    let rev = 0, cost = 0, cnt = 0;
    days.forEach((d) => { const v = data[d]; if (v) { rev += v.rev; cost += v.cost; cnt += v.cnt; } });
    return { rev, cost, cnt };
  }, [days, data]);

  const chart = days.map((d) => ({ d: `${dowOf(d)} ${shortDate(d)}`, rev: (data[d] && data[d].rev) || 0 }));
  const profit = agg.rev - agg.cost;
  const soldQty = topItems.reduce((s, t) => s + t.qty, 0);
  const label = range === 'day' ? 'Hôm nay' : range === 'week' ? 'Tuần này' : range === 'last7' ? '7 ngày qua'
    : range === 'custom' ? `${shortDate(days[0] || customFrom)} – ${shortDate(days[days.length - 1] || customTo)}`
    : 'Tháng ' + viewMonth.slice(5) + '/' + viewMonth.slice(0, 4);

  const bySeller = useMemo(() => {
    const m = {};
    orders.filter((o) => !o.void).forEach((o) => { m[o.seller] = (m[o.seller] || 0) + o.total; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const exportCsv = () => {
    const rows = [['Ngày', 'Thứ', 'Doanh thu', 'Giá vốn', 'Lãi gộp', 'Số đơn']];
    days.forEach((d) => { const v = data[d] || {}; rows.push([d, dowOf(d), v.rev || 0, v.cost || 0, (v.rev || 0) - (v.cost || 0), v.cnt || 0]); });
    rows.push(['TỔNG', '', agg.rev, agg.cost, profit, agg.cnt]);
    rows.push([]); rows.push(['Mã hàng', 'Tên hàng', 'Số lượng', 'Doanh thu']);
    topItems.forEach((t) => rows.push([t.code, t.name, t.qty, t.revenue]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    say(download(`doanhthu-${viewMonth}.csv`, csv) ? 'Đã tải file doanh thu' : 'Máy không cho tải file');
  };

  const shiftMonth = (n) => {
    const [y, m] = viewMonth.split('-').map(Number);
    const t = new Date(y, m - 1 + n, 1);
    setViewMonth(`${t.getFullYear()}-${pad(t.getMonth() + 1)}`);
  };

  return (
    <div className="body">
      <div className="pad">
        <div className="chips">
          {[['day', 'Hôm nay'], ['week', 'Tuần này'], ['last7', '7 ngày'], ['month', 'Tháng'], ['custom', 'Tự chọn mốc']].map(([k, t]) => (
            <button key={k} className={'chip' + (range === k ? ' on' : '')} onClick={() => setRange(k)}>{t}</button>
          ))}
        </div>

        {range === 'custom' && (
          <div className="card pad" style={{ marginTop: 10 }}>
            <div className="split">
              <div>
                <div className="lab">Từ ngày</div>
                <input className="field" type="date" value={customFrom} max={customTo}
                  onChange={(e) => e.target.value && setCustomFrom(e.target.value)} />
              </div>
              <div>
                <div className="lab">Đến ngày</div>
                <input className="field" type="date" value={customTo} min={customFrom} max={today}
                  onChange={(e) => e.target.value && setCustomTo(e.target.value)} />
              </div>
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {[[7, '7 ngày'], [14, '14 ngày'], [30, '30 ngày'], [90, '3 tháng']].map(([n, t]) => (
                <button key={n} className="chip" onClick={() => { setCustomFrom(addDays(today, -(n - 1))); setCustomTo(today); }}>{t} gần nhất</button>
              ))}
            </div>
            {days.length > 92 ? <div className="tiny muted" style={{ marginTop: 8 }}>Khoảng {days.length} ngày — biểu đồ sẽ hơi dày, vẫn xem được bảng số và xuất CSV bình thường.</div> : null}
          </div>
        )}

        <div className="lcd" style={{ marginTop: 12 }}>
          <div className="lab"><span>Doanh thu · {label}</span><span>{agg.cnt} đơn</span></div>
          <div className="big">{money(agg.rev)}<small>₫</small></div>
        </div>

        <div className="split3" style={{ marginTop: 10 }}>
          <div className="card pad" style={{ textAlign: 'center' }}>
            <div className="tiny muted">Lãi gộp</div>
            <div className="num" style={{ fontWeight: 700, fontSize: 17, color: profit > 0 ? 'var(--ok)' : 'var(--muted)' }}>{money(profit)}</div>
          </div>
          <div className="card pad" style={{ textAlign: 'center' }}>
            <div className="tiny muted">Mỗi đơn</div>
            <div className="num" style={{ fontWeight: 700, fontSize: 17 }}>{money(agg.cnt ? agg.rev / agg.cnt : 0)}</div>
          </div>
          <div className="card pad" style={{ textAlign: 'center' }}>
            <div className="tiny muted">Món bán ra</div>
            <div className="num" style={{ fontWeight: 700, fontSize: 17 }}>{nf.format(soldQty)}</div>
          </div>
        </div>
        {agg.cost === 0 && agg.rev > 0 ? <div className="tiny muted" style={{ margin: '8px 3px 0' }}>Nhập giá vốn cho hàng để thấy lãi thật.</div> : null}

        {range === 'month' && (
          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <button className="chip" onClick={() => shiftMonth(-1)}>← Tháng trước</button>
            <span className="sm num">{viewMonth}</span>
            <button className="chip" onClick={() => shiftMonth(1)} disabled={viewMonth >= monthKey(today)}>Tháng sau →</button>
          </div>
        )}

        <div className="eyebrow">Doanh thu từng ngày</div>
        <div className="card" style={{ padding: '12px 6px 6px', height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="#E3E8DE" />
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#6C7A70' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#6C7A70' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => (v >= 1000000 ? (v / 1000000).toFixed(1) + 'tr' : v >= 1000 ? Math.round(v / 1000) + 'k' : v)} />
              <Tooltip formatter={(v) => moneyD(v)} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #DEE4D9' }} />
              <Bar dataKey="rev" fill="#C21E3A" radius={[5, 5, 0, 0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {bySeller.length > 0 && (
          <>
            <div className="eyebrow">Ai bán bao nhiêu · ngày {viewDay === today ? 'hôm nay' : shortDate(viewDay)}</div>
            <div className="card">
              {bySeller.map(([s, v]) => (
                <div className="item" key={s}>
                  <div style={{ flex: 1 }}><div className="nm">{s}</div></div>
                  <div className="num" style={{ fontWeight: 700 }}>{money(v)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="eyebrow">Bán chạy nhất · {label}</div>
        {topItems.length === 0 ? (
          <div className="empty"><TrendingUp size={28} strokeWidth={1.3} /><h4>Chưa có số liệu</h4><div className="sm">Bán vài đơn là bảng này có ngay.</div></div>
        ) : (
          <div className="card">
            {topItems.map((t, i) => (
              <div className="item" key={t.code + i}>
                <div className="num muted" style={{ width: 20, fontWeight: 700 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div className="nm">{t.name}</div><div className="mt num">{t.code}</div></div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontWeight: 700 }}>{t.qty}</div>
                  <div className="tiny muted num">{money(t.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="btn ghost" style={{ width: '100%', margin: '12px 0 4px' }} onClick={exportCsv}>
          <Download size={18} /> Tải bảng kê CSV
        </button>
      </div>
    </div>
  );
}

/* ───────────── CÀI ĐẶT ───────────── */

function SettingsSheet({ ctx, onClose, onExit, onSignOut }) {
  const { shop, cat, say, loadCatalog, shopMeta } = ctx;
  const [m, setM] = useState({ ...shopMeta });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const [aiKey, setAiKey] = useState('');
  const [aiKeySaved, setAiKeySaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { value } = await Preferences.get({ key: 'gemini.app_key' });
        if (value && value.trim()) { setAiKey(value.trim()); return; }
      } catch { /* thử localStorage */ }
      try {
        const v = localStorage.getItem('gemini.app_key');
        if (v && v.trim()) setAiKey(v.trim());
      } catch { /* bỏ qua */ }
    })();
  }, []);

  const saveKey = async () => {
    await saveAiKey(aiKey);
    setAiKeySaved(true);
    say('Đã lưu khoá AI');
    setTimeout(() => setAiKeySaved(false), 2000);
  };

  const save = async () => {
    setBusy(true);
    await shop.saveMeta(m);
    setBusy(false); say('Đã lưu cài đặt');
  };

  return (
    <Sheet open onClose={onClose} title="Cài đặt cửa hàng" icon={<Settings size={20} />} wide
      footer={<button className="btn pay" style={{ width: '100%' }} disabled={busy} onClick={save}>
        {busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />} Lưu cài đặt</button>}>

      <div className="eyebrow">Thông tin in trên bill</div>
      <div className="card pad">
        <div className="lab">Tên cửa hàng</div>
        <input className="field" value={m.name || ''} onChange={(e) => setM({ ...m, name: e.target.value })} />
        <div className="lab" style={{ marginTop: 10 }}>Địa chỉ</div>
        <input className="field" value={m.addr || ''} onChange={(e) => setM({ ...m, addr: e.target.value })} placeholder="123 Lê Lợi, Cao Lãnh" />
        <div className="lab" style={{ marginTop: 10 }}>Điện thoại</div>
        <input className="field num" value={m.phone || ''} onChange={(e) => setM({ ...m, phone: e.target.value })} placeholder="0909…" />
      </div>

      <div className="eyebrow">Máy in</div>
      <div className="card pad">
        <div className="lab">Khổ giấy</div>
        <div className="chips">
          {[[80, '80mm (T82)'], [58, '58mm (máy bỏ túi)']].map(([v, t]) => (
            <button key={v} className={'chip' + ((m.paper || 80) === v ? ' on' : '')} onClick={() => setM({ ...m, paper: v })}>{t}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <div className="sm" style={{ fontWeight: 600 }}>Bỏ dấu tiếng Việt khi in</div>
            <div className="tiny muted">Bật nếu máy in ra chữ ô vuông.</div>
          </div>
          <button className={'chip' + (m.noAccent !== false ? ' on' : '')} onClick={() => setM({ ...m, noAccent: m.noAccent === false })}>
            {m.noAccent !== false ? 'Đang bật' : 'Đang tắt'}
          </button>
        </div>
      </div>

      <div className="eyebrow">Trợ lý AI (Google Gemini)</div>
      <div className="card pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="sm" style={{ fontWeight: 600 }}>Bật trợ lý</div>
            <div className="tiny muted">Chụp ảnh món hàng chưa có mã, và đọc ảnh đơn viết tay/in.</div>
          </div>
          <button className={'chip' + (m.aiOn !== false ? ' on' : '')} onClick={() => setM({ ...m, aiOn: m.aiOn === false })}>
            {m.aiOn !== false ? 'Bật' : 'Tắt'}
          </button>
        </div>
        <div className={aiReady() ? 'banner ok' : 'banner warn'} style={{ marginBottom: 10 }}>
          {aiReady() ? <Check size={17} /> : <AlertTriangle size={17} />}
          <div>{aiReady() ? 'Đã kết nối cổng AI — sẵn sàng dùng.' : 'Chưa có khoá AI — nhập bên dưới để bật.'}</div>
        </div>
        <div className="lab">Khoá bí mật AI (GEMINI_APP_KEY)</div>
        <div className="row" style={{ gap: 8 }}>
          <input className="field" style={{ flex: 1, fontFamily: 'var(--num)', fontSize: 13 }}
            value={aiKey} onChange={(e) => setAiKey(e.target.value)}
            placeholder="Nhập khoá TAPHOA_KEY đã đặt trên Worker…"
            autoCapitalize="none" autoCorrect="off" />
          <button className={'btn sm2' + (aiKeySaved ? ' gold' : '')} style={{ flex: 'none', height: 48 }} onClick={saveKey}>
            {aiKeySaved ? <Check size={16} /> : 'Lưu'}
          </button>
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          Khoá này phải khớp với <b>TAPHOA_KEY</b> đã đặt trên Cloudflare Worker. Lưu xong thì AI dùng được ngay, không cần build lại.
        </div>
      </div>

      <div className="eyebrow">Danh mục hàng hoá</div>
      <div className="card pad">
        {cat.ready
          ? <div className="banner info" style={{ marginBottom: 10 }}><Check size={17} /><div>Đang tra được <b>{nf.format(cat.count)}</b> mã hàng, không cần mạng.</div></div>
          : <div className="banner warn" style={{ marginBottom: 10 }}><AlertTriangle size={17} /><div>{cat.note || 'Chưa mở được danh mục.'}</div></div>}
        {cat.loading && <div className="progress" style={{ marginBottom: 8 }}><i style={{ width: cat.progress + '%' }} /></div>}
        <div className="split">
          <button className="btn ghost sm2" style={{ height: 44 }} disabled={cat.loading} onClick={() => loadCatalog()}>
            <RefreshCw size={17} /> Mở lại
          </button>
          <button className="btn ghost sm2" style={{ height: 44 }} disabled={cat.loading} onClick={() => fileRef.current && fileRef.current.click()}>
            <Upload size={17} /> Nạp tệp khác
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".gz,.tsv,.csv,.txt" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) loadCatalog(f); }} />
        <div className="tiny muted" style={{ marginTop: 8 }}>Danh mục đóng gói sẵn trong app. Có bảng giá mới thì nạp tệp .tsv.gz để thay.</div>
      </div>

      <div className="eyebrow">Người bán đang online</div>
      <div className="card">
        {shop.live.length === 0 ? <div className="item"><span className="sm muted">Chỉ mình bạn</span></div> :
          shop.live.map((l, i) => (
            <div className="item" key={l.name + i}>
              <Users size={17} className="muted" />
              <div style={{ flex: 1 }}><div className="nm">{l.name}</div></div>
              <span className="badge ok">đang bán</span>
            </div>
          ))}
      </div>

      <div className="eyebrow">Mã mời máy thứ hai</div>
      <div className="card pad">
        <div className="num" style={{ fontWeight: 700, fontSize: 18, wordBreak: 'break-all' }}>{shopMeta.join_code}</div>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Máy thứ hai dùng chung tài khoản thì mở app là thấy quầy. Nếu muốn tài khoản riêng, đưa mã này + PIN cho họ chọn “Vào quầy có sẵn”.
        </div>
        <button className="btn ghost sm2" style={{ width: '100%', marginTop: 10 }}
          onClick={async () => { try { await navigator.clipboard.writeText(shopMeta.join_code); say('Đã chép mã mời'); } catch { say(shopMeta.join_code); } }}>
          Chép mã mời
        </button>
      </div>

      <div className="eyebrow">Tác giả & Phát triển</div>
      <div className="card pad" style={{ background: 'linear-gradient(135deg, #161A17, #242C26)', color: '#fff', border: 'none' }}>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--gold)', display: 'grid', placeItems: 'center', flex: 'none', color: '#1A2614', fontWeight: 800, fontSize: 19 }}>
            T
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>Timon (ut)</div>
            <div className="num" style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--gold)', marginTop: 2 }}>📞 0946 296 269</div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: '#A8BE85', marginTop: 8, fontStyle: 'italic' }}>
          "người đi tìm giải pháp bán hàng cho bạn !"
        </div>
      </div>

      <div className="split" style={{ marginTop: 14 }}>
        <button className="btn ghost" onClick={onExit}><LogOut size={18} /> Đổi người bán</button>
        <button className="btn ghost" style={{ color: 'var(--pay)', borderColor: '#F1B9C5' }} onClick={onSignOut}>
          <LogOut size={18} /> Thoát tài khoản
        </button>
      </div>
      <div className="tiny muted" style={{ textAlign: 'center', margin: '14px 0 4px' }}>
        Sổ tay bán hàng · Phát triển bởi Timon (ut) - 0946 296 269
      </div>
    </Sheet>
  );
}
