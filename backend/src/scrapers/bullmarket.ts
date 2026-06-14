import { chromium, type Page, type Browser, type Cookie } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const BASE_URL = 'https://bullmarket.shopo.co.il';
const SESSION_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.session.json');

function loadSession(): { cookies: Cookie[]; storage: string } | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export interface ScrapedItem {
  product_name: string;
  brand: string | null;
  image_url: string | null;
  qty_ordered: number;
  unit_price_ordered: number | null;
  total_price_ordered: number | null;
  qty_received: number | null;
  unit_price_received: number | null;
  total_price_received: number | null;
  is_on_sale: boolean;
  original_price: number | null;
  sale_price: number | null;
  item_status: 'supplied' | 'out_of_stock' | 'alternative' | 'partial';
  substitutes_product_name: string | null; // matched later by name
}

export interface ScrapedOrder {
  order_number: string;
  order_date: string;          // ISO string
  delivery_date: string | null;
  status: string;
  delivery_address: string | null;
  items_supplied_count: number | null;
  subtotal: number | null;
  delivery_fee: number | null;
  vat: number | null;
  total_amount: number | null;
  payment_last4: string | null;
  payment_installments: number | null;
  raw_html: string;
  items: ScrapedItem[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function parsePrice(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = parseFloat(text.replace(/[^\d.]/g, ''));
  return isNaN(n) ? null : n;
}

function parseDate(text: string | null | undefined): string | null {
  if (!text) return null;
  // Format: DD/MM/YYYY HH:MM  or  DD/MM/YYYY
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh = '00', min = '00'] = match;
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00`).toISOString();
}

// ─── login ────────────────────────────────────────────────────────────────────

export async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?loginOrRegister=1`, { waitUntil: 'load' });

  // The site uses reCAPTCHA which blocks automated login.
  // Open the login modal and wait for a human to complete the login.
  const alreadyLoggedIn = await page.locator('div.login-or-register').isVisible().then((v) => !v).catch(() => false);
  if (alreadyLoggedIn) return;

  console.log('\n⏳  Please log in manually in the browser window, then press Enter here to continue…');
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  // Confirm the modal is gone
  const modalGone = await page.locator('div.login-or-register').isVisible().then((v) => !v).catch(() => true);
  if (!modalGone) throw new Error('Login modal still visible — please complete login before pressing Enter');
}

// ─── order list ───────────────────────────────────────────────────────────────

export async function getOrderUrls(page: Page): Promise<string[]> {
  await page.goto(`${BASE_URL}/my-account/orders`, { waitUntil: 'domcontentloaded' });

  // Collect all order detail links — anchors whose href contains an order number pattern
  const urls = await page.$$eval(
    'a[href*="/order/"], a[href*="/orders/"]',
    (anchors) => [...new Set(anchors.map((a) => (a as HTMLAnchorElement).href))],
  );
  return urls;
}

// ─── order detail ─────────────────────────────────────────────────────────────

export async function scrapeOrder(page: Page, url: string): Promise<ScrapedOrder> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const raw_html = await page.content();

  // Header fields
  const headerText = await page.locator('h1, .order-header, [class*="order-title"]').first().textContent().catch(() => '');

  const orderNumberMatch = headerText?.match(/(\d{7,})/);
  const order_number = orderNumberMatch?.[1] ?? url.match(/\d{7,}/)?.[0] ?? '';

  // Status — "מצב הזמנה: חויבה"
  const statusText = await page.locator('text=/מצב הזמנה/').first().textContent().catch(() => '');
  const status = statusText?.split(':').at(-1)?.trim() ?? '';

  // Dates from the info grid
  const orderDateText = await page.locator('text=/זמן הזמנה/').first().textContent().catch(() => '');
  const order_date = parseDate(orderDateText) ?? new Date().toISOString();

  // Delivery date from the heading "משלוח : HH:MM DD/MM/YYYY"
  const headingText = await page.locator('h1, h2, h3').first().textContent().catch(() => '');
  const delivery_date = parseDate(headingText);

  // Address
  const addressText = await page.locator('text=/כתובת למשלוח/').first().textContent().catch(() => null);
  const delivery_address = addressText?.replace(/כתובת למשלוח[:\s]*/i, '').trim() ?? null;

  // Totals
  const subtotalText = await page.locator('text=/סיכום ביניים/').first().textContent().catch(() => null);
  const subtotal = parsePrice(subtotalText);

  const deliveryFeeText = await page.locator('text=/דמי משלוח/').first().textContent().catch(() => null);
  const delivery_fee = parsePrice(deliveryFeeText);

  const vatText = await page.locator('text=/מע"מ/').first().textContent().catch(() => null);
  const vat = parsePrice(vatText);

  const totalText = await page.locator('text=/סה"כ/').last().textContent().catch(() => null);
  const total_amount = parsePrice(totalText);

  // Items supplied count — "מספר פריטים שסופקו : 62"
  const suppliedText = await page.locator('text=/מספר פריטים/').first().textContent().catch(() => null);
  const items_supplied_count = suppliedText ? parseInt(suppliedText.replace(/\D/g, ''), 10) || null : null;

  // Payment
  const paymentText = await page.locator('text=/\\*{4}\\d{4}/').first().textContent().catch(() => null);
  const payment_last4 = paymentText?.match(/\d{4}$/)?.[0] ?? null;
  const installmentsText = await page.locator('text=/מספר תשלומים/').first().textContent().catch(() => null);
  const payment_installments = installmentsText ? parseInt(installmentsText.replace(/\D/g, ''), 10) || 1 : 1;

  // Items table rows — skip the header row
  const rows = await page.locator('table tr, .order-items tr').all();
  const items: ScrapedItem[] = [];

  for (const row of rows.slice(1)) {
    const cells = await row.locator('td').all();
    if (cells.length < 3) continue;

    // Detect status badges
    const rowHtml = await row.innerHTML();
    const isOutOfStock = rowHtml.includes('חסר במלאי');
    const isAlternative = rowHtml.includes('מוצר חלופי');

    let item_status: ScrapedItem['item_status'] = 'supplied';
    if (isAlternative) item_status = 'alternative';
    else if (isOutOfStock) item_status = 'out_of_stock';

    // Image (first cell in RTL layout is rightmost = תמונה)
    const img = await row.locator('img').first().getAttribute('src').catch(() => null);
    const image_url = img ? (img.startsWith('http') ? img : `${BASE_URL}${img}`) : null;

    // Product name
    const product_name = (await row.locator('td').nth(1).textContent().catch(() => ''))?.trim() ?? '';
    if (!product_name) continue;

    // Brand
    const brand = (await row.locator('td').nth(2).textContent().catch(() => null))?.trim() || null;

    // "הוזמן" column — "3 יח' ₪18.60" or "1 יח' ₪29.90 ₪9.90" (sale)
    const orderedText = (await row.locator('td').nth(3).textContent().catch(() => ''))?.trim() ?? '';
    const orderedNums = [...orderedText.matchAll(/[\d.]+/g)].map((m) => parseFloat(m[0]));

    const qty_ordered = orderedNums[0] ?? 1;
    // Sale: two prices in ordered cell → original then sale
    const is_on_sale = orderedNums.length >= 3;
    const original_price = is_on_sale ? orderedNums[1] : null;
    const sale_price = is_on_sale ? orderedNums[2] : null;
    const total_price_ordered = is_on_sale ? sale_price! * qty_ordered : (orderedNums[1] ?? null);
    const unit_price_ordered = total_price_ordered !== null ? total_price_ordered / qty_ordered : null;

    // "התקבל" column
    const receivedText = (await row.locator('td').nth(4).textContent().catch(() => ''))?.trim() ?? '';
    const isReceiveDash = receivedText === '--' || receivedText === '—' || receivedText === '';
    const receivedNums = isReceiveDash ? [] : [...receivedText.matchAll(/[\d.]+/g)].map((m) => parseFloat(m[0]));

    const qty_received = receivedNums[0] ?? (isOutOfStock ? 0 : null);
    const total_price_received = receivedNums[1] ?? null;
    const unit_price_received = qty_received && total_price_received ? total_price_received / qty_received : null;

    items.push({
      product_name,
      brand,
      image_url,
      qty_ordered,
      unit_price_ordered,
      total_price_ordered,
      qty_received,
      unit_price_received,
      total_price_received,
      is_on_sale,
      original_price,
      sale_price,
      item_status,
      substitutes_product_name: null,
    });
  }

  // Mark each 'alternative' item as substituting the previous 'out_of_stock' item
  for (let i = 1; i < items.length; i++) {
    if (items[i].item_status === 'alternative' && items[i - 1].item_status === 'out_of_stock') {
      items[i].substitutes_product_name = items[i - 1].product_name;
    }
  }

  return {
    order_number,
    order_date,
    delivery_date,
    status,
    delivery_address,
    items_supplied_count,
    subtotal,
    delivery_fee,
    vat,
    total_amount,
    payment_last4,
    payment_installments,
    raw_html,
    items,
  };
}

// ─── main entry point ─────────────────────────────────────────────────────────

export async function scrapeAllOrders(): Promise<ScrapedOrder[]> {
  let browser: Browser | null = null;
  try {
    const session = loadSession();
    // Always run headful + stealth — Cloudflare blocks headless even with valid cf_clearance cookies
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--start-minimized'],
    });
    const context = await browser.newContext({
      ...(session ? { storageState: SESSION_FILE } : {}),
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    if (session) {
      console.log(`Loaded ${session.cookies.length} cookies from saved session`);
    }

    const page = await context.newPage();

    if (!session) {
      await login(page);
    } else {
      // Verify session is still valid by checking for auth indicators
      await page.goto(BASE_URL, { waitUntil: 'load' });
      const needsLogin = await page.locator('button:has-text("כניסה")').isVisible().catch(() => false);
      if (needsLogin) {
        console.warn('Saved session expired — falling back to manual login');
        await login(page);
      }
    }
    const urls = await getOrderUrls(page);
    console.log(`Found ${urls.length} orders to scrape`);

    const orders: ScrapedOrder[] = [];
    for (const url of urls) {
      try {
        console.log(`Scraping ${url}`);
        const order = await scrapeOrder(page, url);
        orders.push(order);
      } catch (err) {
        console.error(`Failed to scrape ${url}:`, err);
      }
    }
    return orders;
  } finally {
    await browser?.close();
  }
}
