import { Router } from 'express';
import { getSupabase } from '../services/supabase.js';
import { compareProductPrices } from '../services/priceComparison.js';

const router = Router();

// POST /api/prices/sync — fetch live prices for all our products and store them
router.post('/sync', async (_req, res) => {
  const db = getSupabase();

  // Get all barcodes from products we've purchased
  const { data: products, error: pErr } = await db
    .from('products')
    .select('barcode, name')
    .not('barcode', 'is', null);

  if (pErr) return res.status(500).json({ error: pErr.message });

  const barcodes = (products ?? []).map(p => p.barcode).filter(Boolean) as string[];
  if (!barcodes.length) return res.status(400).json({ error: 'No products with barcodes found' });

  try {
    const { records, errors } = await compareProductPrices(barcodes);

    if (records.length > 0) {
      const knownBarcodes = new Set(barcodes);
      const rows = records
        .filter(r => knownBarcodes.has(r.barcode))
        .map(r => ({
          product_barcode: r.barcode,
          chain: r.chain,
          price: r.price,
          recorded_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        // Get chains we're updating so we can delete stale rows first
        const chains = [...new Set(rows.map(r => r.chain))];

        const { error: dErr } = await db
          .from('price_snapshots')
          .delete()
          .in('product_barcode', barcodes)
          .in('chain', chains);

        if (dErr) return res.status(500).json({ error: dErr.message });

        const { error: iErr } = await db.from('price_snapshots').insert(rows);
        if (iErr) return res.status(500).json({ error: iErr.message });
      }
    }

    res.json({
      synced: records.length,
      errors,
      chains: [...new Set(records.map(r => r.chain))],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/prices/compare — return latest price comparison from DB
router.get('/compare', async (_req, res) => {
  const db = getSupabase();

  // Get all latest price snapshots joined with product info
  const { data: snapshots, error: sErr } = await db
    .from('price_snapshots')
    .select('product_barcode, chain, price, recorded_at, products(name, image_url, category)')
    .order('recorded_at', { ascending: false });

  if (sErr) return res.status(500).json({ error: sErr.message });

  // Get prices from our own orders (latest unit_price per barcode)
  const { data: orderItems, error: oErr } = await db
    .from('order_items')
    .select('barcode, unit_price_ordered, product_name')
    .not('barcode', 'is', null)
    .not('unit_price_ordered', 'is', null)
    .order('id', { ascending: false });

  if (oErr) return res.status(500).json({ error: oErr.message });

  // Build "our price" map (latest price per barcode from orders)
  const ourPriceMap = new Map<string, { price: number; name: string }>();
  for (const item of (orderItems ?? [])) {
    if (!ourPriceMap.has(item.barcode)) {
      ourPriceMap.set(item.barcode, { price: item.unit_price_ordered, name: item.product_name });
    }
  }

  // Build comparison: barcode → { name, image, category, chains: {chain: price}, our_price }
  type ProductEntry = {
    barcode: string;
    name: string;
    image_url: string | null;
    category: string | null;
    our_price: number | null;
    chains: Record<string, number>;
    recorded_at: string;
  };

  const map = new Map<string, ProductEntry>();
  for (const snap of (snapshots ?? [])) {
    if (!map.has(snap.product_barcode)) {
      const prod = snap.products as unknown as { name: string; image_url: string | null; category: string | null } | null;
      const our = ourPriceMap.get(snap.product_barcode);
      map.set(snap.product_barcode, {
        barcode: snap.product_barcode,
        name: prod?.name ?? our?.name ?? snap.product_barcode,
        image_url: prod?.image_url ?? null,
        category: prod?.category ?? null,
        our_price: our?.price ?? null,
        chains: {},
        recorded_at: snap.recorded_at,
      });
    }
    const entry = map.get(snap.product_barcode)!;
    if (!(snap.chain in entry.chains)) {
      entry.chains[snap.chain] = snap.price;
    }
  }

  const products = [...map.values()]
    .filter(p => Object.keys(p.chains).length > 0)
    .sort((a, b) => {
      // Sort by potential savings (our_price - cheapest) descending
      const cheapA = Math.min(...Object.values(a.chains));
      const cheapB = Math.min(...Object.values(b.chains));
      const savA = a.our_price != null ? a.our_price - cheapA : 0;
      const savB = b.our_price != null ? b.our_price - cheapB : 0;
      return savB - savA;
    });

  res.json({ products, last_sync: snapshots?.[0]?.recorded_at ?? null });
});

export default router;
