#!/usr/bin/env node
/**
 * thumbnail.js — Maakt een kleine screenshot van een URL via Puppeteer.
 * Probeert cookie-banners te accepteren voor de screenshot.
 * Gebruik: node thumbnail.js <url> <output_path>
 */
const puppeteer = require('puppeteer');

const [,, url, outputPath] = process.argv;
if (!url || !outputPath) {
  process.stderr.write('Gebruik: node thumbnail.js <url> <output_path>\n');
  process.exit(1);
}

// Knoppen die cookie-acceptatie aanduiden (meertalig)
const COOKIE_SELECTORS = [
  // Tekst-gebaseerde selectors
  'button[id*="accept"]', 'button[id*="akkoord"]', 'button[id*="agree"]',
  'button[class*="accept"]', 'button[class*="akkoord"]', 'button[class*="agree"]',
  'button[class*="cookie-accept"]', 'button[class*="cookie_accept"]',
  'a[id*="accept"]', 'a[class*="accept"]',
  // Bekende frameworks
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',  // Cookiebot
  '#onetrust-accept-btn-handler',  // OneTrust
  '.cc-accept', '.cc-btn.cc-allow',  // Cookie Consent
  '[data-testid="cookie-accept"]',
  'button[data-cmp-exp="cookieWall"]',
  '.cookiebanner button.accept',
  '#cookie-accept', '#cookie_accept', '#accept-cookies', '#acceptCookies',
  '.js-accept-cookies', '.accept-cookies',
  '[aria-label*="accept" i]', '[aria-label*="akkoord" i]',
];

// Tekst waarnaar gezocht wordt in knoppen als selectors niets vinden
const COOKIE_TEXTS = [
  'accept all', 'accepteer alles', 'alle cookies accepteren', 'alles accepteren',
  'akkoord', 'agree', 'accept', 'accepteren', 'allow all', 'allow cookies',
  'toestaan', 'ik ga akkoord', 'ok', 'got it', 'i agree',
  'alle akkoord', 'alle toestaan', 'alles toestaan',
];

async function acceptCookies(page) {
  // Probeer bekende selectors
  for (const sel of COOKIE_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await new Promise(r => setTimeout(r, 600));
        return true;
      }
    } catch (_) {}
  }

  // Zoek knoppen op tekst
  try {
    const clicked = await page.evaluate((texts) => {
      const buttons = [...document.querySelectorAll('button, a[role="button"], input[type="button"]')];
      for (const btn of buttons) {
        const t = (btn.innerText || btn.value || '').trim().toLowerCase();
        if (texts.some(kw => t === kw || t.startsWith(kw))) {
          btn.click();
          return true;
        }
      }
      return false;
    }, COOKIE_TEXTS);

    if (clicked) {
      await new Promise(r => setTimeout(r, 600));
      return true;
    }
  } catch (_) {}

  return false;
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wacht op cookie-banners en probeer te accepteren
    await new Promise(r => setTimeout(r, 1200));
    await acceptCookies(page);
    await new Promise(r => setTimeout(r, 800));

    await page.screenshot({
      path: outputPath,
      type: 'jpeg',
      quality: 75,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });
    process.exit(0);
  } catch (err) {
    process.stderr.write('Thumbnail fout: ' + err.message + '\n');
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
