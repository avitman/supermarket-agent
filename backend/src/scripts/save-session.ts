/**
 * Run this ONCE to log in manually and save the session cookies.
 * After that, the scraper uses the saved cookies and never needs to log in again.
 *
 *   npx tsx src/scripts/save-session.ts
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), '../../../.env') });

const SESSION_FILE = resolve(dirname(__filename), '../../../.session.json');
const BASE_URL = 'https://bullmarket.shopo.co.il';

async function main() {
  const browser = await chromium.launch({
    headless: false,
    // Remove the automation flag that reCAPTCHA detects
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  // Patch navigator.webdriver so reCAPTCHA can't detect automation
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/?loginOrRegister=1`, { waitUntil: 'load' });

  console.log('\n🔐  Log in manually in the browser window.');
  console.log('    Waiting for login to complete automatically...\n');

  // Poll until the login modal disappears — means user successfully logged in
  await page.waitForSelector('div.login-or-register', { state: 'hidden', timeout: 120_000 });
  console.log('✓ Login detected — saving session...');

  // storageState saves cookies + localStorage in one shot — most reliable Playwright session format
  await context.storageState({ path: SESSION_FILE });
  const { cookies } = JSON.parse(readFileSync(SESSION_FILE, 'utf-8')) as { cookies: unknown[] };
  console.log(`✅  Session saved to ${SESSION_FILE}`);
  console.log(`    Saved ${cookies.length} cookies.`);

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
