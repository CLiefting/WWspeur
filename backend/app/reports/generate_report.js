const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
        ShadingType, LevelFormat, PageBreak, PageNumber } = require('docx');

// Read shop data from stdin
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const shop = JSON.parse(input);
  generateReport(shop).then(buffer => {
    const outPath = process.argv[2] || '/tmp/report.docx';
    fs.writeFileSync(outPath, buffer);
    console.log(JSON.stringify({ success: true, path: outPath }));
  }).catch(err => {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  });
});

function parseJSON(str) {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
}
function parseJSONObj(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

// Styling
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };
const headerShading = { fill: "2B3A4E", type: ShadingType.CLEAR };
const altRowShading = { fill: "F5F7FA", type: ShadingType.CLEAR };

const TABLE_WIDTH = 9360;
const COL2 = [4680, 4680];
const COL3 = [3120, 3120, 3120];

function headerCell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA }, shading: headerShading,
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 20 })] })]
  });
}
function cell(text, width, opts = {}) {
  const display = (text === null || text === undefined || text === 'null' || text === 'undefined') ? '' : String(text);
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    margins: cellMargins,
    shading: opts.shading,
    children: [new Paragraph({
      children: [new TextRun({ text: display || '—', font: "Arial", size: 20, bold: opts.bold, color: opts.color })]
    })]
  });
}
function infoRow(label, value, shading) {
  return new TableRow({ children: [
    cell(label, COL2[0], { bold: true, shading }),
    cell(value, COL2[1], { shading }),
  ]});
}
function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, font: "Arial" })] });
}
function para(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120 },
    children: [new TextRun({ text, font: "Arial", size: 22, ...opts })] });
}

async function generateReport(shop) {
  const children = [];
  const latestScrape = shop.scrape_records?.[shop.scrape_records?.length - 1];
  const latestWhois = shop.whois_records?.[shop.whois_records?.length - 1];
  const latestSSL = shop.ssl_records?.[shop.ssl_records?.length - 1];
  const latestDnsHttp = shop.dns_http_records?.[shop.dns_http_records?.length - 1];
  const latestTech = shop.tech_records?.[shop.tech_records?.length - 1];
  const latestTrustmark = shop.trustmark_records?.[shop.trustmark_records?.length - 1];
  const latestAdTracker = shop.ad_tracker_records?.[shop.ad_tracker_records?.length - 1];
  const latestScamCheck = shop.scam_check_records?.[shop.scam_check_records?.length - 1];
  const kvkRecords = shop.kvk_records || [];

  // ── Title ──
  children.push(new Paragraph({ spacing: { after: 100 },
    children: [new TextRun({ text: "WWSpeur Onderzoeksrapport", font: "Arial", size: 36, bold: true, color: "2B3A4E" })] }));
  children.push(new Paragraph({ spacing: { after: 50 },
    children: [new TextRun({ text: shop.domain, font: "Arial", size: 28, color: "D4A843" })] }));
  const latestScan = shop.scans?.[shop.scans?.length - 1];
  const scanDate = latestScan?.completed_at ? new Date(latestScan.completed_at).toLocaleString('nl-NL') : 'onbekend';
  children.push(new Paragraph({ spacing: { after: 200 },
    children: [new TextRun({ text: `URL: ${shop.url}  |  Gescand: ${scanDate}  |  Rapport: ${new Date().toLocaleString('nl-NL')}`, font: "Arial", size: 18, color: "888888" })] }));

  // ── Samenvatting ──
  children.push(heading("Samenvatting"));
  const emails = latestScrape ? parseJSON(latestScrape.emails_found) : [];
  const phones = latestScrape ? parseJSON(latestScrape.phones_found) : [];
  const addresses = latestScrape ? parseJSON(latestScrape.addresses_found) : [];

  children.push(new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2,
    rows: [
      infoRow("E-mailadressen gevonden", String(emails.length)),
      infoRow("Telefoonnummers gevonden", String(phones.length), altRowShading),
      infoRow("Adressen gevonden", String(addresses.length)),
      infoRow("Contactpagina", latestScrape?.has_contact_page ? "Ja" : "Nee", altRowShading),
      infoRow("Privacybeleid", latestScrape?.has_privacy_page ? "Ja" : "Nee"),
      infoRow("Algemene voorwaarden", latestScrape?.has_terms_page ? "Ja" : "Nee", altRowShading),
      infoRow("Retourbeleid", latestScrape?.has_return_policy ? "Ja" : "Nee"),
    ]
  }));

  // ── Bedrijfsgegevens ──
  children.push(heading("Bedrijfsgegevens"));
  const kvkVal = latestScrape?.kvk_number_found;
  const btwVal = latestScrape?.btw_number_found;
  const ibanVal = latestScrape?.iban_found;

  let kvkDisplay = '—';
  try { const p = JSON.parse(kvkVal); kvkDisplay = Array.isArray(p) ? p.join(', ') : String(p); } catch { if (kvkVal) kvkDisplay = kvkVal; }
  let btwDisplay = '—';
  try { const p = JSON.parse(btwVal); btwDisplay = Array.isArray(p) ? p.join(', ') : String(p); } catch { if (btwVal) btwDisplay = btwVal; }

  // Parse sources
  const srcDetails = latestScrape ? parseJSONObj(latestScrape.meta_description) : {};
  const kvkSources = srcDetails.kvk_sources || {};
  const btwSources = srcDetails.btw_sources || {};

  const kvkSourceList = Object.values(kvkSources).flat().slice(0,3);
  const btwSourceList = Object.values(btwSources).flat().slice(0,3);

  children.push(new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2,
    rows: [
      infoRow("KvK-nummer", kvkDisplay),
      ...(kvkSourceList.length > 0 ? [infoRow("  Gevonden op", kvkSourceList.join(", "), altRowShading)] : []),
      infoRow("BTW-nummer", btwDisplay, kvkSourceList.length > 0 ? undefined : altRowShading),
      ...(btwSourceList.length > 0 ? [infoRow("  Gevonden op", btwSourceList.join(", "), altRowShading)] : []),
    ]
  }));

  // ── Betalingen & Bankgegevens ──
  children.push(heading("Betalingen & Bankgegevens"));

  // Payment providers from tech detection
  const paymentProviders = latestTech ? parseJSON(latestTech.payment_providers) : [];

  // IBANs with country — always shown
  const COUNTRIES = { NL:'Nederland', DE:'Duitsland', BE:'België', GB:'Verenigd Koninkrijk', FR:'Frankrijk', ES:'Spanje', IT:'Italië', PT:'Portugal', AT:'Oostenrijk', CH:'Zwitserland', PL:'Polen' };
  let ibans = [];
  try { const p = JSON.parse(ibanVal); ibans = Array.isArray(p) ? p : [p]; } catch { if (ibanVal) ibans = [ibanVal]; }
  const validIbans = ibans.filter(Boolean);

  if (paymentProviders.length === 0 && validIbans.length === 0) {
    children.push(para("Geen gegevens gevonden.", { color: "888888" }));
  } else {
    children.push(new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2,
      rows: [
        infoRow("Betaalmethoden gedetecteerd",
          paymentProviders.length > 0 ? paymentProviders.join(', ') : 'Niet gedetecteerd'),
      ]
    }));

    children.push(para(""));
    children.push(para("Bankrekeningen (IBAN):", { bold: true }));
    if (validIbans.length > 0) {
      const byCountry = {};
      validIbans.forEach(iban => { const cc = (iban || '').substring(0,2).toUpperCase(); if (!byCountry[cc]) byCountry[cc] = []; byCountry[cc].push(iban); });
      const sorted = Object.keys(byCountry).sort((a,b) => a === 'NL' ? -1 : b === 'NL' ? 1 : a.localeCompare(b));

      const ibanRows = [new TableRow({ children: [headerCell("Land", COL3[0]), headerCell("IBAN", COL3[1]), headerCell("Landcode", COL3[2])] })];
      let alt = false;
      sorted.forEach(cc => {
        byCountry[cc].forEach(iban => {
          const sh = alt ? altRowShading : undefined;
          ibanRows.push(new TableRow({ children: [
            cell(COUNTRIES[cc] || cc, COL3[0], { shading: sh }),
            cell(iban, COL3[1], { shading: sh }),
            cell(cc, COL3[2], { shading: sh }),
          ]}));
          alt = !alt;
        });
      });
      children.push(new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL3, rows: ibanRows }));
    } else {
      children.push(para("Geen bankrekening (IBAN) gevonden op de website.", { color: "888888" }));
    }
  }

  // ── WHOIS ──
  children.push(heading("WHOIS Domeinregistratie"));
  if (latestWhois) {
    children.push(new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2,
      rows: [
        infoRow("Registrar", latestWhois.registrar || '—'),
        infoRow("Registrant", latestWhois.registrant_name || '—', altRowShading),
        infoRow("Organisatie", latestWhois.registrant_organization || '—'),
        infoRow("Land", latestWhois.registrant_country || '—', altRowShading),
        infoRow("Geregistreerd", latestWhois.registration_date || '—'),
        infoRow("Vervalt", latestWhois.expiration_date || '—', altRowShading),
        infoRow("Bijgewerkt", latestWhois.updated_date || '—'),
        infoRow("Domeinleeftijd", latestWhois.domain_age_days ? `${latestWhois.domain_age_days} dagen` : '—', altRowShading),
        infoRow("Privacy beschermd", latestWhois.is_privacy_protected ? "Ja" : (latestWhois.is_privacy_protected === false ? "Nee" : "—")),
        infoRow("Naamservers", (() => { try { const ns = JSON.parse(latestWhois.name_servers || '[]'); return ns.length ? ns.join(', ') : '—'; } catch { return latestWhois.name_servers || '—'; } })(), altRowShading),
      ]
    }));
  } else {
    children.push(para("Geen WHOIS-data beschikbaar (lookup mislukt of privacy-beschermd domein).", { color: "888888" }));
  }

  // ── SSL ──
  if (latestSSL) {
    children.push(heading("SSL Certificaat"));
    children.push(new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2,
      rows: [
        infoRow("SSL actief", latestSSL.has_ssl ? "Ja" : "Nee"),
        infoRow("Uitgever", latestSSL.issuer, altRowShading),
        infoRow("Geldig vanaf", latestSSL.valid_from),
        infoRow("Geldig tot", latestSSL.valid_until, altRowShading),
        infoRow("Verlopen", latestSSL.is_expired ? "Ja" : "Nee"),
        infoRow("Self-signed", latestSSL.is_self_signed ? "Ja" : "Nee", altRowShading),
      ]
    }));
  }

  // ── DNS / HTTP ──
  if (latestDnsHttp) {
    children.push(heading("DNS Records & HTTP Security"));
    const aRecords = parseJSON(latestDnsHttp.a_records);
    const aDisplay = aRecords.map(r => typeof r === 'object' ? `${r.ip} (${r.org || '?'})` : r).join(', ');

    children.push(new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2,
      rows: [
        infoRow("A records", aDisplay || '—'),
        infoRow("MX (e-mail)", latestDnsHttp.has_mx ? "Ja" : "Nee", altRowShading),
        infoRow("SPF", latestDnsHttp.has_spf ? "Ja" : "Nee"),
        infoRow("DMARC", latestDnsHttp.has_dmarc ? "Ja" : "Nee", altRowShading),
        infoRow("Security headers score", `${latestDnsHttp.security_score || 0}%`),
        infoRow("HTTP → HTTPS redirect", latestDnsHttp.http_to_https ? "Ja" : "Nee", altRowShading),
        infoRow("Aantal redirects", String(latestDnsHttp.redirect_count || 0)),
        infoRow("Domein wijzigt bij redirect", latestDnsHttp.domain_changed ? "Ja" : "Nee", altRowShading),
        infoRow("Server", latestDnsHttp.server_header || '—'),
      ]
    }));
  }

  // ── Technologie ──
  if (latestTech) {
    children.push(heading("Technologie Detectie"));
    const techCats = parseJSONObj(latestTech.technologies);
    const rows = [];
    if (latestTech.ecommerce_platform) rows.push(infoRow("E-commerce platform", latestTech.ecommerce_platform));
    if (latestTech.cms) rows.push(infoRow("CMS", latestTech.cms, altRowShading));

    const catLabels = { analytics:'Analytics', payment:'Betaalmethoden', privacy:'Cookie consent', trustmark:'Keurmerken', framework:'Frameworks', hosting:'Hosting/CDN', security:'Beveiliging' };
    let alt = false;
    for (const [cat, names] of Object.entries(techCats)) {
      if (names.length > 0) {
        rows.push(infoRow(catLabels[cat] || cat, names.join(', '), alt ? altRowShading : undefined));
        alt = !alt;
      }
    }
    if (rows.length > 0) {
      children.push(new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2, rows }));
    }

    // Shopify IDs
    const techRaw = parseJSONObj(latestTech.raw_data);
    const shopifyIds = techRaw.shopify_ids;
    if (shopifyIds && Object.keys(shopifyIds).length > 0) {
      children.push(para(""));
      children.push(para("Shopify Identiteit:", { bold: true }));
      if (shopifyIds.myshopify_domain) {
        children.push(para(`  Myshopify domein: ${shopifyIds.myshopify_domain[0]}`, { size: 20 }));
      }
      if (shopifyIds.shopify_shop) {
        children.push(para(`  Shopify shop: ${shopifyIds.shopify_shop[0]}`, { size: 20 }));
      }
      if (shopifyIds.shop_id) {
        children.push(para(`  Shop ID: ${shopifyIds.shop_id[0]}`, { size: 20 }));
      }
      if (shopifyIds.storefront_token) {
        children.push(para(`  Storefront token: ${shopifyIds.storefront_token[0]}`, { size: 20 }));
      }
    }
  }

  // ── Keurmerk verificatie ──
  if (latestTrustmark) {
    children.push(heading("Keurmerk Verificatie"));
    const verifications = parseJSON(latestTrustmark.verifications);
    if (verifications.length > 0) {
      const tmRows = [new TableRow({ children: [headerCell("Keurmerk", 3120), headerCell("Status", 3120), headerCell("Details", 3120)] })];
      let alt = false;
      verifications.forEach(v => {
        const sh = alt ? altRowShading : undefined;
        const statusMap = { verified:'Geverifieerd', found:'Gevonden', not_found:'Niet gevonden', check_failed:'Controle mislukt', likely_verified:'Waarschijnlijk' };
        let details = v.details || '';
        if (v.score) details += ` Score: ${v.score}/5`;
        if (v.reviews) details += ` (${v.reviews} reviews)`;
        if (v.claimed && !v.verified) details += ' (geclaimed, niet geverifieerd)';
        tmRows.push(new TableRow({ children: [
          cell(v.name, 3120, { shading: sh }),
          cell(statusMap[v.status] || v.status, 3120, { shading: sh }),
          cell(details, 3120, { shading: sh }),
        ]}));
        alt = !alt;
      });
      children.push(new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL3, rows: tmRows }));
    }
  }

  // ── KVK ──
  if (kvkRecords.length > 0) {
    children.push(heading("KVK Handelsregister"));
    kvkRecords.forEach(kvk => {
      const rows = [
        infoRow("KVK-nummer", kvk.kvk_number),
        infoRow("Bedrijfsnaam", kvk.company_name || '—', altRowShading),
        infoRow("Rechtsvorm", kvk.legal_form || '—'),
        infoRow("Adres", [kvk.street, kvk.house_number].filter(Boolean).join(' ') || '—', altRowShading),
        infoRow("Plaats", [kvk.postal_code, kvk.city].filter(Boolean).join(' ') || '—'),
        infoRow("Actief", kvk.is_active === false ? "Nee" : kvk.is_active === true ? "Ja" : "Onbekend", altRowShading),
      ];
      children.push(new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2, rows }));
    });
  }

  // ── Ad Trackers ──
  if (latestAdTracker) {
    children.push(heading("Advertentie Trackers"));
    const trackers = parseJSON(latestAdTracker.trackers);
    const crossRefs = parseJSON(latestAdTracker.cross_references);

    if (trackers.length > 0) {
      trackers.forEach(tracker => {
        children.push(para(`${tracker.name}:`, { bold: true }));
        tracker.ids?.forEach(idInfo => {
          children.push(para(`  ${idInfo.display_id}`));
          if (idInfo.online_results?.other_sites?.length > 0) {
            children.push(para(`    Ook gevonden op: ${idInfo.online_results.other_sites.map(s => s.domain).join(', ')}`, { size: 20 }));
          }
        });
      });
    }

    if (crossRefs.length > 0) {
      children.push(para(""));
      children.push(para("Cross-referenties:", { bold: true }));
      crossRefs.forEach(xref => {
        children.push(para(`${xref.id} (${xref.platform}) — ook op: ${xref.other_domains?.slice(0,5).join(', ')}`, { size: 20 }));
      });
    }
  }

  // ── Fraudedatabases ──
  if (latestScamCheck) {
    children.push(heading("Fraudedatabases Check"));
    const scamFlagged = latestScamCheck.flagged;
    const flaggedSources = [];
    if (latestScamCheck.opgelicht_found) flaggedSources.push('opgelicht.nl');
    if (latestScamCheck.fraudehelpdesk_found) flaggedSources.push('fraudehelpdesk.nl');
    if (latestScamCheck.watchlist_found) flaggedSources.push('watchlistinternet.nl');

    children.push(new Table({
      width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: COL2,
      rows: [
        infoRow("Domein", latestScamCheck.domain || '—'),
        infoRow("In fraudedatabase gevonden", scamFlagged ? "Ja" : "Nee", altRowShading),
        infoRow("Aantal meldingen", String(latestScamCheck.total_hits || 0)),
        infoRow("Gevonden in", flaggedSources.length > 0 ? flaggedSources.join(', ') : '—', altRowShading),
      ]
    }));

    if (scamFlagged) {
      children.push(para(""));
      const sourceRows = [new TableRow({ children: [headerCell("Bron", 3120), headerCell("Meldingen", 1560), headerCell("Details", 4680)] })];
      const sources = [
        { key: 'opgelicht', label: 'opgelicht.nl', found: latestScamCheck.opgelicht_found, count: latestScamCheck.opgelicht_count, hits: parseJSON(latestScamCheck.opgelicht_hits) },
        { key: 'fraudehelpdesk', label: 'fraudehelpdesk.nl', found: latestScamCheck.fraudehelpdesk_found, count: latestScamCheck.fraudehelpdesk_count, hits: parseJSON(latestScamCheck.fraudehelpdesk_hits) },
        { key: 'watchlist', label: 'watchlistinternet.nl', found: latestScamCheck.watchlist_found, count: latestScamCheck.watchlist_count, hits: parseJSON(latestScamCheck.watchlist_hits) },
      ];
      let alt = false;
      sources.forEach(s => {
        if (s.found) {
          const sh = alt ? altRowShading : undefined;
          sourceRows.push(new TableRow({ children: [
            cell(s.label, 3120, { shading: sh, bold: true }),
            cell(String(s.count), 1560, { shading: sh }),
            cell(s.hits.slice(0, 2).join(' | ') || '—', 4680, { shading: sh }),
          ]}));
          alt = !alt;
        }
      });
      if (sourceRows.length > 1) {
        children.push(new Table({ width: { size: TABLE_WIDTH, type: WidthType.DXA }, columnWidths: [3120, 1560, 4680], rows: sourceRows }));
      }
    }
  }

  // ── Contact gegevens met bronpagina's ──
  children.push(heading("Gevonden contactgegevens"));

  // Parse sources from meta_description (where detailed data is stored)
  const emailSources = srcDetails.email_sources || {};
  const phoneSources = srcDetails.phone_sources || {};
  const addressSources = srcDetails.address_sources || {};

  if (emails.length > 0) {
    children.push(para("E-mailadressen:", { bold: true }));
    emails.forEach(e => {
      const sources = emailSources[e] || [];
      children.push(para(`  ${e}`, { size: 20 }));
      if (sources.length > 0) {
        children.push(para(`    Gevonden op: ${sources.slice(0,3).join(', ')}`, { size: 16, color: "888888" }));
      }
    });
  }
  if (phones.length > 0) {
    children.push(para("Telefoonnummers:", { bold: true }));
    phones.forEach(p => {
      const sources = phoneSources[p] || [];
      children.push(para(`  ${p}`, { size: 20 }));
      if (sources.length > 0) {
        children.push(para(`    Gevonden op: ${sources.slice(0,3).join(', ')}`, { size: 16, color: "888888" }));
      }
    });
  }
  if (addresses.length > 0) {
    children.push(para("Adressen:", { bold: true }));
    addresses.forEach(a => {
      const sources = addressSources[a] || [];
      children.push(para(`  ${a}`, { size: 20 }));
      if (sources.length > 0) {
        children.push(para(`    Gevonden op: ${sources.slice(0,3).join(', ')}`, { size: 16, color: "888888" }));
      }
    });
  }

  // Social media
  const socialMedia = latestScrape ? parseJSONObj(latestScrape.social_media_links) : {};
  if (Object.keys(socialMedia).length > 0) {
    children.push(para("Social media:", { bold: true }));
    for (const [platform, url] of Object.entries(socialMedia)) {
      children.push(para(`  ${platform}: ${url}`, { size: 20 }));
    }
  }

  // ── Document ──
  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 32, bold: true, font: "Arial", color: "2B3A4E" },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1440, right: 1200, bottom: 1440, left: 1200 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: `WWSpeur — ${shop.domain}`, font: "Arial", size: 16, color: "999999" })]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "WWSpeur Webwinkel Investigator — Pagina ", font: "Arial", size: 16, color: "999999" }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" }),
            ]
          })]
        })
      },
      children,
    }]
  });

  return Packer.toBuffer(doc);
}
