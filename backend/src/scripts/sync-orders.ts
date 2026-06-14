/**
 * Full sync pipeline: fetch all orders from Bullmarket → upsert to Supabase.
 *
 *   npx tsx src/scripts/sync-orders.ts
 *   npm run sync          (from backend/)
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), '../../../.env') });

import { fetchAllOrders } from './fetch-orders-api.js';
import { syncOrders } from '../services/sync.js';

async function main() {
  console.log('=== Bullmarket → Supabase sync ===\n');

  // 1. Scrape via Playwright + API interception
  console.log('Step 1: fetching orders from Bullmarket…');
  const orders = await fetchAllOrders({ saveDebug: true });
  console.log(`        ${orders.length} orders fetched\n`);

  if (orders.length === 0) {
    console.error('No orders fetched — aborting sync.');
    process.exit(1);
  }

  // 2. Sync to Supabase
  console.log('Step 2: syncing to Supabase…');
  const result = await syncOrders(orders);

  console.log('\n=== Done ===');
  console.log(`  Synced:  ${result.synced}`);
  console.log(`  Skipped: ${result.skipped}`);
  if (result.errors.length > 0) {
    console.error('\nErrors:');
    result.errors.forEach((e) => console.error(' ', e));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
