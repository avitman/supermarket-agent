import { createGunzip } from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { Agent } from 'undici';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CERBERUS_BASE = 'https://url.publishedprices.co.il';

// Cerberus has a self-signed / intermediate cert issue — skip verification
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export interface PriceRecord {
  barcode: string;
  name: string;
  price: number;
  chain: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function decompressGzip(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    gunzip.on('data', (c: Buffer) => chunks.push(c));
    gunzip.on('end', () => resolve(Buffer.concat(chunks)));
    gunzip.on('error', reject);
    gunzip.end(buffer);
  });
}

function extractSetCookies(resp: Response): string {
  const raw: string[] = (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return raw.map(c => c.split(';')[0].trim()).join('; ');
}

// Typed wrapper around fetch that adds the undici agent for Cerberus URLs
function cerberusFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, dispatcher: insecureAgent } as RequestInit & { dispatcher: unknown });
}

function parseXmlPrices(xml: string, chain: string, targetBarcodes: Set<string>): PriceRecord[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) => name === 'Item' || name === 'Product',
  });
  const parsed = parser.parse(xml);

  // Different chains nest items differently
  const root = parsed?.Root ?? parsed?.Prices ?? parsed?.PriceFull ?? parsed;
  const items: Record<string, unknown>[] =
    root?.Items?.Item ?? root?.Products?.Product ?? root?.Catalog?.Items?.Item ?? [];

  const records: PriceRecord[] = [];
  for (const item of items) {
    const barcode = String(item.ItemCode ?? item.PriceCode ?? item.Barcode ?? '').trim();
    if (!targetBarcodes.has(barcode)) continue;

    const price = parseFloat(String(item.ItemPrice ?? item.Price ?? '0'));
    const name = String(item.ItemName ?? item.ItemNm ?? item.ProductDescription ?? '');
    if (price > 0) records.push({ barcode, name, price, chain });
  }
  return records;
}

async function downloadAndParse(
  url: string,
  chain: string,
  targetBarcodes: Set<string>,
  headers: Record<string, string> = {},
): Promise<PriceRecord[]> {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  const ct = resp.headers.get('content-type') ?? '';
  const isGzip = url.endsWith('.gz') || ct.includes('gzip') || ct.includes('octet-stream');
  const xml = isGzip
    ? (await decompressGzip(buffer)).toString('utf-8')
    : buffer.toString('utf-8');

  return parseXmlPrices(xml, chain, targetBarcodes);
}

// ─── Shufersal Direct ─────────────────────────────────────────────────────────

export async function fetchShufersalPrices(targetBarcodes: Set<string>): Promise<PriceRecord[]> {
  // catID=2 = PriceFull. Portal returns HTML — parse download links via regex.
  const listUrl = 'https://prices.shufersal.co.il/FileObject/UpdateCategory?catID=2&storeId=1&sort=Time&sortdir=DESC&page=1&isGzip=false';
  const listResp = await fetch(listUrl, { headers: { 'User-Agent': UA } });
  if (!listResp.ok) throw new Error(`Shufersal listing HTTP ${listResp.status}`);

  const html = await listResp.text();

  // Extract Azure Blob signed URLs for PriceFull files
  const matches = [...html.matchAll(/href="(https:\/\/[^"]*PriceFull[^"]*\.gz[^"]*)"/gi)];
  if (!matches.length) throw new Error('No Shufersal PriceFull links found in page');

  // Take the first link (latest for store 1)
  const fileUrl = matches[0][1].replace(/&amp;/g, '&');
  return downloadAndParse(fileUrl, 'shufersal', targetBarcodes);
}

// ─── Cerberus (Rami Levy, Victory, Osher Ad…) ────────────────────────────────

export async function fetchCerberusPrices(
  chainUsername: string,
  chainName: string,
  targetBarcodes: Set<string>,
): Promise<PriceRecord[]> {
  // Step 1 — GET login page: capture CSRF token + initial session cookie
  const loginResp = await cerberusFetch(`${CERBERUS_BASE}/login`, { headers: { 'User-Agent': UA } });
  const loginHtml = await loginResp.text();
  const csrf = loginHtml.match(/name="csrftoken"\s+content="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('Cerberus: CSRF token not found');
  const initCookie = extractSetCookies(loginResp);

  // Step 2 — POST credentials; server 302-redirects on success and rotates session cookie
  const postResp = await cerberusFetch(`${CERBERUS_BASE}/login/user`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Cookie': initCookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${CERBERUS_BASE}/login`,
    },
    body: `username=${encodeURIComponent(chainUsername)}&password=&csrftoken=${encodeURIComponent(csrf)}`,
    redirect: 'manual',
  } as RequestInit);
  // Use the NEW session cookie set by the POST response (replaces the initial one)
  const authCookie = extractSetCookies(postResp) || initCookie;
  if (!authCookie) throw new Error('Cerberus: no auth cookie after login');

  // Step 3 — list available files (DataTables JSON: aaData array)
  await new Promise(r => setTimeout(r, 1200));
  const dirResp = await cerberusFetch(`${CERBERUS_BASE}/file/json/dir?iDisplayLength=200`, {
    headers: { 'User-Agent': UA, 'Cookie': authCookie },
  });
  if (!dirResp.ok) throw new Error(`Cerberus dir HTTP ${dirResp.status}`);

  const dirData = await dirResp.json() as { aaData?: string[][]; file?: { name: string }[] };
  // Cerberus returns aaData: array of rows where each row is [downloadLink, timestamp, size, ...]
  // or file: [{name}] in some versions
  let files: string[] = [];
  if (dirData.aaData?.length) {
    // Extract filenames from DataTables aaData rows — first cell contains the href
    files = dirData.aaData
      .map(row => {
        const cell = row[0] ?? '';
        const match = cell.match(/href="([^"]*PriceFull[^"]*)"/i) ?? cell.match(/(PriceFull\S+)/i);
        return match?.[1] ?? '';
      })
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a));
  } else if (dirData.file) {
    files = (dirData.file as { name: string }[])
      .filter(f => f.name.startsWith('PriceFull'))
      .map(f => f.name)
      .sort((a, b) => b.localeCompare(a));
  }

  if (!files.length) throw new Error(`No PriceFull files found for ${chainUsername} (${dirData.aaData?.length ?? 0} total rows)`);

  // Step 4 — download the latest PriceFull
  await new Promise(r => setTimeout(r, 1000));
  const fileName = files[0];
  const fileUrl = fileName.startsWith('http') ? fileName : `${CERBERUS_BASE}/file/d/${fileName}`;

  const fileResp = await cerberusFetch(fileUrl, { headers: { 'User-Agent': UA, 'Cookie': authCookie } });
  if (!fileResp.ok) throw new Error(`Cerberus file HTTP ${fileResp.status}`);

  const buffer = Buffer.from(await fileResp.arrayBuffer());
  const xml = (await decompressGzip(buffer)).toString('utf-8');
  return parseXmlPrices(xml, chainName, targetBarcodes);
}

// ─── Carrefour Direct ─────────────────────────────────────────────────────────

export async function fetchCarrefourPrices(targetBarcodes: Set<string>): Promise<PriceRecord[]> {
  const dirResp = await fetch('https://prices.carrefour.co.il/file/json/dir', {
    headers: { 'User-Agent': UA },
  });
  if (!dirResp.ok) throw new Error(`Carrefour dir HTTP ${dirResp.status}`);

  const dirData = await dirResp.json() as { file?: { name: string; url?: string }[] };
  const files = (dirData.file ?? [])
    .filter(f => f.name.startsWith('PriceFull'))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (!files.length) throw new Error('No Carrefour PriceFull files found');

  const fileUrl = files[0].url ?? `https://prices.carrefour.co.il/file/d/${files[0].name}`;
  return downloadAndParse(fileUrl, 'carrefour', targetBarcodes);
}

// ─── Main compare function ────────────────────────────────────────────────────

export async function compareProductPrices(barcodes: string[]): Promise<{
  records: PriceRecord[];
  errors: Record<string, string>;
}> {
  const targetBarcodes = new Set(barcodes);
  const errors: Record<string, string> = {};

  const [shufersalResult, ramiLevyResult] = await Promise.allSettled([
    fetchShufersalPrices(targetBarcodes),
    fetchCerberusPrices('RamiLevi', 'rami_levy', targetBarcodes),
  ]);

  const records: PriceRecord[] = [];
  if (shufersalResult.status === 'fulfilled') records.push(...shufersalResult.value);
  else errors['shufersal'] = shufersalResult.reason?.message ?? String(shufersalResult.reason);

  if (ramiLevyResult.status === 'fulfilled') records.push(...ramiLevyResult.value);
  else errors['rami_levy'] = ramiLevyResult.reason?.message ?? String(ramiLevyResult.reason);

  return { records, errors };
}
