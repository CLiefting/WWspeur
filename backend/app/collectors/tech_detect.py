"""
Technology Detection Collector

Detects what technologies a webshop uses by analyzing:
- HTML meta tags and generator tags
- JavaScript libraries loaded
- CSS frameworks
- E-commerce platforms (Shopify, WooCommerce, Magento, etc.)
- Payment providers (iDEAL, Mollie, Stripe, etc.)
- Analytics tools (Google Analytics, Meta Pixel, etc.)
- CMS platforms (WordPress, Joomla, etc.)
- CDN and hosting providers
- Cookie consent tools

Works by pattern matching on HTML content and HTTP headers.
"""
import re
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 15
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# ── Technology signatures ──
# Each entry: (category, name, patterns_in_html, patterns_in_headers)

TECH_SIGNATURES = [
    # E-commerce platforms
    ("ecommerce", "Shopify", [
        r"cdn\.shopify\.com", r"Shopify\.theme", r"shopify-section",
        r"myshopify\.com", r"shopify_analytics",
    ], ["x-shopify"]),
    ("ecommerce", "WooCommerce", [
        r"woocommerce", r"wc-block", r"wp-content/plugins/woocommerce",
        r"wc_add_to_cart", r"wc-cart",
    ], []),
    ("ecommerce", "Magento", [
        r"mage/cookies", r"Magento_Ui", r"magento", r"/static/version",
        r"mage-init", r"data-mage-init",
    ], ["x-magento"]),
    ("ecommerce", "PrestaShop", [
        r"prestashop", r"PrestaShop", r"/modules/ps_",
        r"prestashop\.js",
    ], []),
    ("ecommerce", "OpenCart", [
        r"opencart", r"catalog/view/theme", r"route=product",
    ], []),
    ("ecommerce", "BigCommerce", [
        r"bigcommerce\.com", r"cdn\.bcapp", r"stencil-utils",
    ], []),
    ("ecommerce", "Lightspeed", [
        r"lightspeed", r"seoshop\.net", r"shoplightspeed",
        r"api\.webshopapp\.com",
    ], []),
    ("ecommerce", "CCV Shop", [
        r"ccvshop", r"ccv\.eu",
    ], []),
    ("ecommerce", "Mijnwebwinkel", [
        r"mijnwebwinkel", r"mijndomein\.nl",
    ], []),

    # CMS
    ("cms", "WordPress", [
        r"wp-content", r"wp-includes", r"wp-json",
        r'name="generator"\s+content="WordPress',
    ], []),
    ("cms", "Joomla", [
        r"/media/jui/", r"joomla", r'content="Joomla',
    ], []),
    ("cms", "Drupal", [
        r"drupal\.js", r"Drupal\.settings", r"/sites/default/files",
    ], ["x-drupal"]),
    ("cms", "Wix", [
        r"wix\.com", r"wixstatic\.com", r"X-Wix",
    ], []),
    ("cms", "Squarespace", [
        r"squarespace", r"sqsp\.net",
    ], []),

    # Payment providers
    ("payment", "Mollie", [
        r"mollie\.com", r"mollie", r"js\.mollie\.com",
    ], []),
    ("payment", "Stripe", [
        r"js\.stripe\.com", r"stripe\.com", r"Stripe\(",
    ], []),
    ("payment", "Adyen", [
        r"adyen\.com", r"checkoutshopper.*adyen",
    ], []),
    ("payment", "PayPal", [
        r"paypal\.com", r"paypal\.com/sdk", r"paypalobjects\.com",
    ], []),
    ("payment", "iDEAL", [
        r"ideal", r"iDEAL",
    ], []),
    ("payment", "Klarna", [
        r"klarna\.com", r"klarna",
    ], []),
    ("payment", "MultiSafepay", [
        r"multisafepay",
    ], []),
    ("payment", "Buckaroo", [
        r"buckaroo",
    ], []),

    # Analytics
    ("analytics", "Google Analytics", [
        r"google-analytics\.com", r"googletagmanager\.com",
        r"gtag\(", r"ga\('create'", r"UA-\d{4,}-\d{1,}",
        r"G-[A-Z0-9]{10,12}(?![a-z])",
    ], []),
    ("analytics", "Meta Pixel", [
        r"connect\.facebook\.net", r"fbevents\.js", r"fbq\(",
    ], []),
    ("analytics", "Hotjar", [
        r"hotjar\.com", r"static\.hotjar\.com",
    ], []),
    ("analytics", "Google Tag Manager", [
        r"googletagmanager\.com/gtm", r"GTM-[A-Z0-9]+",
    ], []),

    # Cookie consent
    ("privacy", "Cookiebot", [
        r"cookiebot\.com", r"CookieConsent",
    ], []),
    ("privacy", "OneTrust", [
        r"onetrust\.com", r"optanon",
    ], []),
    ("privacy", "CookieYes", [
        r"cookieyes\.com",
    ], []),
    ("privacy", "Complianz", [
        r"complianz", r"cmplz",
    ], []),

    # CDN / Hosting
    ("hosting", "Cloudflare", [
        r"cloudflare",
    ], ["cf-ray", "cf-cache-status"]),
    ("hosting", "Amazon CloudFront", [
        r"cloudfront\.net",
    ], ["x-amz-cf"]),
    ("hosting", "Vercel", [
        r"vercel",
    ], ["x-vercel"]),
    ("hosting", "Netlify", [
        r"netlify",
    ], ["x-nf"]),

    # JavaScript frameworks
    ("framework", "React", [
        r"react\.production\.min\.js", r"__NEXT_DATA__", r"react-dom",
        r"_react", r"reactDOM",
    ], []),
    ("framework", "Vue.js", [
        r"vue\.js", r"vue\.min\.js", r"vue\.runtime",
        r"__vue__", r"data-v-[a-f0-9]",
    ], []),
    ("framework", "jQuery", [
        r"jquery\.min\.js", r"jquery-\d", r"jQuery\(",
    ], []),
    ("framework", "Next.js", [
        r"__NEXT_DATA__", r"_next/static",
    ], []),
    ("framework", "Nuxt.js", [
        r"__NUXT__", r"_nuxt/",
    ], []),

    # Security
    ("security", "reCAPTCHA", [
        r"recaptcha", r"google\.com/recaptcha",
    ], []),
    ("security", "hCaptcha", [
        r"hcaptcha\.com",
    ], []),

    # Keurmerken
    ("trustmark", "Thuiswinkel Waarborg", [
        r"thuiswinkel\.org", r"thuiswinkelwaarborg",
        r"thuiswinkel", r"Thuiswinkel",
    ], []),
    ("trustmark", "WebwinkelKeur", [
        r"webwinkelkeur\.nl", r"webwinkelkeur",
        r"WebwinkelKeur",
    ], []),
    ("trustmark", "Trusted Shops", [
        r"trustedshops\.com", r"trusted-shops",
    ], []),
    ("trustmark", "Kiyoh", [
        r"kiyoh\.com", r"kiyoh\.nl",
    ], []),
    ("trustmark", "Trustpilot", [
        r"trustpilot\.com", r"trustpilot",
    ], []),
]


def detect_technologies(url: str) -> dict:
    """
    Detect technologies used by a website.
    
    Returns dict with detected technologies grouped by category.
    """
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    domain = urlparse(url).netloc.lower().lstrip("www.")
    logger.info("Technologie detectie voor: %s", domain)

    result = {
        "domain": domain,
        "url": url,
        "technologies": {},  # category -> [names]
        "all_detected": [],  # flat list of {category, name}
        "ecommerce_platform": None,
        "cms": None,
        "has_analytics": False,
        "has_cookie_consent": False,
        "has_trustmark": False,
        "trustmarks": [],
        "payment_providers": [],
        "error": None,
    }

    try:
        response = requests.get(
            url, timeout=REQUEST_TIMEOUT, allow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )

        html = response.text.lower()
        headers_str = " ".join(
            "{}: {}".format(k.lower(), v.lower()) for k, v in response.headers.items()
        )

        for category, name, html_patterns, header_patterns in TECH_SIGNATURES:
            detected = False

            for pattern in html_patterns:
                if re.search(pattern.lower(), html):
                    detected = True
                    break

            if not detected:
                for pattern in header_patterns:
                    if pattern.lower() in headers_str:
                        detected = True
                        break

            if detected:
                if category not in result["technologies"]:
                    result["technologies"][category] = []
                if name not in result["technologies"][category]:
                    result["technologies"][category].append(name)
                    result["all_detected"].append({"category": category, "name": name})

        # Set convenience fields
        ecom = result["technologies"].get("ecommerce", [])
        if ecom:
            result["ecommerce_platform"] = ecom[0]

        cms_list = result["technologies"].get("cms", [])
        if cms_list:
            result["cms"] = cms_list[0]

        result["has_analytics"] = "analytics" in result["technologies"]
        result["has_cookie_consent"] = "privacy" in result["technologies"]
        result["has_trustmark"] = "trustmark" in result["technologies"]
        result["trustmarks"] = result["technologies"].get("trustmark", [])
        result["payment_providers"] = result["technologies"].get("payment", [])

        logger.info(
            "Tech detectie voltooid voor %s: %d technologieen, platform=%s",
            domain, len(result["all_detected"]),
            result["ecommerce_platform"] or result["cms"] or "onbekend",
        )

    except requests.Timeout:
        result["error"] = "Timeout"
    except requests.ConnectionError:
        result["error"] = "Verbinding mislukt"
    except Exception as e:
        result["error"] = str(e)
        logger.error("Tech detectie fout voor %s: %s", domain, e)

    return result


def save_tech_result(result: dict, shop_id: int, scan_id: int, db_session):
    """Save technology detection results."""
    from app.models.collectors import TechRecord

    now = datetime.now(timezone.utc)
    record = TechRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        technologies=json.dumps(result["technologies"]),
        all_detected=json.dumps(result["all_detected"]),
        ecommerce_platform=result.get("ecommerce_platform"),
        cms=result.get("cms"),
        has_analytics=result.get("has_analytics"),
        has_cookie_consent=result.get("has_cookie_consent"),
        has_trustmark=result.get("has_trustmark"),
        trustmarks=json.dumps(result.get("trustmarks", [])),
        payment_providers=json.dumps(result.get("payment_providers", [])),
        source="tech_detection",
        raw_data=json.dumps(result),
        collected_at=now,
    )
    db_session.add(record)
    db_session.commit()
    return record


# ── CLI ──

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.tech_detect <url>")
        sys.exit(1)

    url = sys.argv[1]
    result = detect_technologies(url)

    print("\n" + "=" * 60)
    print("Technologie Detectie - {}".format(result["domain"]))
    print("=" * 60)

    if result.get("error"):
        print("Fout: {}".format(result["error"]))

    if result["ecommerce_platform"]:
        print("\nE-commerce platform: {}".format(result["ecommerce_platform"]))
    if result["cms"]:
        print("CMS: {}".format(result["cms"]))

    for category, names in result["technologies"].items():
        labels = {
            "ecommerce": "E-commerce", "cms": "CMS", "payment": "Betaalmethoden",
            "analytics": "Analytics", "privacy": "Cookie consent",
            "hosting": "Hosting/CDN", "framework": "Frameworks",
            "security": "Beveiliging", "trustmark": "Keurmerken",
        }
        print("\n{}: {}".format(labels.get(category, category), ", ".join(names)))

    if result["trustmarks"]:
        print("\nKeurmerken gevonden: {}".format(", ".join(result["trustmarks"])))
    else:
        print("\nGeen keurmerken gevonden!")

    print("\nTotaal: {} technologieen gedetecteerd".format(len(result["all_detected"])))
