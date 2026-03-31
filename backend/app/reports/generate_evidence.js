/**
 * Bewijs-PDF generator voor WWSpeur.
 *
 * Per URL waarop bevindingen zijn gedaan:
 *  1. Open de pagina in een headless browser (Puppeteer)
 *  2. Maak een full-page screenshot
 *  3. Genereer een PDF met: metadata + tabel van bevindingen + screenshot
 *
 * Input (stdin): JSON met shop + brongegevens (zie shops.py)
 * Gebruik: node generate_evidence.js <output_dir>
 */

'use strict';

const fs   = require('fs');
const path = require('path');
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

/** Verzamel alle unieke bronpagina's en wat er per pagina gevonden is. */
function collectSourcePages(shop) {
  const latestScrape = shop.scrape_records?.[shop.scrape_records.length - 1];
  if (!latestScrape) return [];

  const srcDetails  = parseJSONObj(latestScrape.meta_description);
  const emailSrc    = srcDetails.email_sources    || {};
  const phoneSrc    = srcDetails.phone_sources    || {};
  const addressSrc  = srcDetails.address_sources  || {};
  const kvkSrc      = srcDetails.kvk_sources      || {};
  const btwSrc      = srcDetails.btw_sources      || {};
  const ibanSrc     = srcDetails.iban_sources     || {};

  // Bouw een map: url → { emails, phones, addresses, kvk, btw, iban }
  const pageMap = {};

  const add = (srcObj, key, label) => {
    for (const [value, urls] of Object.entries(srcObj)) {
      const list = Array.isArray(urls) ? urls : [urls];
      for (const url of list) {
        if (!url) continue;
        if (!pageMap[url]) pageMap[url] = { url, findings: [] };
        pageMap[url].findings.push({ label, value });
      }
    }
  };

  add(emailSrc,   'email',   'E-mailadres');
  add(phoneSrc,   'phone',   'Telefoonnummer');
  add(addressSrc, 'address', 'Adres');

  // kvk/btw/iban: { 'waarde': ['url1', 'url2'] }
  for (const [val, urls] of Object.entries(kvkSrc.found || kvkSrc)) {
    const list = Array.isArray(urls) ? urls : [urls];
    for (const url of list) {
      if (!url) continue;
      if (!pageMap[url]) pageMap[url] = { url, findings: [] };
      pageMap[url].findings.push({ label: 'KvK-nummer', value: val });
    }
  }

  // iban_sources is soms een object met { 'NL...' : ['url'] }
  for (const [val, urls] of Object.entries(ibanSrc)) {
    const list = Array.isArray(urls) ? urls : [urls];
    for (const url of list) {
      if (!url) continue;
      if (!pageMap[url]) pageMap[url] = { url, findings: [] };
      pageMap[url].findings.push({ label: 'IBAN', value: val });
    }
  }

  // Fallback: als er helemaal geen bronpagina's zijn maar wel data,
  // gebruik dan de source_url van het scrape record zelf.
  if (Object.keys(pageMap).length === 0 && latestScrape.source_url) {
    const findings = [];
    parseJSON(latestScrape.emails_found).forEach(v => findings.push({ label: 'E-mailadres', value: v }));
    parseJSON(latestScrape.phones_found).forEach(v => findings.push({ label: 'Telefoonnummer', value: v }));
    parseJSON(latestScrape.addresses_found).forEach(v => findings.push({ label: 'Adres', value: v }));
    if (findings.length > 0) {
      pageMap[latestScrape.source_url] = { url: latestScrape.source_url, findings };
    }
  }

  return Object.values(pageMap).filter(p => p.findings.length > 0);
}

/** Genereer de HTML voor de bewijspagina (voor Puppeteer → PDF). */
function buildEvidenceHtml(page, shop, timestamp) {
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
  body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 24px; }
  .header { border-bottom: 2px solid #2B3A4E; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { font-size: 18px; color: #2B3A4E; }
  .header .sub { font-size: 11px; color: #888; margin-top: 4px; }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .meta-table td { padding: 5px 8px; border: 1px solid #ddd; font-size: 11px; }
  .meta-table td:first-child { font-weight: bold; background: #f5f7fa; width: 140px; }
  .findings-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .findings-table th { background: #2B3A4E; color: #fff; padding: 6px 10px; text-align: left; font-size: 11px; }
  .findings-table td { padding: 5px 10px; border: 1px solid #ddd; font-size: 12px; }
  .findings-table tr.alt td { background: #f5f7fa; }
  .url-box { background: #f0f4f8; border: 1px solid #ccc; border-radius: 4px;
             padding: 6px 10px; font-family: monospace; font-size: 11px;
             word-break: break-all; margin-bottom: 16px; }
  .screenshot-label { font-size: 11px; font-weight: bold; color: #555; margin-bottom: 6px; }
  .screenshot img { max-width: 100%; border: 1px solid #ccc; }
  .footer { margin-top: 20px; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }
</style>
</head>
<body>
  <div class="header">
    <h1>WWSpeur — Bewijsdocument</h1>
    <div class="sub">${escHtml(shop.domain)} &nbsp;|&nbsp; Gegenereerd: ${escHtml(timestamp)}</div>
  </div>

  <table class="meta-table">
    <tr><td>Webwinkel</td><td>${escHtml(shop.url)}</td></tr>
    <tr><td>Domein</td><td>${escHtml(shop.domain)}</td></tr>
    <tr><td>Tijdstip bezoek</td><td>${escHtml(timestamp)}</td></tr>
  </table>

  <div class="url-box">Bronpagina: ${escHtml(page.url)}</div>

  <table class="findings-table">
    <thead><tr><th>Type</th><th>Gevonden waarde</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="screenshot-label">Screenshot van de pagina op het moment van bezoek:</div>
  <div class="screenshot" id="screenshot-placeholder"></div>

  <div class="footer">
    Dit document is automatisch gegenereerd door WWSpeur op ${escHtml(timestamp)}.
    Het dient als bewijs dat de bovenstaande gegevens zijn aangetroffen op de genoemde URL.
  </div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Maak een veilige bestandsnaam van een URL. */
function urlToFilename(url, index) {
  const safe = url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  return `bewijs_${String(index + 1).padStart(3, '0')}_${safe}.pdf`;
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
      const page = pages[i];
      const filename = urlToFilename(page.url, i);
      const outPath  = path.join(outputDir, filename);

      const browserPage = await browser.newPage();
      try {
        // Beperk laadtijd tot 20 seconden
        await browserPage.setViewport({ width: 1280, height: 900 });
        await browserPage.goto(page.url, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        // Screenshot als base64
        const screenshotB64 = await browserPage.screenshot({
          encoding: 'base64',
          fullPage: false,  // viewport-hoogte is genoeg als bewijs
          type: 'png',
        });

        // Bouw HTML met screenshot erin
        const html = buildEvidenceHtml(page, shop, timestamp)
          .replace(
            '<div class="screenshot" id="screenshot-placeholder"></div>',
            `<div class="screenshot"><img src="data:image/png;base64,${screenshotB64}" /></div>`
          );

        // Render HTML → PDF
        await browserPage.setContent(html, { waitUntil: 'load' });
        await browserPage.pdf({
          path: outPath,
          format: 'A4',
          printBackground: true,
          margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
        });

        generatedFiles.push({ filename, url: page.url, findings: page.findings.length });

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
