"""
HTML Scraper Collector - v2

Fixes: KvK regex, www normalization, /tc/ terms detection,
address dedup, progress callback for frontend.
"""
import re
import json
import hashlib
import logging
import time
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin, urldefrag, parse_qs, urlencode
from typing import Optional
from dataclasses import dataclass, field

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

DEFAULT_MAX_PAGES = 50
REQUEST_TIMEOUT = 15
DELAY_BETWEEN_REQUESTS = 0.5
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

PRIORITY_PAGE_PATTERNS = [
    r"/contact", r"/over-ons", r"/about", r"/about-us",
    r"/voorwaarden", r"/algemene-voorwaarden", r"/terms",
    r"/tc/",
    r"/privacy", r"/privacybeleid",
    r"/retour", r"/return", r"/retourneren",
    r"/klantenservice", r"/customer-service",
    r"/impressum", r"/disclaimer", r"/bedrijfsgegevens",
    r"/betaal", r"/betalings", r"/betaalmethod", r"/payment",
    r"/verzend", r"/shipping", r"/levering", r"/delivery",
    r"/over", r"/info", r"/wie-zijn",
    r"/faq", r"/help", r"/service",
    r"/sitemap",
    r"/bankgegeven", r"/rekeningnummer",
]

# URL-patronen die duiden op productpagina's — laagste prioriteit
PRODUCT_PAGE_PATTERNS = [
    re.compile(r"/product[s]?/", re.I),
    re.compile(r"/producten/", re.I),
    re.compile(r"/artikel[en]?/", re.I),
    re.compile(r"/item[s]?/", re.I),
    re.compile(r"/collections?/.+/.+", re.I),   # Shopify: /collections/categorie/product
    re.compile(r"/shop/[^/]+-\d{4,}", re.I),    # /shop/naam-12345
    re.compile(r"/p/[a-z0-9\-]{5,}", re.I),     # /p/product-slug
    re.compile(r"/[a-z0-9\-]+-\d{6,}", re.I),   # slug-met-lang-nummer
    re.compile(r"[?&](product|item|id)=\d+", re.I),
]


def _is_product_url(url: str) -> bool:
    """Heuristische check of een URL waarschijnlijk een productpagina is."""
    path_and_query = url.split("://", 1)[-1].split("/", 1)[-1] if "/" in url else ""
    return any(p.search("/" + path_and_query) for p in PRODUCT_PAGE_PATTERNS)

EMAIL_PATTERN = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", re.IGNORECASE,
)
EMAIL_EXCLUDE = re.compile(
    r"\.(png|jpg|jpeg|gif|svg|webp|css|js|woff|ttf|eot)$", re.IGNORECASE,
)

PHONE_PATTERNS = [
    re.compile(r"(?<!\d)(?:\+31|0031)[\s\-.]?[1-9](?:[\s\-.]?\d){8}(?!\d)"),
    re.compile(r"(?<!\d)0[1-9](?:[\s\-.]?\d){8}(?!\d)"),
    re.compile(r"(?<!\d)0[1-9]\d[\s\-.]?\d{3}[\s\-.]?\d{4}(?!\d)"),
    re.compile(r"(?<!\d)\+\d{1,3}[\s\-.]?\d[\s\-.]?(?:\d[\s\-.]?){7,12}(?!\d)"),
]

KVK_PATTERNS = [
    re.compile(r"(?i)(?:kvk|kamer\s*van\s*koophandel|handelsregister)[\s:\-\.]*(?:nummer|nr|no)?[\s:\-\.]*(\d{8})\b"),
    re.compile(r"(?i)(?:CoC|Chamber\s*of\s*Commerce)[\s:\-#\.]*(\d{8})\b"),
    re.compile(r"(?i)(?:kvk|kamer van koophandel|handelsregister|coc).{0,30}?(\d{8})\b"),
    re.compile(r"(?i)(?:registratie|registration)[\s\-]*(?:nummer|number|nr)[\s:\-\.]*(\d{8})\b"),
]

BTW_PATTERNS = [
    re.compile(r"(?i)(?:btw|vat|omzetbelasting)[\s:\-]*(NL\d{9}B\d{2})"),
    re.compile(r"\bNL\d{9}B\d{2}\b"),
]

IBAN_PATTERN = re.compile(r"\b[A-Z]{2}\d{2}[\s]?[A-Z]{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{2,4}\b")

ADDRESS_PATTERN = re.compile(
    r"([A-Z][a-z\u00e9\u00e8\u00eb\u00ef\u00f6\u00fc\u00e1]+(?:\s[a-z]+)*(?:straat|weg|laan|plein|gracht|kade|singel|dijk|pad|dreef|hof|markt|ring|steeg|burcht|park))"
    r"\s+(\d{1,5}(?:\s?[a-zA-Z]{1,3})?)"
    r"(?:[,\s]+(\d{4}\s?[A-Z]{2}))?"
    r"(?:[,\s]+([A-Z][a-z]+(?:\s[A-Z]?[a-z]+)*))?",
    re.UNICODE,
)

ADDRESS_CONTEXT_PATTERN = re.compile(
    r"([\w\.\-]+\s+\d{1,5}[\w]?[,\s]+\d{4}\s?[A-Z]{2}(?:[,\s]+[A-Z][\w\s]{2,30})?)",
    re.UNICODE,
)

SOCIAL_MEDIA_DOMAINS = {
    "facebook.com": "facebook", "fb.com": "facebook",
    "instagram.com": "instagram", "twitter.com": "twitter",
    "x.com": "twitter", "linkedin.com": "linkedin",
    "youtube.com": "youtube", "tiktok.com": "tiktok",
    "pinterest.com": "pinterest", "trustpilot.com": "trustpilot",
}

# --- Checklist keyword detectie (meertalig) ---

OPENING_SOON_KEYWORDS = [
    # NL
    "binnenkort geopend", "binnenkort beschikbaar", "binnenkort online", "binnenkort open",
    "nog even geduld", "lancering",
    # EN
    "coming soon", "opening soon", "launching soon", "under construction", "launch soon",
    # DE
    "demnächst", "bald verfügbar", "in kürze",
    # FR
    "bientôt", "prochainement", "ouverture prochaine",
    # ES/PT/IT
    "próximamente", "em breve", "prossimamente",
]

MAINTENANCE_KEYWORDS = [
    # NL
    "in onderhoud", "tijdelijk offline", "onderhoudswerkzaamheden",
    "tijdelijk niet beschikbaar", "gepland onderhoud", "wij zijn tijdelijk",
    # EN
    "under maintenance", "down for maintenance", "maintenance mode",
    "temporarily unavailable", "we'll be back", "be back soon", "site is down",
    # DE
    "wartungsarbeiten", "wir arbeiten daran", "vorübergehend nicht",
    # FR
    "en maintenance", "en cours de maintenance", "temporairement indisponible",
]

DELIVERY_TIME_KEYWORDS = [
    # NL
    "levertijd", "bezorgtijd", "verzendtijd", "werkdag", "werkdagen",
    "bezorgd binnen", "levert binnen", "verwachte levering", "verzending binnen",
    # EN
    "delivery time", "shipping time", "business day", "ships within",
    "dispatched within", "delivered within", "estimated delivery", "delivery within",
    # DE
    "lieferzeit", "werktage", "lieferung innerhalb",
    # FR
    "délai de livraison", "jours ouvrables", "livraison sous",
    # ES
    "plazo de entrega", "días hábiles",
]

PREORDER_KEYWORDS = [
    # NL
    "voorbestelling", "pre-order", "pre-bestellen", "vooraf bestellen",
    # EN
    "pre-order", "preorder", "pre-sale", "presale", "pre order",
    # DE
    "vorbestellung", "vorbestellen",
    # FR
    "précommande", "pré-commande",
    # ES
    "pre-pedido", "preventa",
]

PRICE_PATTERN = re.compile(r'[€$£]\s*(\d{1,4}(?:[.,]\d{2})?)\b')


@dataclass
class ScrapedPage:
    url: str
    status_code: int
    page_title: Optional[str] = None
    meta_description: Optional[str] = None
    emails: set = field(default_factory=set)
    phones: set = field(default_factory=set)
    external_links: set = field(default_factory=set)
    internal_links: set = field(default_factory=set)
    kvk_numbers: set = field(default_factory=set)
    btw_numbers: set = field(default_factory=set)
    iban_numbers: set = field(default_factory=set)
    addresses: set = field(default_factory=set)
    social_media: dict = field(default_factory=dict)
    has_terms_page: bool = False
    has_privacy_page: bool = False
    has_contact_page: bool = False
    has_return_policy: bool = False
    is_opening_soon: bool = False
    is_maintenance: bool = False
    has_delivery_time: bool = False
    has_preorder: bool = False
    has_whatsapp_contact: bool = False
    has_suspicious_prices: bool = False
    detected_languages: list = field(default_factory=list)
    server_header: Optional[str] = None
    redirect_chain: list = field(default_factory=list)
    html_hash: Optional[str] = None


@dataclass
class CrawlResult:
    base_url: str
    domain: str
    pages_crawled: int = 0
    pages_failed: int = 0
    emails: set = field(default_factory=set)
    phones: set = field(default_factory=set)
    external_links: set = field(default_factory=set)
    kvk_numbers: set = field(default_factory=set)
    btw_numbers: set = field(default_factory=set)
    iban_numbers: set = field(default_factory=set)
    addresses: set = field(default_factory=set)
    social_media: dict = field(default_factory=dict)
    page_titles: dict = field(default_factory=dict)
    has_terms_page: bool = False
    has_privacy_page: bool = False
    has_contact_page: bool = False
    has_return_policy: bool = False
    is_opening_soon: bool = False
    is_maintenance: bool = False
    has_delivery_time: bool = False
    has_preorder: bool = False
    has_whatsapp_contact: bool = False
    has_suspicious_prices: bool = False
    detected_languages: list = field(default_factory=list)
    email_sources: dict = field(default_factory=dict)
    phone_sources: dict = field(default_factory=dict)
    kvk_sources: dict = field(default_factory=dict)
    btw_sources: dict = field(default_factory=dict)
    address_sources: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "base_url": self.base_url, "domain": self.domain,
            "pages_crawled": self.pages_crawled, "pages_failed": self.pages_failed,
            "emails": sorted(self.emails), "phones": sorted(self.phones),
            "external_links": sorted(self.external_links),
            "kvk_numbers": sorted(self.kvk_numbers),
            "btw_numbers": sorted(self.btw_numbers),
            "iban_numbers": sorted(self.iban_numbers),
            "addresses": sorted(self.addresses),
            "social_media": self.social_media,
            "page_titles": self.page_titles,
            "has_terms_page": self.has_terms_page,
            "has_privacy_page": self.has_privacy_page,
            "has_contact_page": self.has_contact_page,
            "has_return_policy": self.has_return_policy,
            "email_sources": {k: list(v) for k, v in self.email_sources.items()},
            "phone_sources": {k: list(v) for k, v in self.phone_sources.items()},
            "kvk_sources": {k: list(v) for k, v in self.kvk_sources.items()},
            "btw_sources": {k: list(v) for k, v in self.btw_sources.items()},
            "address_sources": {k: list(v) for k, v in self.address_sources.items()},
            "errors": self.errors,
        }


def classify_social_media(url):
    parsed = urlparse(url)
    domain = parsed.netloc.lower().lstrip("www.")
    for social_domain, platform in SOCIAL_MEDIA_DOMAINS.items():
        if domain == social_domain or domain.endswith("." + social_domain):
            return (platform, url)
    return None


def _normalize_url(url):
    """Normalize URL: strip www, trailing slash, tracking params."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parsed.path
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    clean = f"{parsed.scheme}://{host}{path}"
    if parsed.query:
        params = parse_qs(parsed.query)
        tracking = {"utm_source", "utm_medium", "utm_campaign", "utm_content",
                     "utm_term", "fbclid", "gclid"}
        filtered = {k: v for k, v in params.items() if k.lower() not in tracking}
        if filtered:
            clean += "?" + urlencode(filtered, doseq=True)
    return clean


def _is_same_domain(url, base_domain):
    parsed = urlparse(url)
    domain = parsed.netloc.lower().lstrip("www.")
    return domain == base_domain or domain.endswith("." + base_domain)


def _is_scrapeable_url(url):
    skip_extensions = {
        ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
        ".css", ".js", ".zip", ".rar", ".doc", ".docx", ".xls",
        ".xlsx", ".mp3", ".mp4", ".avi", ".mov", ".woff", ".woff2",
        ".ttf", ".eot", ".ico",
    }
    path = urlparse(url).path.lower()
    return not any(path.endswith(ext) for ext in skip_extensions)


def _check_page_type(url):
    path = urlparse(url).path.lower()
    return {
        "is_contact": any(p in path for p in [
            "/contact", "/klantenservice", "/customer-service", "/bedrijfsgegevens"]),
        "is_terms": any(p in path for p in [
            "/voorwaarden", "/algemene-voorwaarden", "/terms", "/tc/"]),
        "is_privacy": any(p in path for p in [
            "/privacy", "/privacybeleid", "/privacy-policy"]),
        "is_return": any(p in path for p in [
            "/retour", "/return", "/ruil", "/retourneren"]),
    }


def _detect_opening_soon(text_lower):
    return any(kw in text_lower for kw in OPENING_SOON_KEYWORDS)


def _detect_maintenance(text_lower, status_code):
    if status_code == 503:
        return True
    return any(kw in text_lower for kw in MAINTENANCE_KEYWORDS)


def _detect_languages(soup):
    """Detecteer talen via HTML lang-attribuut en hreflang-links."""
    langs = []
    html_tag = soup.find("html")
    if html_tag and html_tag.get("lang"):
        lang = html_tag["lang"].split("-")[0].lower()
        if len(lang) == 2 and lang not in langs:
            langs.append(lang)
    for link in soup.find_all("link", rel=lambda r: r and "alternate" in r):
        hreflang = link.get("hreflang", "")
        if hreflang and hreflang != "x-default":
            lang = hreflang.split("-")[0].lower()
            if len(lang) == 2 and lang not in langs:
                langs.append(lang)
    return langs


def _detect_delivery_time(text_lower):
    return any(kw in text_lower for kw in DELIVERY_TIME_KEYWORDS)


def _detect_preorder(text_lower):
    return any(kw in text_lower for kw in PREORDER_KEYWORDS)


def _detect_whatsapp(html, external_links):
    html_lower = html.lower()
    if any(p in html_lower for p in ["wa.me/", "api.whatsapp.com", "whatsapp.com/send"]):
        return True
    if "whatsapp" in html_lower:
        return True
    return any("wa.me/" in link.lower() or "api.whatsapp.com" in link.lower()
               for link in external_links)


def _detect_suspicious_prices(text):
    """Vlag als er prijzen onder €3 gedetecteerd worden (heuristiek)."""
    prices = []
    for match in PRICE_PATTERN.finditer(text):
        val_str = match.group(1).replace(",", ".")
        try:
            prices.append(float(val_str))
        except ValueError:
            pass
    valid = [p for p in prices if p > 0]
    return bool(valid) and min(valid) < 3.0


def _extract_emails(text, html):
    emails = set()
    for match in EMAIL_PATTERN.finditer(text):
        email = match.group().lower().strip(".")
        if not EMAIL_EXCLUDE.search(email):
            emails.add(email)
    for match in re.finditer(r'mailto:([^"\'?\s]+)', html, re.IGNORECASE):
        email = match.group(1).lower().strip(".")
        if "@" in email and not EMAIL_EXCLUDE.search(email):
            emails.add(email.split("?")[0])
    return emails


def _extract_phones(text):
    phones = set()
    for pattern in PHONE_PATTERNS:
        for match in pattern.finditer(text):
            phone = re.sub(r"[\s\-.]", "", match.group())
            if len(re.sub(r"\D", "", phone)) >= 10:
                phones.add(phone)
    return phones


def _extract_kvk(text):
    numbers = set()
    for pattern in KVK_PATTERNS:
        for match in pattern.finditer(text):
            num = match.group(1) if match.lastindex else match.group()
            if num and len(num) == 8 and num[0] != '0':
                numbers.add(num)
    return numbers


def _extract_btw(text):
    numbers = set()
    for pattern in BTW_PATTERNS:
        for match in pattern.finditer(text):
            btw = match.group(1) if match.lastindex else match.group()
            numbers.add(btw.upper().replace(" ", ""))
    return numbers


def _extract_iban(text):
    return {match.group().replace(" ", "") for match in IBAN_PATTERN.finditer(text)}


def _extract_structured_data(soup) -> dict:
    """
    Extraheer gegevens uit JSON-LD structured data en relevante meta-tags.
    Geeft een dict terug met emails, phones, kvk_numbers, btw_numbers,
    iban_numbers en addresses (allemaal sets).
    """
    result = {
        "emails": set(), "phones": set(), "kvk_numbers": set(),
        "btw_numbers": set(), "iban_numbers": set(), "addresses": set(),
    }

    # JSON-LD blokken
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue

        # Verwerk zowel enkel object als @graph array
        items = data if isinstance(data, list) else data.get("@graph", [data])
        for item in items:
            if not isinstance(item, dict):
                continue

            # Email
            for field in ("email", "contactEmail"):
                val = item.get(field, "")
                if val and "@" in str(val):
                    result["emails"].add(str(val).lower().strip())

            # Telefoon
            for field in ("telephone", "faxNumber", "contactTelephone"):
                val = item.get(field, "")
                if val:
                    for phone in _extract_phones(str(val)):
                        result["phones"].add(phone)

            # BTW / KvK via taxID / vatID
            for field in ("taxID", "vatID", "leiCode"):
                val = str(item.get(field, "")).strip()
                if not val:
                    continue
                for btw in _extract_btw(val):
                    result["btw_numbers"].add(btw)
                for kvk in _extract_kvk(val):
                    result["kvk_numbers"].add(kvk)
                # KvK als puur 8-cijferig getal
                if re.fullmatch(r"\d{8}", val) and val[0] != "0":
                    result["kvk_numbers"].add(val)

            # Adres uit PostalAddress
            addr_obj = item.get("address", {})
            if isinstance(addr_obj, dict):
                street = addr_obj.get("streetAddress", "")
                postal = addr_obj.get("postalCode", "")
                city = addr_obj.get("addressLocality", "")
                parts = [p for p in [street, postal, city] if p]
                if len(parts) >= 2:
                    result["addresses"].add(" ".join(parts))

            # Scan volledige tekst van het item op KvK/BTW/IBAN
            raw = json.dumps(item)
            for kvk in _extract_kvk(raw):
                result["kvk_numbers"].add(kvk)
            for btw in _extract_btw(raw):
                result["btw_numbers"].add(btw)
            for iban in _extract_iban(raw):
                result["iban_numbers"].add(iban)

    # Meta-tags (og, business, verificatie)
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or meta.get("property") or "").lower()
        content = (meta.get("content") or "").strip()
        if not content:
            continue
        if "email" in name and "@" in content:
            result["emails"].add(content.lower())
        if any(k in name for k in ("phone", "telefoon", "tel")):
            for phone in _extract_phones(content):
                result["phones"].add(phone)
        if any(k in name for k in ("kvk", "coc", "chamber")):
            for kvk in _extract_kvk(content):
                result["kvk_numbers"].add(kvk)
            if re.fullmatch(r"\d{8}", content) and content[0] != "0":
                result["kvk_numbers"].add(content)
        if any(k in name for k in ("vat", "btw", "tax")):
            for btw in _extract_btw(content):
                result["btw_numbers"].add(btw)

    return result


def _extract_addresses(text):
    addresses = set()
    for match in ADDRESS_PATTERN.finditer(text):
        parts = [p.strip() for p in match.groups() if p]
        addr = " ".join(parts)
        if len(addr) > 10:
            addresses.add(addr)
    for match in ADDRESS_CONTEXT_PATTERN.finditer(text):
        addr = re.sub(r"\s+", " ", match.group().strip())
        if 10 < len(addr) < 120:
            addresses.add(addr)
    # Deduplicate substrings
    deduped = set()
    for addr in sorted(addresses, key=len, reverse=True):
        if not any(addr in kept for kept in deduped):
            deduped.add(addr)
    return deduped


def scrape_page(url, session):
    try:
        response = session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        page = ScrapedPage(url=url, status_code=response.status_code,
                           server_header=response.headers.get("Server"))
        if response.history:
            page.redirect_chain = [r.url for r in response.history]
        if "text/html" not in response.headers.get("Content-Type", ""):
            return page

        html = response.text
        page.html_hash = hashlib.sha256(html.encode()).hexdigest()
        soup = BeautifulSoup(html, "lxml")

        # Taaldetectie VOOR het verwijderen van script-tags (lang-attr zit op <html>)
        page.detected_languages = _detect_languages(soup)

        # Structured data VOOR het verwijderen van script-tags
        structured = _extract_structured_data(soup)

        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()

        title_tag = soup.find("title")
        page.page_title = title_tag.get_text(strip=True) if title_tag else None
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc:
            page.meta_description = meta_desc.get("content", "")

        visible_text = soup.get_text(separator=" ", strip=True)
        page.emails = _extract_emails(visible_text, html) | structured["emails"]
        page.phones = _extract_phones(visible_text) | structured["phones"]
        page.kvk_numbers = _extract_kvk(visible_text) | structured["kvk_numbers"]
        page.btw_numbers = _extract_btw(visible_text) | structured["btw_numbers"]
        page.iban_numbers = _extract_iban(visible_text) | structured["iban_numbers"]
        page.addresses = _extract_addresses(visible_text) | structured["addresses"]
        page.emails |= _extract_emails("", html)

        base_domain = urlparse(url).netloc.lower().lstrip("www.")
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"].strip()
            if not href or href.startswith(("#", "javascript:", "tel:", "mailto:")):
                continue
            full_url, _ = urldefrag(urljoin(url, href))
            if not full_url.startswith(("http://", "https://")):
                continue
            if _is_same_domain(full_url, base_domain):
                if _is_scrapeable_url(full_url):
                    page.internal_links.add(_normalize_url(full_url))
            else:
                page.external_links.add(full_url)
                social = classify_social_media(full_url)
                if social:
                    page.social_media[social[0]] = social[1]

        pt = _check_page_type(url)
        page.has_contact_page = pt["is_contact"]
        page.has_terms_page = pt["is_terms"]
        page.has_privacy_page = pt["is_privacy"]
        page.has_return_policy = pt["is_return"]

        text_lower = visible_text.lower()
        page.is_opening_soon = _detect_opening_soon(text_lower)
        page.is_maintenance = _detect_maintenance(text_lower, response.status_code)
        page.has_delivery_time = _detect_delivery_time(text_lower)
        page.has_preorder = _detect_preorder(text_lower)
        page.has_whatsapp_contact = _detect_whatsapp(html, page.external_links)
        page.has_suspicious_prices = _detect_suspicious_prices(visible_text)
        return page

    except requests.Timeout:
        logger.warning(f"Timeout bij ophalen van {url}")
    except requests.ConnectionError:
        logger.warning(f"Verbindingsfout bij {url}")
    except Exception as e:
        logger.error(f"Fout bij scrapen van {url}: {e}")
    return None


def _add_source(source_dict, item, url):
    if item not in source_dict:
        source_dict[item] = set()
    source_dict[item].add(url)


def crawl_website(start_url, max_pages=DEFAULT_MAX_PAGES,
                  on_page_scraped=None, on_progress=None):
    if not start_url.startswith(("http://", "https://")):
        start_url = "https://" + start_url

    base_domain = urlparse(start_url).netloc.lower().lstrip("www.")
    result = CrawlResult(base_url=start_url, domain=base_domain)

    visited = set()
    priority_queue = []
    normal_queue = [_normalize_url(start_url)]
    product_queue = []
    # Max productpagina's: hoogstens 20% van budget, minimaal 3
    max_product_pages = max(3, max_pages // 5)

    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
    })

    def enqueue_links(links):
        for link in links:
            normalized = _normalize_url(link)
            if normalized in visited:
                continue
            path = urlparse(link).path.lower()
            if any(p in path for p in PRIORITY_PAGE_PATTERNS):
                if normalized not in [_normalize_url(u) for u in priority_queue]:
                    priority_queue.append(link)
            elif _is_product_url(link):
                if normalized not in [_normalize_url(u) for u in product_queue]:
                    product_queue.append(link)
            else:
                if normalized not in [_normalize_url(u) for u in normal_queue]:
                    normal_queue.append(link)

    page_count = 0
    product_pages_crawled = 0
    while (priority_queue or normal_queue or product_queue) and page_count < max_pages:
        if priority_queue:
            url = priority_queue.pop(0)
        elif normal_queue:
            url = normal_queue.pop(0)
        elif product_pages_crawled < max_product_pages:
            url = product_queue.pop(0)
        else:
            break
        normalized = _normalize_url(url)
        if normalized in visited:
            continue
        visited.add(normalized)

        if on_page_scraped:
            on_page_scraped(url, page_count + 1, len(priority_queue) + len(normal_queue))

        logger.info(f"Scraping [{page_count + 1}/{max_pages}]: {url}")
        page = scrape_page(url, session)

        if page is None:
            result.pages_failed += 1
            result.errors.append({"url": url, "error": "Kon pagina niet ophalen"})
            continue
        if page.status_code >= 400:
            result.pages_failed += 1
            result.errors.append({"url": url, "error": f"HTTP {page.status_code}"})
            continue

        page_count += 1
        result.pages_crawled += 1
        if _is_product_url(url):
            product_pages_crawled += 1

        if page.page_title:
            result.page_titles[url] = page.page_title

        for email in page.emails:
            result.emails.add(email)
            _add_source(result.email_sources, email, url)
        for phone in page.phones:
            result.phones.add(phone)
            _add_source(result.phone_sources, phone, url)
        result.external_links |= page.external_links
        result.social_media.update(page.social_media)
        for kvk in page.kvk_numbers:
            result.kvk_numbers.add(kvk)
            _add_source(result.kvk_sources, kvk, url)
        for btw in page.btw_numbers:
            result.btw_numbers.add(btw)
            _add_source(result.btw_sources, btw, url)
        result.iban_numbers |= page.iban_numbers
        for addr in page.addresses:
            result.addresses.add(addr)
            _add_source(result.address_sources, addr, url)

        if page.has_contact_page: result.has_contact_page = True
        if page.has_terms_page: result.has_terms_page = True
        if page.has_privacy_page: result.has_privacy_page = True
        if page.has_return_policy: result.has_return_policy = True
        if page.is_opening_soon: result.is_opening_soon = True
        if page.is_maintenance: result.is_maintenance = True
        if page.has_delivery_time: result.has_delivery_time = True
        if page.has_preorder: result.has_preorder = True
        if page.has_whatsapp_contact: result.has_whatsapp_contact = True
        if page.has_suspicious_prices: result.has_suspicious_prices = True
        for lang in page.detected_languages:
            if lang not in result.detected_languages:
                result.detected_languages.append(lang)

        enqueue_links(page.internal_links)

        if on_progress:
            on_progress({
                "pages_crawled": result.pages_crawled,
                "pages_queued": len(priority_queue) + len(normal_queue),
                "max_pages": max_pages,
                "current_url": url,
                "emails_found": len(result.emails),
                "phones_found": len(result.phones),
                "kvk_found": len(result.kvk_numbers),
                "btw_found": len(result.btw_numbers),
            })

        time.sleep(DELAY_BETWEEN_REQUESTS)

    logger.info(
        f"Crawl voltooid: {result.pages_crawled} pagina's, "
        f"{len(result.emails)} emails, {len(result.phones)} tel, "
        f"{len(result.kvk_numbers)} KvK gevonden"
    )
    return result


def save_crawl_result(result, shop_id, scan_id, db_session):
    from app.models.collectors import ScrapeRecord
    now = datetime.now(timezone.utc)
    record = ScrapeRecord(
        shop_id=shop_id, scan_id=scan_id,
        page_title=result.page_titles.get(result.base_url),
        emails_found=json.dumps(sorted(result.emails)),
        phones_found=json.dumps(sorted(result.phones)),
        addresses_found=json.dumps(sorted(result.addresses)),
        kvk_number_found=json.dumps(sorted(result.kvk_numbers)) if result.kvk_numbers else None,
        btw_number_found=json.dumps(sorted(result.btw_numbers)) if result.btw_numbers else None,
        iban_found=json.dumps(sorted(result.iban_numbers)) if result.iban_numbers else None,
        social_media_links=json.dumps(result.social_media),
        external_links=json.dumps(sorted(list(result.external_links)[:100])),
        has_terms_page=result.has_terms_page,
        has_privacy_page=result.has_privacy_page,
        has_contact_page=result.has_contact_page,
        has_return_policy=result.has_return_policy,
        is_opening_soon=result.is_opening_soon,
        is_maintenance=result.is_maintenance,
        has_delivery_time=result.has_delivery_time,
        has_preorder=result.has_preorder,
        has_whatsapp_contact=result.has_whatsapp_contact,
        has_suspicious_prices=result.has_suspicious_prices,
        detected_languages=json.dumps(result.detected_languages) if result.detected_languages else None,
        source_url=result.base_url, source="html_spider",
        collected_at=now, raw_html_hash=None,
    )
    detailed = {
        "pages_crawled": result.pages_crawled, "pages_failed": result.pages_failed,
        "page_titles": result.page_titles,
        "email_sources": {k: list(v) for k, v in result.email_sources.items()},
        "phone_sources": {k: list(v) for k, v in result.phone_sources.items()},
        "kvk_sources": {k: list(v) for k, v in result.kvk_sources.items()},
        "btw_sources": {k: list(v) for k, v in result.btw_sources.items()},
        "address_sources": {k: list(v) for k, v in result.address_sources.items()},
        "errors": result.errors,
    }
    record.raw_html_hash = hashlib.sha256(json.dumps(detailed, sort_keys=True).encode()).hexdigest()
    record.meta_description = json.dumps(detailed)
    db_session.add(record)
    db_session.commit()
    return record


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.scraper <url> [max_pages]")
        sys.exit(1)

    url = sys.argv[1]
    max_pages = int(sys.argv[2]) if len(sys.argv) > 2 else 50

    def progress(u, num, queued):
        print(f"  [{num}] {u} ({queued} in queue)")

    print(f"\n{'='*60}\nWWSpeur - HTML Scraper\nURL: {url}\nMax: {max_pages}\n{'='*60}\n")
    result = crawl_website(url, max_pages=max_pages, on_page_scraped=progress)

    print(f"\n{'='*60}\nRESULTATEN\n{'='*60}")
    print(f"Pagina's gescraped: {result.pages_crawled}")
    print(f"Pagina's mislukt:   {result.pages_failed}\n")

    for label, items, sources in [
        ("E-mailadressen", result.emails, result.email_sources),
        ("Telefoonnummers", result.phones, result.phone_sources),
        ("KvK-nummers", result.kvk_numbers, result.kvk_sources),
        ("BTW-nummers", result.btw_numbers, result.btw_sources),
    ]:
        if items:
            print(f"{label} ({len(items)}):")
            for item in sorted(items):
                print(f"  {item}")
                for src in sources.get(item, set()):
                    print(f"    -> {src}")

    if result.iban_numbers:
        print(f"\nIBAN ({len(result.iban_numbers)}):")
        for iban in sorted(result.iban_numbers):
            print(f"  {iban}")

    if result.addresses:
        print(f"\nAdressen ({len(result.addresses)}):")
        for addr in sorted(result.addresses):
            print(f"  {addr}")

    if result.social_media:
        print(f"\nSocial media:")
        for p, l in sorted(result.social_media.items()):
            print(f"  {p}: {l}")

    print(f"\nExterne links: {len(result.external_links)}")
    print(f"Contact: {'Ja' if result.has_contact_page else 'Nee'}")
    print(f"Voorwaarden: {'Ja' if result.has_terms_page else 'Nee'}")
    print(f"Privacy: {'Ja' if result.has_privacy_page else 'Nee'}")
    print(f"Retour: {'Ja' if result.has_return_policy else 'Nee'}")
