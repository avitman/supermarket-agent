import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), '../../../.env') });

const SESSION_FILE = resolve(dirname(__filename), '../../../.session.json');
const OUT = resolve(dirname(__filename), '../../../debug');
const BASE = 'https://bullmarket.shopo.co.il';

mkdirSync(OUT, { recursive: true });

// ─── Types from API ───────────────────────────────────────────────────────────

export interface ApiOrderSummary {
  id: number;
  timePlaced: string;
  totalAmount: number;
  itemsCount: number;
  numberOfDoneItems: number;
  numberOfMissingItems: number;
  numberOfReplacedItems: number;
  orderStatus: number;
  branchId: number;
}

export interface ApiOrderLine {
  id: number;
  productId: number;
  barcode: string;
  name: string;
  quantity: number;
  actualQuantity: number;
  isWeightable: boolean;
  regularPrice: number;
  price: number;
  totalPrice: number;
  categoryName: string;
  categoryId: number;
  substituteId: number | null;
  status: number;
  isLineWithSale: boolean;
  images: { large: string; medium: string; small: string };
}

export interface ApiOrderDetail {
  id: number;
  timePlaced: string;
  statusId: number;
  totalAmount: number;
  deliveryFee: number;
  totalTax: number;
  shippingTimeFrom: string;
  shippingTimeTo: string;
  city: string;
  addressText: string;
  itemsCount: number;
  paymentData: {
    mainPayment: { lastFourDigits: string; paymentsNumber: number };
  };
  lines: ApiOrderLine[];
}

// ─── Core function (importable) ───────────────────────────────────────────────

export async function fetchAllOrders(opts?: { saveDebug?: boolean }): Promise<ApiOrderDetail[]> {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--start-minimized'],
  });
  try {
    const context = await browser.newContext({
      storageState: SESSION_FILE,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    await context.addInitScript('Object.defineProperty(navigator,"webdriver",{get:()=>undefined})');
    const page = await context.newPage();

    // ── Step 1: capture Angular's auth headers ──────────────────────────────
    console.log('[fetch] loading orders page to capture auth headers…');
    let capturedHeaders: Record<string, string> | null = null;
    let ordersApiBase = '';

    page.on('request', (req) => {
      const url = req.url();
      if (!capturedHeaders && url.includes('/orders?') && url.includes('retailers') && url.includes('bullmarket')) {
        capturedHeaders = req.headers();
        ordersApiBase = url.split('?')[0];
        console.log('[fetch] captured auth headers from:', url.replace(BASE, '').split('?')[0]);
      }
    });

    await page.goto(`${BASE}/my-account/orders`, { waitUntil: 'load' });
    await page.waitForTimeout(4000);

    if (!capturedHeaders) throw new Error('No API request captured — session may be expired. Re-run: npx tsx src/scripts/save-session.ts');

    // ── Step 2: fetch all order summaries via browser fetch with auth headers ─
    console.log('[fetch] fetching all order summaries…');
    const allSummaries: ApiOrderSummary[] = [];
    let from = 0;
    let total = Infinity;
    const headersJson = JSON.stringify(capturedHeaders);

    while (allSummaries.length < total) {
      const url = `${ordersApiBase}?appId=4&from=${from}&size=20&getLiveResults=false&orderBy=%7B%22id%22%3A%22desc%22%7D`;
      const raw = await page.evaluate(`
        fetch(${JSON.stringify(url)}, { credentials: 'include', headers: ${headersJson} }).then(r => r.text())
      `) as string;
      let data: { orders?: ApiOrderSummary[]; total?: number };
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`Non-JSON response from orders API: ${raw.slice(0, 200)}`);
      }
      if (typeof data.total === 'number') total = data.total;
      const batch = data.orders ?? [];
      if (batch.length === 0) break;
      allSummaries.push(...batch);
      console.log(`[fetch]   +${batch.length} orders (${allSummaries.length}/${total})`);
      from += batch.length;
      if (batch.length < 20) break;
    }

    if (opts?.saveDebug) writeFileSync(`${OUT}/api-all-orders.json`, JSON.stringify(allSummaries, null, 2));
    console.log(`[fetch] total orders: ${allSummaries.length}`);

    // ── Step 3: fetch full detail (with lines) for each order ───────────────
    console.log('[fetch] fetching order details…');
    const orderDetails: ApiOrderDetail[] = [];

    for (const summary of allSummaries) {
      let detail: ApiOrderDetail | null = null;

      const onResponse = async (resp: import('playwright').Response) => {
        const url = resp.url();
        if (url.includes(`/orders/${summary.id}`) && resp.headers()['content-type']?.includes('json')) {
          try {
            const json = await resp.json() as ApiOrderDetail;
            if (Array.isArray(json.lines) && json.lines.length > 0) detail = json;
          } catch { /* ignore */ }
        }
      };
      page.on('response', onResponse);
      await page.goto(`${BASE}/orders/${summary.id}`, { waitUntil: 'load' });
      await page.waitForTimeout(3500);
      page.off('response', onResponse);

      if (detail) {
        orderDetails.push(detail);
        console.log(`[fetch]   ✓ ${summary.id}: ${(detail as ApiOrderDetail).lines.length} lines`);
      } else {
        console.warn(`[fetch]   ✗ ${summary.id}: no lines captured`);
      }
    }

    if (opts?.saveDebug) writeFileSync(`${OUT}/api-order-details.json`, JSON.stringify(orderDetails, null, 2));
    return orderDetails;
  } finally {
    await browser.close();
  }
}

// ─── Standalone debug run ─────────────────────────────────────────────────────

async function main() {
  const orders = await fetchAllOrders({ saveDebug: true });

  console.log(`\nFetched ${orders.length} orders`);
  if (orders.length > 0) {
    const first = orders[0];
    console.log(`\nSample — ${first.id}:`);
    console.log(`  ₪${first.totalAmount} (delivery ₪${first.deliveryFee}, tax ₪${first.totalTax})`);
    for (const l of first.lines.slice(0, 3)) {
      console.log(`  ${l.barcode}  "${l.name}"  qty:${l.quantity}→${l.actualQuantity}  ₪${l.price}`);
    }
  }
  console.log(`\nDebug files saved to ${OUT}/`);
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
