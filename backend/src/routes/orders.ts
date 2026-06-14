import { Router } from 'express';
import { getSupabase } from '../services/supabase.js';

const router = Router();

// GET /api/orders — paginated list
router.get('/', async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const from = (page - 1) * limit;

  const { data, error, count } = await getSupabase()
    .from('orders')
    .select('*', { count: 'exact' })
    .order('order_date', { ascending: false })
    .range(from, from + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, count, page, limit });
});

// GET /api/orders/:id — order with items
router.get('/:id', async (req, res) => {
  const { data: order, error } = await getSupabase()
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json(order);
});

export default router;
