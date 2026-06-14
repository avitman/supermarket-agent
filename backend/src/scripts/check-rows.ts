import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), '../../../.env') });
import { getSupabase } from '../services/supabase.js';

async function main() {
  const db = getSupabase();
  const [orders, items, products] = await Promise.all([
    db.from('orders').select('id', { count: 'exact', head: true }),
    db.from('order_items').select('id', { count: 'exact', head: true }),
    db.from('products').select('barcode', { count: 'exact', head: true }),
  ]);
  console.log('orders:     ', orders.count);
  console.log('order_items:', items.count);
  console.log('products:   ', products.count);
}
main().catch(console.error);
