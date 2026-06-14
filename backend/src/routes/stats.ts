import { Router } from 'express';
import { getSupabase } from '../services/supabase.js';

const router = Router();

// GET /api/stats — aggregated dashboard statistics
router.get('/', async (_req, res) => {
  const db = getSupabase();

  // Fetch all orders
  const { data: orders, error: oErr } = await db
    .from('orders')
    .select('id, order_number, order_date, total_amount, delivery_fee, items_supplied_count')
    .order('order_date', { ascending: true });

  if (oErr) return res.status(500).json({ error: oErr.message });

  // Fetch all order items with barcode
  const { data: items, error: iErr } = await db
    .from('order_items')
    .select('order_id, barcode, product_name, image_url, qty_ordered, qty_received, total_price_received, is_on_sale, original_price, sale_price, item_status');

  if (iErr) return res.status(500).json({ error: iErr.message });

  // Fetch product categories
  const { data: products } = await db
    .from('products')
    .select('barcode, name, image_url, category');

  const productMap = new Map((products ?? []).map((p) => [p.barcode, p]));

  // ─── Summary KPIs ──────────────────────────────────────────────────────────
  const totalSpent = (orders ?? []).reduce((s, o) => s + (o.total_amount ?? 0), 0);
  const totalDeliveryFees = (orders ?? []).reduce((s, o) => s + (o.delivery_fee ?? 0), 0);

  const suppliedItems = (items ?? []).filter((i) => i.item_status === 'supplied' || i.item_status === 'alternative');
  const missingItems  = (items ?? []).filter((i) => i.item_status === 'out_of_stock');
  const altItems      = (items ?? []).filter((i) => i.item_status === 'alternative');

  const totalSaved = (items ?? []).reduce((s, i) => {
    if (i.is_on_sale && i.original_price != null && i.sale_price != null && i.qty_received) {
      return s + (i.original_price - i.sale_price) * i.qty_received;
    }
    return s;
  }, 0);

  // ─── Monthly spending ──────────────────────────────────────────────────────
  const monthMap: Record<string, { month: string; label: string; total: number; count: number }> = {};
  (orders ?? []).forEach((o) => {
    const d = new Date(o.order_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('he-IL', { month: 'short', year: '2-digit' });
    if (!monthMap[key]) monthMap[key] = { month: key, label, total: 0, count: 0 };
    monthMap[key].total += o.total_amount ?? 0;
    monthMap[key].count++;
  });
  const monthlySpending = Object.values(monthMap).map((m) => ({
    ...m,
    total: Number(m.total.toFixed(2)),
  }));

  // ─── Category breakdown ────────────────────────────────────────────────────
  const catMap: Record<string, { category: string; total: number; count: number }> = {};
  (items ?? []).forEach((i) => {
    if (!i.barcode) return;
    const cat = productMap.get(i.barcode)?.category ?? 'אחר';
    if (!catMap[cat]) catMap[cat] = { category: cat, total: 0, count: 0 };
    catMap[cat].total += i.total_price_received ?? 0;
    catMap[cat].count++;
  });
  const categoryBreakdown = Object.values(catMap)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map((c) => ({ ...c, total: Number(c.total.toFixed(2)) }));

  // ─── Top products ──────────────────────────────────────────────────────────
  const prodMap: Record<string, {
    barcode: string; name: string; image_url: string | null;
    orderCount: number; totalQty: number; totalSpent: number; category: string | null;
  }> = {};
  const SKIP_NAMES = /משלוח|shipping|delivery fee/i;
  (items ?? []).forEach((i) => {
    if (!i.barcode || i.item_status === 'out_of_stock' || i.item_status === 'substituted') return;
    if (SKIP_NAMES.test(i.product_name)) return;
    if (!prodMap[i.barcode]) {
      const p = productMap.get(i.barcode);
      prodMap[i.barcode] = {
        barcode: i.barcode,
        name: p?.name ?? i.product_name,
        image_url: p?.image_url ?? i.image_url,
        category: p?.category ?? null,
        orderCount: 0,
        totalQty: 0,
        totalSpent: 0,
      };
    }
    prodMap[i.barcode].orderCount++;
    prodMap[i.barcode].totalQty += i.qty_received ?? 0;
    prodMap[i.barcode].totalSpent += i.total_price_received ?? 0;
  });
  const topProducts = Object.values(prodMap)
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 15)
    .map((p) => ({ ...p, totalSpent: Number(p.totalSpent.toFixed(2)) }));

  // ─── Top not-supplied products ────────────────────────────────────────────
  const missingMap: Record<string, {
    barcode: string; name: string; image_url: string | null; count: number; category: string | null;
  }> = {};
  (items ?? []).forEach((i) => {
    if (i.item_status !== 'out_of_stock') return;
    const key = i.barcode ?? i.product_name;
    if (!missingMap[key]) {
      const p = i.barcode ? productMap.get(i.barcode) : undefined;
      missingMap[key] = {
        barcode: i.barcode ?? '',
        name: p?.name ?? i.product_name,
        image_url: p?.image_url ?? i.image_url,
        category: p?.category ?? null,
        count: 0,
      };
    }
    missingMap[key].count++;
  });
  const topMissingProducts = Object.values(missingMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ─── Out-of-stock rate per order ───────────────────────────────────────────
  const orderHealthMap: Record<number, { supplied: number; missing: number; alternative: number }> = {};
  (orders ?? []).forEach((o) => {
    orderHealthMap[o.id] = { supplied: 0, missing: 0, alternative: 0 };
  });
  (items ?? []).forEach((i) => {
    const h = orderHealthMap[i.order_id];
    if (!h) return;
    if (i.item_status === 'supplied')    h.supplied++;
    if (i.item_status === 'out_of_stock') h.missing++;
    if (i.item_status === 'alternative') h.alternative++;
  });
  const orderHealth = (orders ?? []).map((o) => ({
    order_number: o.order_number,
    date: o.order_date.slice(0, 10),
    ...orderHealthMap[o.id],
  }));

  // ─── Day-of-week distribution ──────────────────────────────────────────────
  const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dowCount = [0, 0, 0, 0, 0, 0, 0];
  (orders ?? []).forEach((o) => { dowCount[new Date(o.order_date).getDay()]++; });
  const ordersByDow = DOW.map((day, i) => ({ day, count: dowCount[i] }));

  res.json({
    summary: {
      totalOrders: (orders ?? []).length,
      totalSpent: Number(totalSpent.toFixed(2)),
      avgOrderValue: Number((totalSpent / (orders?.length || 1)).toFixed(2)),
      totalDeliveryFees: Number(totalDeliveryFees.toFixed(2)),
      totalItemLines: (items ?? []).length,
      suppliedCount: suppliedItems.length,
      missingCount: missingItems.length,
      altCount: altItems.length,
      totalSaved: Number(totalSaved.toFixed(2)),
    },
    monthlySpending,
    categoryBreakdown,
    topProducts,
    orderHealth,
    ordersByDow,
    topMissingProducts,
  });
});

export default router;
