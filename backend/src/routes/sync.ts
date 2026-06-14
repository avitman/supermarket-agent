import { Router } from 'express';
import { fetchAllOrders } from '../scripts/fetch-orders-api.js';
import { syncOrders } from '../services/sync.js';

const router = Router();

// POST /api/sync/orders — trigger full scrape + upsert pipeline
router.post('/orders', async (_req, res) => {
  try {
    const orders = await fetchAllOrders({ saveDebug: false });
    if (orders.length === 0) {
      return res.status(400).json({ error: 'No orders fetched — session may be expired' });
    }
    const result = await syncOrders(orders);
    res.json({ synced: result.synced, skipped: result.skipped, errors: result.errors });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
