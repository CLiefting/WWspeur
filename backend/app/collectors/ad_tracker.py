"""
Ad Tracker Detection Collector

Detects advertising and tracking IDs from HTML source:
- Google Ads conversion IDs (AW-xxxxxxxxx)
- Google Analytics (UA-xxxxxxx, G-xxxxxxx, GTM-xxxxxxx)
- Meta/Facebook Pixel IDs
- TikTok Pixel IDs
- Microsoft/Bing Ads UET tags

Cross-references found IDs:
1. Against own database (same ID on other shops we've scanned)
2. Via internet search (find other sites using the same ID)
"""
import re
import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse, quote

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 15
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# ── Regex patterns for ad tracker IDs ──

AD_PATTERNS = {
    "google_ads": {
        "name": "Google Ads",
        "patterns": [
            re.compile(r'AW-(\d{9,11})', re.IGNORECASE),
            re.compile(r'google_conversion_id\s*[=:]\s*["\']?(\d{9,11})', re.IGNORECASE),
            re.compile(r'send_to["\']?\s*[:=]\s*["\']?AW-(\d{9,11})', re.IGNORECASE),
        ],
        "id_prefix": "AW-",
    },
    "google_analytics": {
        "name": "Google Analytics",
        "patterns": [
            re.compile(r'(UA-\d{4,10}-\d{1,4})', re.IGNORECASE),
            re.compile(r'(G-[A-Z0-9]{8,12})', re.IGNORECASE),
        ],
        "id_prefix": "",
    },
    "google_tag_manager": {
        "name": "Google Tag Manager",
        "patterns": [
            re.compile(r'(GTM-[A-Z0-9]{5,8})', re.IGNORECASE),
        ],
        "id_prefix": "",
    },
    "meta_pixel": {
        "name": "Meta/Facebook Pixel",
        "patterns": [
            re.compile(r"fbq\s*\(\s*['\"]init['\"]\s*,\s*['\"](\d{12,20})['\"]", re.IGNORECASE),
            re.compile(r'facebook\.com/tr\?id=(\d{12,20})', re.IGNORECASE),
            re.compile(r'content["\']?\s*[:=]\s*["\'](\d{15,16})["\']', re.IGNORECASE),
        ],
        "id_prefix": "FB-",
    },
    "tiktok_pixel": {
        "name": "TikTok Pixel",
        "patterns": [
            re.compile(r"ttq\.load\s*\(\s*['\"]([A-Z0-9]{10,25})['\"]", re.IGNORECASE),
            re.compile(r'analytics\.tiktok\.com.*["\']([A-Z0-9]{10,25})["\']', re.IGNORECASE),
        ],
        "id_prefix": "TT-",
    },
    "bing_uet": {
        "name": "Microsoft/Bing Ads",
        "patterns": [
            re.compile(r'uetq.*["\'](\d{7,10})["\']', re.IGNORECASE),
            re.compile(r'bat\.bing\.com/bat\.js\?.*ti=(\d{7,10})', re.IGNORECASE),
            re.compile(r'UET\s*tag\s*ID["\s:=]*(\d{7,10})', re.IGNORECASE),
        ],
        "id_prefix": "UET-",
    },
}


def _extract_domain(url):
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return urlparse(url).netloc.lower().lstrip("www.")


def _search_id_online(tracker_id, platform_name):
    """
    Search for a tracker ID on the internet to find other sites using it.
    Uses a search engine to find references.
    """
    results = {
        "other_sites": [],
        "search_url": None,
        "error": None,
    }

    try:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})

        # Search via DuckDuckGo HTML (no API key needed)
        search_query = '"{}" -site:google.com -site:facebook.com'.format(tracker_id)
        search_url = "https://html.duckduckgo.com/html/?q={}".format(quote(search_query))
        results["search_url"] = search_url

        response = session.get(search_url, timeout=REQUEST_TIMEOUT)

        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "lxml")

            # Extract result URLs
            seen_domains = set()
            for link in soup.select("a.result__a"):
                href = link.get("href", "")
                if href.startswith("http"):
                    domain = urlparse(href).netloc.lower().lstrip("www.")
                    # Skip search engines and common non-shop domains
                    skip = {"duckduckgo.com", "google.com", "facebook.com", "github.com",
                            "stackoverflow.com", "w3schools.com", "developer.mozilla.org",
                            "support.google.com", "ads.google.com", "business.facebook.com"}
                    if domain not in skip and domain not in seen_domains:
                        seen_domains.add(domain)
                        results["other_sites"].append({
                            "domain": domain,
                            "url": href,
                            "title": link.get_text(strip=True)[:100],
                        })

            # Limit to first 10
            results["other_sites"] = results["other_sites"][:10]

    except Exception as e:
        results["error"] = str(e)
        logger.warning("Search failed for {}: {}".format(tracker_id, e))

    return results


def detect_ad_trackers(url, search_online=True):
    """
    Detect advertising tracker IDs on a website.

    Args:
        url: Website URL to scan
        search_online: Whether to search for cross-references online

    Returns dict with all found tracker IDs and cross-references.
    """
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    domain = _extract_domain(url)
    logger.info("Ad tracker detectie voor: %s", domain)

    result = {
        "domain": domain,
        "url": url,
        "trackers": [],  # [{platform, name, ids: [{id, prefix_id, online_results}]}]
        "all_ids": [],  # flat: [{platform, name, id, prefix_id}]
        "total_trackers": 0,
        "total_unique_ids": 0,
        "cross_references": [],  # [{id, platform, other_domains: []}]
        "error": None,
    }

    try:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})

        response = session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        html = response.text

        all_unique_ids = set()

        for platform_key, platform_info in AD_PATTERNS.items():
            found_ids = set()

            for pattern in platform_info["patterns"]:
                for match in pattern.finditer(html):
                    raw_id = match.group(1) if match.lastindex else match.group()
                    # Add prefix if not already there
                    prefix = platform_info["id_prefix"]
                    if prefix and not raw_id.startswith(prefix):
                        display_id = prefix + raw_id
                    else:
                        display_id = raw_id
                    found_ids.add((raw_id, display_id))

            if found_ids:
                tracker_entry = {
                    "platform": platform_key,
                    "name": platform_info["name"],
                    "ids": [],
                }

                for raw_id, display_id in found_ids:
                    id_entry = {
                        "id": raw_id,
                        "display_id": display_id,
                        "online_results": None,
                    }

                    # Search online for cross-references
                    if search_online:
                        search_term = display_id if display_id != raw_id else raw_id
                        online = _search_id_online(search_term, platform_info["name"])
                        # Filter out the current domain
                        online["other_sites"] = [
                            s for s in online["other_sites"]
                            if domain not in s["domain"]
                        ]
                        id_entry["online_results"] = online

                        if online["other_sites"]:
                            result["cross_references"].append({
                                "id": display_id,
                                "platform": platform_info["name"],
                                "other_domains": [s["domain"] for s in online["other_sites"]],
                            })

                    tracker_entry["ids"].append(id_entry)
                    all_unique_ids.add(display_id)

                    result["all_ids"].append({
                        "platform": platform_key,
                        "name": platform_info["name"],
                        "id": raw_id,
                        "display_id": display_id,
                    })

                result["trackers"].append(tracker_entry)

        result["total_trackers"] = len(result["trackers"])
        result["total_unique_ids"] = len(all_unique_ids)

        logger.info(
            "Ad tracker detectie voltooid voor %s: %d platforms, %d unieke ID's, %d cross-refs",
            domain, result["total_trackers"], result["total_unique_ids"],
            len(result["cross_references"]),
        )

    except requests.Timeout:
        result["error"] = "Timeout"
    except requests.ConnectionError:
        result["error"] = "Verbinding mislukt"
    except Exception as e:
        result["error"] = str(e)
        logger.error("Ad tracker fout voor %s: %s", domain, e)

    return result


def check_db_cross_references(ad_ids, current_shop_id, db_session):
    """
    Check if any of the found ad IDs exist in our database for other shops.

    Args:
        ad_ids: List of {display_id, platform} dicts
        current_shop_id: Current shop to exclude
        db_session: Database session

    Returns list of matches: [{id, platform, shops: [{id, domain, url}]}]
    """
    from app.models.collectors import AdTrackerRecord

    matches = []

    for ad in ad_ids:
        display_id = ad.get("display_id", ad.get("id", ""))

        # Search in all other ad tracker records
        other_records = (
            db_session.query(AdTrackerRecord)
            .filter(AdTrackerRecord.shop_id != current_shop_id)
            .filter(AdTrackerRecord.all_ids_flat.ilike("%{}%".format(display_id)))
            .all()
        )

        if other_records:
            from app.models.shop import Shop
            shop_matches = []
            seen = set()
            for record in other_records:
                if record.shop_id not in seen:
                    seen.add(record.shop_id)
                    shop = db_session.query(Shop).filter(Shop.id == record.shop_id).first()
                    if shop:
                        shop_matches.append({
                            "id": shop.id,
                            "domain": shop.domain,
                            "url": shop.url,
                        })

            if shop_matches:
                matches.append({
                    "id": display_id,
                    "platform": ad.get("name", ad.get("platform", "")),
                    "shops": shop_matches,
                })

    return matches


def save_ad_tracker_result(result, shop_id, scan_id, db_session):
    """Save ad tracker detection results."""
    from app.models.collectors import AdTrackerRecord

    now = datetime.now(timezone.utc)

    # Create flat string of all IDs for cross-reference searching
    all_ids_flat = " ".join(
        ad.get("display_id", ad.get("id", ""))
        for ad in result.get("all_ids", [])
    )

    record = AdTrackerRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        trackers=json.dumps(result.get("trackers", [])),
        all_ids=json.dumps(result.get("all_ids", [])),
        all_ids_flat=all_ids_flat,
        total_trackers=result.get("total_trackers", 0),
        total_unique_ids=result.get("total_unique_ids", 0),
        cross_references=json.dumps(result.get("cross_references", [])),
        source="ad_tracker_detection",
        raw_data=json.dumps(result),
        collected_at=now,
    )

    db_session.add(record)
    db_session.commit()

    # Now check database cross-references
    db_matches = check_db_cross_references(
        result.get("all_ids", []), shop_id, db_session
    )
    if db_matches:
        # Update the record with DB cross-references
        existing_xrefs = result.get("cross_references", [])
        for match in db_matches:
            existing_xrefs.append({
                "id": match["id"],
                "platform": match["platform"],
                "source": "database",
                "other_domains": [s["domain"] for s in match["shops"]],
                "other_shops": match["shops"],
            })
        record.cross_references = json.dumps(existing_xrefs)
        db_session.commit()

    return record


# ── CLI ──

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.ad_tracker <url> [--no-search]")
        sys.exit(1)

    url = sys.argv[1]
    search = "--no-search" not in sys.argv

    print("\n" + "=" * 60)
    print("Ad Tracker Detectie - {}".format(_extract_domain(url)))
    print("Online zoeken: {}".format("Ja" if search else "Nee"))
    print("=" * 60)

    result = detect_ad_trackers(url, search_online=search)

    if result.get("error"):
        print("\nFout: {}".format(result["error"]))

    if not result["trackers"]:
        print("\nGeen advertentie trackers gevonden.")
    else:
        print("\n{} platform(s), {} unieke ID('s) gevonden:\n".format(
            result["total_trackers"], result["total_unique_ids"]))

        for tracker in result["trackers"]:
            print("  {} {}".format(tracker["name"], ""))
            for id_info in tracker["ids"]:
                print("    ID: {}".format(id_info["display_id"]))
                if id_info.get("online_results") and id_info["online_results"].get("other_sites"):
                    sites = id_info["online_results"]["other_sites"]
                    print("    Gevonden op {} andere site(s):".format(len(sites)))
                    for site in sites[:5]:
                        print("      - {} ({})".format(site["domain"], site["title"][:50]))
            print()

    if result["cross_references"]:
        print("\n" + "-" * 40)
        print("CROSS-REFERENTIES:")
        for xref in result["cross_references"]:
            print("  {} ({}) ook gebruikt door:".format(xref["id"], xref["platform"]))
            for domain in xref["other_domains"][:5]:
                print("    - {}".format(domain))
