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
            re.compile(r'(G-[A-Z0-9]{10,12})(?![a-z])'),
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
    return urlparse(url).netloc.lower().removeprefix("www.")


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


def _lookup_google_ads_owner(ads_id):
    """
    Look up Google Ads advertiser info via Google Ads Transparency Center.
    Returns advertiser name and their other ads/domains.
    """
    result = {
        "advertiser_name": None,
        "verified": None,
        "other_ads": [],
        "other_domains": [],
        "transparency_url": None,
        "error": None,
    }

    try:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})

        # Google Ads Transparency Center
        transparency_url = "https://adstransparency.google.com/?search=AW-{}".format(ads_id)
        result["transparency_url"] = transparency_url

        # Try to scrape the transparency page
        response = session.get(transparency_url, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "lxml")
            # Try to find advertiser name
            page_text = soup.get_text()
            # The page is JS-rendered so direct scraping is limited
            # Instead search DuckDuckGo for the AW- ID + "advertiser"
            pass

        # Fallback: search for the ads ID to find advertiser
        search_url = "https://html.duckduckgo.com/html/?q={}".format(
            quote('"AW-{}" advertiser OR adverteerder OR bedrijf'.format(ads_id))
        )
        response = session.get(search_url, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "lxml")
            for link in soup.select("a.result__a"):
                title = link.get_text(strip=True)
                href = link.get("href", "")
                domain = urlparse(href).netloc.lower().lstrip("www.") if href.startswith("http") else ""
                if domain and domain not in {"duckduckgo.com", "google.com"}:
                    result["other_domains"].append({
                        "domain": domain,
                        "title": title[:100],
                        "url": href,
                    })

            result["other_domains"] = result["other_domains"][:10]

    except Exception as e:
        result["error"] = str(e)

    return result


def _lookup_meta_ads_owner(pixel_id):
    """
    Look up Meta/Facebook advertiser via Facebook Ad Library.
    Returns advertiser info and their other ads.
    """
    result = {
        "advertiser_name": None,
        "page_name": None,
        "other_ads": [],
        "ad_library_url": None,
        "error": None,
    }

    try:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})

        # Facebook Ad Library search
        ad_library_url = "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=NL&q={}".format(pixel_id)
        result["ad_library_url"] = ad_library_url

        # Search for the pixel ID to find the business
        search_url = "https://html.duckduckgo.com/html/?q={}".format(
            quote('facebook pixel "{}" site OR shop OR webshop'.format(pixel_id))
        )
        response = session.get(search_url, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "lxml")
            for link in soup.select("a.result__a"):
                title = link.get_text(strip=True)
                href = link.get("href", "")
                domain = urlparse(href).netloc.lower().lstrip("www.") if href.startswith("http") else ""
                if domain and domain not in {"duckduckgo.com", "facebook.com", "google.com"}:
                    result["other_ads"].append({
                        "domain": domain,
                        "title": title[:100],
                        "url": href,
                    })

            result["other_ads"] = result["other_ads"][:10]

    except Exception as e:
        result["error"] = str(e)

    return result


def _lookup_spyonweb(tracker_id):
    """
    Look up a tracker ID on SpyOnWeb to find other sites using the same ID.
    SpyOnWeb tracks Google Analytics, Adsense, and other IDs across websites.
    """
    result = {
        "related_sites": [],
        "spyonweb_url": None,
        "error": None,
    }

    try:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})

        spyonweb_url = "https://spyonweb.com/{}".format(quote(tracker_id))
        result["spyonweb_url"] = spyonweb_url

        response = session.get(spyonweb_url, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "lxml")

            # Extract related domains from SpyOnWeb results
            for link in soup.select("a[href*='/go/']"):
                domain = link.get_text(strip=True).lower()
                if "." in domain and len(domain) > 3:
                    result["related_sites"].append(domain)

            result["related_sites"] = list(set(result["related_sites"]))[:20]

    except Exception as e:
        result["error"] = str(e)

    return result


def _hackertarget_domain_lookup(domain):
    """
    Look up all analytics IDs associated with a domain via HackerTarget.
    Returns list of {subdomain, analytics_id} pairs.
    """
    result = {
        "analytics_ids": [],
        "error": None,
    }

    try:
        response = requests.get(
            "https://api.hackertarget.com/analyticslookup/?q={}".format(quote(domain)),
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200 and "error" not in response.text.lower():
            for line in response.text.strip().split("\n"):
                parts = line.strip().split(",")
                if len(parts) == 2:
                    result["analytics_ids"].append({
                        "subdomain": parts[0].strip(),
                        "id": parts[1].strip(),
                    })
    except Exception as e:
        result["error"] = str(e)

    return result


def _hackertarget_reverse_lookup(analytics_id):
    """
    Reverse lookup: find all domains using the same analytics ID.
    Works for UA- and GTM- IDs. GA4 (G-) IDs are not supported.
    """
    result = {
        "related_domains": [],
        "error": None,
    }

    # Only works for UA- and GTM- IDs
    if not (analytics_id.startswith("UA-") or analytics_id.startswith("GTM-")):
        return result

    try:
        response = requests.get(
            "https://api.hackertarget.com/analyticslookup/?q={}".format(quote(analytics_id)),
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200 and "error" not in response.text.lower():
            for line in response.text.strip().split("\n"):
                domain = line.strip()
                if domain and "." in domain:
                    result["related_domains"].append(domain)
    except Exception as e:
        result["error"] = str(e)

    return result


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
        "hackertarget": None,  # domain analytics lookup
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

                    # Owner lookup per platform
                    id_entry["owner"] = None
                    id_entry["spyonweb"] = None

                    if search_online:
                        # Google Ads owner lookup
                        if platform_key == "google_ads":
                            owner = _lookup_google_ads_owner(raw_id)
                            if owner.get("other_domains") or owner.get("advertiser_name"):
                                id_entry["owner"] = owner

                        # Meta Pixel owner lookup
                        elif platform_key == "meta_pixel":
                            owner = _lookup_meta_ads_owner(raw_id)
                            if owner.get("other_ads") or owner.get("advertiser_name"):
                                id_entry["owner"] = owner

                        # SpyOnWeb for Analytics/GTM IDs
                        if platform_key in ("google_analytics", "google_tag_manager"):
                            spyonweb = _lookup_spyonweb(display_id)
                            # Filter out current domain
                            spyonweb["related_sites"] = [
                                s for s in spyonweb.get("related_sites", [])
                                if domain not in s
                            ]
                            if spyonweb.get("related_sites"):
                                id_entry["spyonweb"] = spyonweb
                                # Add to cross references
                                result["cross_references"].append({
                                    "id": display_id,
                                    "platform": platform_info["name"],
                                    "source": "spyonweb",
                                    "other_domains": spyonweb["related_sites"],
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

        # HackerTarget: get all analytics IDs for this domain + reverse lookups
        if search_online:
            ht_domain = _hackertarget_domain_lookup(domain)
            result["hackertarget"] = ht_domain

            # Collect all UA-/GTM- IDs (from our detection + HackerTarget)
            all_ua_ids = set()
            for ad in result["all_ids"]:
                aid = ad.get("display_id", ad.get("id", ""))
                if aid.startswith("UA-") or aid.startswith("GTM-"):
                    all_ua_ids.add(aid)
            for ht_entry in ht_domain.get("analytics_ids", []):
                aid = ht_entry.get("id", "")
                if aid.startswith("UA-") or aid.startswith("GTM-"):
                    all_ua_ids.add(aid)

            # Reverse lookup each UA-/GTM- ID
            for ua_id in list(all_ua_ids)[:3]:  # Max 3 to avoid rate limiting
                reverse = _hackertarget_reverse_lookup(ua_id)
                related = [d for d in reverse.get("related_domains", []) if domain not in d]
                if related:
                    result["cross_references"].append({
                        "id": ua_id,
                        "platform": "Google Analytics" if ua_id.startswith("UA-") else "Google Tag Manager",
                        "source": "hackertarget",
                        "other_domains": related,
                    })

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
    db_session.flush()

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
