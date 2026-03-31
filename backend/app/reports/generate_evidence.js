/**
 * Bewijs-PDF generator voor WWSpeur.
 *
 * Per URL waarop bevindingen zijn gedaan worden TWEE PDFs gemaakt:
 *  1. <prefix>_meta.pdf  — metadata + tabel van bevindingen (wat, waar, wanneer)
 *  2. <prefix>_pagina.pdf — de live pagina zelf, via Puppeteer page.pdf()
 *
 * Input (stdin): JSON met shop + brongegevens (zie shops.py)
 * Gebruik: node generate_evidence.js <output_dir>
 */

'use strict';

const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');

// ── Hulpfuncties ──────────────────────────────────────────────────────────────

function parseJSON(str) {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
}
function parseJSONObj(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Maak een veilige bestandsnaam-prefix van een URL. */
function urlToPrefix(url, index) {
  const safe = url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 70);
  return `bewijs_${String(index + 1).padStart(3, '0')}_${safe}`;
}

/**
 * Probeer cookie-banner te accepteren via tekst-knoppen en bekende framework-selectors.
 * Meertalig: NL, EN, DE, FR, ES.
 */
async function dismissCookieBanner(page) {
  try {
    // Wacht kort zodat JS cookie-scripts kunnen initialiseren
    await new Promise(r => setTimeout(r, 1500));

    await page.evaluate(() => {
      const acceptTexts = [
        // NL
        'accepteer', 'accepteren', 'akkoord', 'alle cookies accepteren',
        'alles accepteren', 'alles toestaan', 'toestaan', 'bevestigen',
        'ik ga akkoord', 'ja, ik accepteer',
        // EN
        'accept all', 'accept cookies', 'accept all cookies', 'allow all',
        'allow cookies', 'agree', 'i agree', 'agree to all', 'ok', 'got it',
        'confirm', 'continue',
        // DE
        'alle akzeptieren', 'zustimmen', 'alle cookies akzeptieren', 'einverstanden',
        // FR
        'tout accepter', 'accepter', 'accepter tout', "j'accepte", "d'accord",
        // ES
        'aceptar todo', 'aceptar', 'acepto',
      ];

      // 1. Tekst-gebaseerd zoeken in alle klikbare elementen
      const candidates = [
        ...document.querySelectorAll('button, a[role="button"], [type="button"], [type="submit"]'),
      ];
      for (const el of candidates) {
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
        if (acceptTexts.some(t => text === t || text.startsWith(t))) {
          el.click();
          return;
        }
      }

      // 2. Bekende CSS-selectors per framework
      const selectors = [
        // Cookiebot
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept',
        // OneTrust
        '#onetrust-accept-btn-handler',
        '.onetrust-accept-btn-handler',
        // CookieYes / CookieLaw
        '.cky-btn-accept', '#cky-btn-accept',
        '.cl-gdpr-btn-accept',
        // Complianz
        '.cmplz-accept', '#cmplz-accept',
        // Borlabs Cookie
        '#borlabs-cookie-btn-accept-all',
        // Quantcast
        '.qc-cmp2-summary-buttons button:last-child',
        // Iubenda
        '.iubenda-cs-accept-btn',
        // Didomi
        '#didomi-notice-agree-button',
        // Generiek
        '[data-accept-all]',
        '[data-cookiebanner="accept_button"]',
        '.cookie-accept', '#cookie-accept',
        '.accept-cookies', '#accept-cookies',
        '.cookie-consent-accept', '.js-accept-cookies',
        '[class*="cookie"][class*="accept"]',
        '[id*="cookie"][id*="accept"]',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) { el.click(); return; }
      }
    });

    // Wacht even voor de banner verdwijnt (animatie)
    await new Promise(r => setTimeout(r, 800));
  } catch (_) {
    // Geen banner of klik mislukt — gewoon doorgaan
  }
}

/** Verzamel alle unieke bronpagina's en wat er per pagina gevonden is. */
function collectSourcePages(shop) {
  const latestScrape = shop.scrape_records?.[shop.scrape_records.length - 1];
  if (!latestScrape) return [];

  const srcDetails = parseJSONObj(latestScrape.meta_description);
  const emailSrc   = srcDetails.email_sources   || {};
  const phoneSrc   = srcDetails.phone_sources   || {};
  const addressSrc = srcDetails.address_sources || {};
  const kvkSrc     = srcDetails.kvk_sources     || {};
  const ibanSrc    = srcDetails.iban_sources    || {};

  const pageMap = {};

  const add = (srcObj, label) => {
    for (const [value, urls] of Object.entries(srcObj)) {
      const list = Array.isArray(urls) ? urls : [urls];
      for (const url of list) {
        if (!url) continue;
        if (!pageMap[url]) pageMap[url] = { url, findings: [] };
        pageMap[url].findings.push({ label, value });
      }
    }
  };

  add(emailSrc,   'E-mailadres');
  add(phoneSrc,   'Telefoonnummer');
  add(addressSrc, 'Adres');

  for (const [val, urls] of Object.entries(kvkSrc.found || kvkSrc)) {
    const list = Array.isArray(urls) ? urls : [urls];
    for (const url of list) {
      if (!url) continue;
      if (!pageMap[url]) pageMap[url] = { url, findings: [] };
      pageMap[url].findings.push({ label: 'KvK-nummer', value: val });
    }
  }

  for (const [val, urls] of Object.entries(ibanSrc)) {
    const list = Array.isArray(urls) ? urls : [urls];
    for (const url of list) {
      if (!url) continue;
      if (!pageMap[url]) pageMap[url] = { url, findings: [] };
      pageMap[url].findings.push({ label: 'IBAN', value: val });
    }
  }

  // Fallback: geen bronpagina-koppeling maar wel data op de hoofdpagina
  if (Object.keys(pageMap).length === 0 && latestScrape.source_url) {
    const findings = [];
    parseJSON(latestScrape.emails_found).forEach(v   => findings.push({ label: 'E-mailadres',    value: v }));
    parseJSON(latestScrape.phones_found).forEach(v   => findings.push({ label: 'Telefoonnummer', value: v }));
    parseJSON(latestScrape.addresses_found).forEach(v => findings.push({ label: 'Adres',          value: v }));
    if (findings.length > 0) {
      pageMap[latestScrape.source_url] = { url: latestScrape.source_url, findings };
    }
  }

  return Object.values(pageMap).filter(p => p.findings.length > 0);
}

/** HTML voor het metadata-blaadje (PDF 1). */
function buildMetaHtml(page, shop, timestamp) {
  const rows = page.findings.map((f, i) => `
    <tr class="${i % 2 === 0 ? '' : 'alt'}">
      <td>${escHtml(f.label)}</td>
      <td>${escHtml(f.value)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 28px; }
  .header { border-bottom: 2px solid #2B3A4E; padding-bottom: 12px; margin-bottom: 18px; }
  .header h1 { font-size: 18px; color: #2B3A4E; }
  .header .sub { font-size: 11px; color: #888; margin-top: 4px; }
  .label { font-size: 11px; font-weight: bold; color: #555; margin: 16px 0 6px; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .meta-table td { padding: 5px 8px; border: 1px solid #ddd; font-size: 11px; }
  .meta-table td:first-child { font-weight: bold; background: #f5f7fa; width: 140px; }
  .url-box { background: #f0f4f8; border: 1px solid #ccc; border-radius: 4px;
             padding: 7px 10px; font-family: monospace; font-size: 11px;
             word-break: break-all; margin-bottom: 18px; }
  .findings-table { width: 100%; border-collapse: collapse; }
  .findings-table th { background: #2B3A4E; color: #fff; padding: 6px 10px;
                       text-align: left; font-size: 11px; }
  .findings-table td { padding: 6px 10px; border: 1px solid #ddd; font-size: 12px; }
  .findings-table tr.alt td { background: #f5f7fa; }
  .footer { margin-top: 24px; font-size: 10px; color: #aaa;
            border-top: 1px solid #eee; padding-top: 8px; }
</style>
</head>
<body>
  <div class="header">
    <h1>WWSpeur — Bewijsdocument (bevindingen)</h1>
    <div class="sub">${escHtml(shop.domain)} &nbsp;|&nbsp; Gegenereerd: ${escHtml(timestamp)}</div>
  </div>

  <div class="label">Webwinkel</div>
  <table class="meta-table">
    <tr><td>URL</td><td>${escHtml(shop.url)}</td></tr>
    <tr><td>Domein</td><td>${escHtml(shop.domain)}</td></tr>
    <tr><td>Tijdstip bezoek</td><td>${escHtml(timestamp)}</td></tr>
  </table>

  <div class="label">Bronpagina</div>
  <div class="url-box">${escHtml(page.url)}</div>

  <div class="label">Gevonden gegevens op deze pagina</div>
  <table class="findings-table">
    <thead><tr><th>Type</th><th>Gevonden waarde</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    Dit document is automatisch gegenereerd door WWSpeur op ${escHtml(timestamp)}.
    Zie het bijbehorende bestand "_pagina.pdf" voor de volledige paginaweergave.
  </div>
</body>
</html>`;
}

// ── Hoofdprogramma ────────────────────────────────────────────────────────────

async function main() {
  const outputDir = process.argv[2] || '/tmp/wwspeur_evidence';

  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', async () => {
    let shop;
    try {
      shop = JSON.parse(input);
    } catch (e) {
      console.error(JSON.stringify({ success: false, error: 'Ongeldige JSON input: ' + e.message }));
      process.exit(1);
    }

    const pages = collectSourcePages(shop);
    if (pages.length === 0) {
      console.log(JSON.stringify({ success: true, files: [], message: 'Geen bronpaginas met bevindingen gevonden.' }));
      return;
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const timestamp = new Date().toLocaleString('nl-NL');
    const generatedFiles = [];
    const errors = [];

    for (let i = 0; i < pages.length; i++) {
      const page   = pages[i];
      const prefix = urlToPrefix(page.url, i);

      const metaPath   = path.join(outputDir, `${prefix}_meta.pdf`);
      const paginaPath = path.join(outputDir, `${prefix}_pagina.pdf`);

      const browserPage = await browser.newPage();
      try {
        await browserPage.setViewport({ width: 1280, height: 900 });

        // ── PDF 1: metadata-blaadje ──────────────────────────────────────────
        const metaHtml = buildMetaHtml(page, shop, timestamp);
        await browserPage.setContent(metaHtml, { waitUntil: 'load' });
        await browserPage.pdf({
          path: metaPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
        });

        // ── PDF 2: de live pagina zelf ───────────────────────────────────────
        let paginaOk = false;
        try {
          await browserPage.goto(page.url, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
          await dismissCookieBanner(browserPage);
          await browserPage.pdf({
            path: paginaPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
          });
          paginaOk = true;
        } catch (pageErr) {
          errors.push({ url: page.url, file: 'pagina', error: pageErr.message });
        }

        generatedFiles.push({
          meta:    `${prefix}_meta.pdf`,
          pagina:  paginaOk ? `${prefix}_pagina.pdf` : null,
          url:     page.url,
          findings: page.findings.length,
        });

      } catch (err) {
        errors.push({ url: page.url, error: err.message });
      } finally {
        await browserPage.close();
      }
    }

    await browser.close();

    console.log(JSON.stringify({
      success: true,
      files: generatedFiles,
      errors,
      output_dir: outputDir,
    }));
  });
}

main().catch(err => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
