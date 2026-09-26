/* Kho dữ liệu của quầy: Supabase + đồng bộ tức thì (realtime) + bán được khi mất mạng.
   Giữ nguyên hình dạng dữ liệu như bản đã kiểm thử để các màn hình dùng lại không phải sửa. */
import { useState, useEffect, useRef, useCallback } from 'react';
import { sb } from './db.js';
import { queueAdd, queueFlush, queueGet, cacheGet, cacheSet } from './db.js';
import { dayKey, monthKey, addDays, uid, slug } from './util.js';

const rowToProduct = (r) => ({
  code: r.code, name: r.name, price: Number(r.price) || 0, cost: Number(r.cost) || 0,
  unit: r.unit || '', stockBase: r.stock_base, stockAt: r.stock_at ? Date.parse(r.stock_at) : undefined,
  updatedAt: r.updated_at ? Date.parse(r.updated_at) : 0, by: r.updated_by || '',
});
const productToRow = (shopId, p) => ({
  shop_id: shopId, code: p.code, name: p.name, price: Math.round(p.price || 0),
  cost: Math.round(p.cost || 0), unit: p.unit || '',
  stock_base: p.stockBase == null ? null : Math.round(p.stockBase),
  stock_at: p.stockAt ? new Date(p.stockAt).toISOString() : null,
  updated_at: new Date().toISOString(), updated_by: p.by || '',
});
const rowToOrder = (r) => ({
  id: r.id, ts: Date.parse(r.ts), day: r.day, seller: r.seller, items: r.items || [],
  gross: Number(r.gross) || 0, discount: Number(r.discount) || 0, total: Number(r.total) || 0,
  paid: Number(r.paid) || 0, change: Number(r.change) || 0, debt: !!r.is_debt,
  customer: r.customer || '', note: r.note || '', void: !!r.voided,
});
const orderToRow = (shopId, o) => ({
  id: o.id, shop_id: shopId, day: o.day, ts: new Date(o.ts).toISOString(), seller: o.seller,
  items: o.items, gross: o.gross, discount: o.discount, total: o.total, paid: o.paid,
  change: o.change, is_debt: !!o.debt, customer: o.customer || '', note: o.note || '',
  voided: !!o.void, voided_at: o.void ? new Date(o.voidAt || Date.now()).toISOString() : null,
});

export function useShop(session) {
  const shopId = session ? session.shop.id : '';
  const ME = session ? session.seller : '';

  const [meta, setMeta] = useState(session ? session.shop : null);
  const [products, setProducts] = useState({});
  const [orders, setOrders] = useState([]);
  const [sums, setSums] = useState({});          // "YYYY-MM" → { ngày: {rev,cost,cnt} }
  const [topItems, setTopItems] = useState([]);
  const [stock, setStock] = useState({});        // code → số còn ước tính
  const [debts, setDebts] = useState([]);
  const [live, setLive] = useState([]);
  const [viewDay, setViewDay] = useState(dayKey());
  const [viewMonth, setViewMonth] = useState(monthKey(dayKey()));
  const [range, setRange] = useState('week');    // day | week | last7 | month | custom
  const [customFrom, setCustomFrom] = useState(addDays(dayKey(), -13));
  const [customTo, setCustomTo] = useState(dayKey());
  const [sync, setSync] = useState({ busy: false, at: 0, ok: true, msg: '' });
  const [queue, setQueue] = useState(0);
  const chanRef = useRef(null);
  const todayRef = useRef(dayKey());
  const lastPullRef = useRef(0);

  /* ── ghi: thử lên mạng, hỏng thì bỏ vào hàng đợi, giao diện vẫn chạy ── */
  const push = useCallback(async (job, apply) => {
    apply && apply();
    try {
      const c = sb();
      if (job.t === 'order') await c.from('orders').upsert(job.d).throwOnError();
      else if (job.t === 'product') await c.from('products').upsert(job.d).throwOnError();
      else if (job.t === 'debt') await c.from('debts').insert(job.d).throwOnError();
      else if (job.t === 'delproduct') await c.from('products').delete().eq('shop_id', job.d.shop_id).eq('code', job.d.code).throwOnError();
      else if (job.t === 'shop') await c.from('shops').update(job.d).eq('id', job.id).throwOnError();
      setSync((s) => ({ ...s, ok: true, msg: '', at: Date.now() }));
      const left = await queueFlush(); setQueue(left);
    } catch (e) {
      const n = await queueAdd(job); setQueue(n);
      setSync((s) => ({ ...s, ok: false, msg: 'Chưa gửi lên được — đã lưu, có sóng sẽ tự đẩy' }));
    }
  }, []);

  /* ── đọc ── */
  const pullProducts = useCallback(async () => {
    const { data, error } = await sb().from('products').select('*').eq('shop_id', shopId);
    if (error) throw error;
    const m = {}; (data || []).forEach((r) => { m[r.code] = rowToProduct(r); });
    setProducts(m); cacheSet('prod:' + shopId, m);
  }, [shopId]);

  const pullOrders = useCallback(async (day) => {
    const { data, error } = await sb().from('orders').select('*')
      .eq('shop_id', shopId).eq('day', day).order('ts', { ascending: false });
    if (error) throw error;
    const list = (data || []).map(rowToOrder);
    setOrders(list); cacheSet(`ord:${shopId}:${day}`, list);
  }, [shopId]);

  const rangeDays = useCallback((r, mon) => {
    const today = dayKey();
    if (r === 'day') return [today, today];
    if (r === 'last7') return [addDays(today, -6), today];
    if (r === 'week') { const [y, m, d] = today.split('-').map(Number); const w = (new Date(y, m - 1, d).getDay() + 6) % 7; return [addDays(today, -w), today]; }
    if (r === 'custom') {
      const a = customFrom <= customTo ? customFrom : customTo;
      const b = customFrom <= customTo ? customTo : customFrom;
      return [a, b];
    }
    const [y, m] = mon.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return [`${mon}-01`, `${mon}-${String(last).padStart(2, '0')}`];
  }, [customFrom, customTo]);

  const pullStats = useCallback(async (r, mon) => {
    const [from, to] = rangeDays(r, mon);
    const c = sb();
    const [d1, d2] = await Promise.all([
      c.rpc('shop_daily', { p_shop: shopId, p_from: from, p_to: to }),
      c.rpc('shop_top_items', { p_shop: shopId, p_from: from, p_to: to, p_limit: 15 }),
    ]);
    if (d1.error) throw d1.error;
    const byDay = {};
    (d1.data || []).forEach((x) => { byDay[x.day] = { rev: Number(x.rev) || 0, cost: Number(x.cost) || 0, cnt: Number(x.cnt) || 0 }; });
    setSums((s) => ({ ...s, [mon]: byDay, _range: byDay }));
    setTopItems((d2.data || []).map((x) => ({ code: x.code, name: x.name, qty: Number(x.qty) || 0, revenue: Number(x.revenue) || 0 })));
    cacheSet(`stats:${shopId}:${r}:${mon}`, { byDay, top: d2.data || [] });
  }, [shopId, rangeDays]);

  const pullDebts = useCallback(async () => {
    const { data, error } = await sb().from('debts').select('*')
      .eq('shop_id', shopId).order('ts', { ascending: false }).limit(1000);
    if (error) throw error;
    const list = (data || []).map((r) => ({ id: r.id, ts: Date.parse(r.ts), customer: r.customer, amount: Number(r.amount) || 0, note: r.note || '', by: r.by_name || '', orderId: r.order_id }));
    setDebts(list); cacheSet('debt:' + shopId, list);
  }, [shopId]);

  const pullStock = useCallback(async () => {
    const { data } = await sb().rpc('shop_stock', { p_shop: shopId });
    const m = {}; (data || []).forEach((x) => { m[x.code] = Number(x.remain); });
    setStock(m);
  }, [shopId]);

  const pull = useCallback(async (opts = {}) => {
    if (!shopId) return;
    setSync((s) => ({ ...s, busy: true }));
    try {
      await Promise.all([
        pullProducts(),
        pullOrders(opts.day || viewDay),
        pullStats(opts.range || range, opts.month || viewMonth),
        pullDebts(),
        pullStock(),
      ]);
      const left = await queueFlush(); setQueue(left);
      lastPullRef.current = Date.now();
      setSync({ busy: false, at: Date.now(), ok: true, msg: '' });
    } catch (e) {
      setSync({ busy: false, at: Date.now(), ok: false, msg: 'Mất mạng — đang xem số liệu lưu trên máy' });
    }
  }, [shopId, viewDay, viewMonth, range, pullProducts, pullOrders, pullStats, pullDebts, pullStock]);

  /** Làm mới có tiết chế — bấm thẻ liên tục cũng chỉ gọi tối đa 3 giây một lần. */
  const refresh = useCallback(async (force) => {
    if (!force && Date.now() - lastPullRef.current < 3000) return;
    await pull();
  }, [pull]);

  /* ── mở app: lấy bộ nhớ đệm ra trước cho nhanh, rồi mới tải mạng ── */
  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    (async () => {
      const [p, o, d, q] = await Promise.all([
        cacheGet('prod:' + shopId), cacheGet(`ord:${shopId}:${dayKey()}`), cacheGet('debt:' + shopId), queueGet(),
      ]);
      if (!alive) return;
      if (p) setProducts(p);
      if (o) setOrders(o);
      if (d) setDebts(d);
      setQueue((q || []).length);
      pull();
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  useEffect(() => { if (shopId) pullOrders(viewDay).catch(() => {}); }, [viewDay, shopId, pullOrders]);
  useEffect(() => { if (shopId) pullStats(range, viewMonth).catch(() => {}); }, [range, viewMonth, customFrom, customTo, shopId, pullStats]);

  /* ── đồng bộ tức thì giữa hai máy + hiện ai đang bán ── */
  useEffect(() => {
    if (!shopId || !ME) return;
    let ch;
    try {
      ch = sb().channel('shop:' + shopId, { config: { presence: { key: slug(ME) + '-' + uid() } } })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'shop_id=eq.' + shopId },
          () => { pullOrders(viewDay).catch(() => {}); pullStats(range, viewMonth).catch(() => {}); pullStock().catch(() => {}); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: 'shop_id=eq.' + shopId },
          () => pullProducts().catch(() => {}))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'debts', filter: 'shop_id=eq.' + shopId },
          () => pullDebts().catch(() => {}))
        .on('presence', { event: 'sync' }, () => {
          const st = ch.presenceState();
          const names = [];
          Object.values(st).forEach((arr) => arr.forEach((x) => { if (x.name) names.push({ name: x.name, ts: x.at }); }));
          setLive(names);
        })
        .subscribe(async (s) => { if (s === 'SUBSCRIBED') await ch.track({ name: ME, at: Date.now() }); });
      chanRef.current = ch;
    } catch { /* chưa cấu hình thì thôi */ }
    return () => { try { ch && sb().removeChannel(ch); } catch { /* bỏ qua */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, ME]);

  /* ── nhịp nền: đẩy hàng đợi, sang ngày mới thì nhảy sổ ── */
  const beat = useCallback(async () => {
    const now = dayKey();
    if (now !== todayRef.current) {
      if (viewDay === todayRef.current) { setViewDay(now); setViewMonth(monthKey(now)); }
      todayRef.current = now;
    }
    const left = await queueFlush(); setQueue(left);
    if (left === 0) setSync((s) => (s.ok ? s : { ...s, ok: true, msg: '' }));
    // Realtime im quá lâu (mạng yếu, websocket bị chặn) → tự tải lại cho chắc
    if (Date.now() - lastPullRef.current > 45000) await pull();
  }, [viewDay, pull]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) beat(); }, 12000);
    const onVis = () => { if (!document.hidden) { beat(); pull(); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onVis); };
  }, [beat, pull]);

  /* ── các thao tác ── */
  const saveProduct = useCallback(async (p) => {
    const rec = { ...p, updatedAt: Date.now(), by: ME };
    const row = productToRow(shopId, rec);
    await push({ t: 'product', k: 'p:' + p.code, d: row }, () => setProducts((m) => ({ ...m, [rec.code]: rec })));
    return rec;
  }, [shopId, ME, push]);

  const removeProduct = useCallback(async (code) => {
    await push({ t: 'delproduct', k: 'dp:' + code, d: { shop_id: shopId, code } },
      () => setProducts((m) => { const n = { ...m }; delete n[code]; return n; }));
  }, [shopId, push]);

  const saveOrder = useCallback(async (o) => {
    await push({ t: 'order', k: 'o:' + o.id, d: orderToRow(shopId, o) }, () => {
      setOrders((list) => [o, ...list.filter((x) => x.id !== o.id)].sort((a, b) => b.ts - a.ts));
      setSums((s) => {   // cộng tạm để số liệu hiện ngay
        const m = { ...(s[viewMonth] || {}) };
        const prev = m[o.day] || { rev: 0, cost: 0, cnt: 0 };
        const cost = o.items.reduce((t, i) => t + (i.cost || 0) * i.qty, 0);
        m[o.day] = o.void ? prev : { rev: prev.rev + o.total, cost: prev.cost + cost, cnt: prev.cnt + 1 };
        return { ...s, [viewMonth]: m };
      });
    });
  }, [shopId, viewMonth, push]);

  const voidOrder = useCallback(async (o) => {
    const upd = { ...o, void: true, voidAt: Date.now() };
    await push({ t: 'order', k: 'o:' + o.id, d: orderToRow(shopId, upd) },
      () => setOrders((l) => l.map((x) => (x.id === o.id ? upd : x))));
    pullStats(range, viewMonth).catch(() => {});
  }, [shopId, push, pullStats, range, viewMonth]);

  const addDebt = useCallback(async (e) => {
    const rec = { id: `${slug(ME)}-${Date.now().toString(36)}-${uid().slice(0, 4)}`, ts: Date.now(), by: ME, ...e };
    await push({ t: 'debt', k: 'd:' + rec.id, d: { id: rec.id, shop_id: shopId, ts: new Date(rec.ts).toISOString(), customer: rec.customer, amount: Math.round(rec.amount), note: rec.note || '', order_id: rec.orderId || null, by_name: ME } },
      () => setDebts((l) => [rec, ...l]));
    return rec;
  }, [shopId, ME, push]);

  const saveMeta = useCallback(async (m) => {
    setMeta(m);
    await push({ t: 'shop', k: 'shop', id: shopId, d: { name: m.name, addr: m.addr || '', phone: m.phone || '', paper: m.paper || 80, no_accent: m.noAccent !== false, ai_on: m.aiOn !== false } });
  }, [shopId, push]);

  return {
    SHOP: shopId, ME, meta, saveMeta, products, orders, sums, topItems, stock, debts, live,
    viewDay, setViewDay, viewMonth, setViewMonth, range, setRange,
    customFrom, setCustomFrom, customTo, setCustomTo, rangeDays,
    sync, queue, pull, refresh, beat, saveProduct, removeProduct, saveOrder, voidOrder, addDebt,
  };
}
