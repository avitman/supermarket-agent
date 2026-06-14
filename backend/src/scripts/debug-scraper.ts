import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { chromium, type Page, type Cookie } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), '../../../.env') });

const BASE_URL = 'https://bullmarket.shopo.co.il';
const SESSION_FILE = resolve(dirname(__filename), '../../../.session.json');
const OUT = resolve(dirname(__filename), '../../../debug');
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  writeFileSync(`${OUT}/${name}.html`, await page.content());
  console.log(`  → saved ${name}.png`);
}

async function main() {
  if (!existsSync(SESSION_FILE)) {
    throw new Error(`No session file found at ${SESSION_FILE}. Run: npx tsx src/scripts/save-session.ts`);
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--start-minimized'],
  });
  // storageState restores cookies + localStorage in one shot
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const { cookies } = JSON.parse(readFileSync(SESSION_FILE, 'utf-8')) as { cookies: Cookie[] };
  console.log(`Loaded ${cookies.length} cookies from session file`);
  const page = await context.newPage();

  // ── Step 1: verify session is valid ──────────────────────────────────────
  console.log('1. Verifying session…');
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await shot(page, '01-home');

  const loginVisible = await page.locator('button.no-design.login').isVisible().catch(() => false);
  console.log('  Login button visible (= not logged in)?', loginVisible);
  if (loginVisible) {
    throw new Error('Session expired — re-run: npx tsx src/scripts/save-session.ts');
  }

  // ── Step 2: find orders page ──────────────────────────────────────────────
  console.log('2. Looking for orders link…');
  const allLinks = await page.$$eval('a', (anchors) =>
    anchors.map((a) => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim().slice(0, 50) }))
      .filter((l) => l.text),
  );
  const orderLinks = allLinks.filter((l) => /order|הזמנ|חשבון|account/i.test(l.href + l.text));
  console.log('  Order/account links:', orderLinks.slice(0, 10));
  writeFileSync(`${OUT}/02-order-links.json`, JSON.stringify(orderLinks, null, 2));

  // ── Step 3: intercept API calls while loading orders page ─────────────────
  console.log('3. Loading orders page — intercepting API calls…');
  const apiResponses: { url: string; body: string }[] = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (/api|order|history/i.test(url) && resp.headers()['content-type']?.includes('json')) {
      try {
        const body = await resp.text();
        apiResponses.push({ url, body: body.slice(0, 2000) });
      } catch { /* ignore */ }
    }
  });

  await page.goto(`${BASE_URL}/my-account/orders`, { waitUntil: 'load' });
  await page.waitForSelector('section.orders-history', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(4000); // let lazy API calls complete

  console.log(`  API responses captured: ${apiResponses.length}`);
  writeFileSync(`${OUT}/03-api-responses.json`, JSON.stringify(apiResponses, null, 2));
  apiResponses.forEach((r) => console.log('  ', r.url, '→', r.body.slice(0, 200)));

  await shot(page, '03-orders-page');

  // Dump all links from the rendered page
  const allPageLinks = await page.$$eval('a', (anchors) =>
    anchors.map((a) => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim().slice(0, 50) })),
  );
  writeFileSync(`${OUT}/03-all-links.json`, JSON.stringify(allPageLinks, null, 2));
  console.log('  All links count:', allPageLinks.length);

  // Look for order detail links — order numbers on this site are 7-8 digits
  const orderDetailLinks = allPageLinks.filter((l) =>
    /\/order\/\d|\/orders\/\d|\?order=\d|order_id=\d|orderId=\d/.test(l.href),
  );
  console.log('  Order detail links:', orderDetailLinks.slice(0, 5));

  // Also dump any element with "הזמנה" text and an href
  const hebrewOrderLinks = allPageLinks.filter((l) => /הזמנ/.test(l.text ?? ''));
  console.log('  Hebrew order links:', hebrewOrderLinks.slice(0, 5));

  // Dump the orders-history section HTML
  const ordersSection = await page.locator('section.orders-history').innerHTML().catch(() => '(not found)');
  writeFileSync(`${OUT}/03-orders-section.html`, ordersSection.slice(0, 10000));
  console.log('  orders-history section length:', ordersSection.length);

  // ── Step 4: extract order IDs from AngularJS scope ───────────────────────
  console.log('4. Extracting order IDs from AngularJS scope…');
  await page.goto(`${BASE_URL}/my-account/orders`, { waitUntil: 'load' });
  await page.waitForSelector('section.orders-history', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  type AngularOrder = { id: number | string; date?: string; itemsCount?: number };
  const orderIds = await page.evaluate((): AngularOrder[] => {
    const win = window as Window & {
      angular?: { element: (el: Element | null) => { scope: () => Record<string, unknown> } }
    };
    const ng = win.angular;
    if (!ng) return [];
    const el = document.querySelector('section.orders-history');
    if (!el) return [];
    try {
      const scope = ng.element(el).scope() as {
        sideNavCtrl?: { ordersHistory?: AngularOrder[]; ordersService?: { ordersHistory?: AngularOrder[] } }
      };
      const ctrl = scope.sideNavCtrl;
      return ctrl?.ordersHistory ?? ctrl?.ordersService?.ordersHistory ?? [];
    } catch { return []; }
  });
  console.log('  Order IDs from scope:', orderIds);
  writeFileSync(`${OUT}/04-order-ids.json`, JSON.stringify(orderIds, null, 2));

  // ── Step 5: open order detail and wait for Angular to render ─────────────
  const firstId = orderIds[0]?.id ?? '16938738';
  const detailUrl = `${BASE_URL}/orders/${firstId}`;
  console.log(`5. Opening order detail: ${detailUrl}`);
  await page.goto(detailUrl, { waitUntil: 'load' });

  // Wait for Angular to render the order table
  await page.waitForSelector('table tr, .order-items, [class*="order-item"]', { timeout: 15_000 })
    .catch(() => console.log('  Table selector timed out — waiting 5s…'));
  await page.waitForTimeout(5000);
  await shot(page, '05-order-detail');

  // Dump table rows
  const rows = await page.$$eval('table tr', (trs) =>
    trs.slice(0, 6).map((tr) => ({
      cells: [...tr.querySelectorAll('td,th')].map((td) => td.textContent?.trim()),
      classes: tr.className,
      html: tr.innerHTML.slice(0, 500),
    })),
  );
  writeFileSync(`${OUT}/05-table-rows.json`, JSON.stringify(rows, null, 2));
  console.log('  Table rows found:', rows.length);
  if (rows.length) console.log('  First row:', JSON.stringify(rows[0], null, 2));

  // ── Step 6: extract order items via DOM (passed as string to avoid tsx __name transform) ──
  console.log('6. Extracting order items via DOM…');
  // language=js
  const rawItems = await page.evaluate(`(function() {
    var rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.map(function(row) {
      var img = row.querySelector('img');
      var imgSrc = img ? (img.getAttribute('src') || img.getAttribute('ng-src') || '') : '';
      var barcodeMatch = imgSrc.match(/\\/small\\/(\\d+)-/);
      var barcode = barcodeMatch ? barcodeMatch[1] : null;
      var nameEl = row.querySelector('.name') || row.querySelector('td:nth-child(2) span');
      var name = nameEl ? nameEl.textContent.trim() : '';
      var isOutOfStock = !!(row.querySelector('.out-of-stock') || (row.textContent || '').includes('חסר במלאי'));
      var tds = Array.from(row.querySelectorAll('td')).map(function(td) { return td.textContent ? td.textContent.trim() : ''; });
      function parseP(s) { var n = parseFloat(s.replace(/[^\\d.]/g, '')); return isNaN(n) ? null : n; }
      var unitPrice = parseP(tds[3] || '');
      var total = parseP(tds[7] || '');
      var unit = (tds[5] || '').trim() || 'יח\\'';
      var qtyInput = row.querySelector('input');
      var qty = qtyInput && qtyInput.value ? parseFloat(qtyInput.value) : null;
      var qtyCalc = (total && unitPrice && unitPrice > 0) ? Math.round(total / unitPrice * 100) / 100 : null;
      return { name: name, barcode: barcode, imgSrc: imgSrc.slice(0, 120), unitPrice: unitPrice, total: total, unit: unit, qty: qty, qtyCalc: qtyCalc, isOutOfStock: isOutOfStock, tds: tds.slice(0, 9) };
    });
  })()`);
  const items = rawItems as Array<Record<string, unknown>>;
  writeFileSync(`${OUT}/06-items.json`, JSON.stringify(items, null, 2));
  console.log(`  Items extracted: ${items.length}`);
  console.log('  First 3:', JSON.stringify(items.slice(0, 3), null, 2));

  await browser.close();
  console.log(`\nAll debug files saved to: ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
