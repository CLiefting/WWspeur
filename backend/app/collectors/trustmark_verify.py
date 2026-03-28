"""
Trustmark Verification Collector

Verifies whether claimed trustmarks/keurmerken are legitimate by checking
against the official sources:
- Thuiswinkel Waarborg: check thuiswinkel.org
- WebwinkelKeur: check webwinkelkeur.nl
- Trusted Shops: check trustedshops.com
- Trustpilot: fetch score from trustpilot.com
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


def _get_session():
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def _extract_domain(url):
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return urlparse(url).netloc.lower().lstrip("www.")


def verify_thuiswinkel(domain):
    """
    Verify Thuiswinkel Waarborg membership.
    Checks thuiswinkel.org search for the domain.
    """
    result = {
        "name": "Thuiswinkel Waarborg",
        "claimed": False,
        "verified": False,
        "status": "not_checked",
        "details": None,
        "url": None,
        "error": None,
    }

    try:
        session = _get_session()

        # Search on thuiswinkel.org for the domain
        search_url = "https://www.thuiswinkel.org/leden?q={}".format(quote(domain))
        response = session.get(search_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)

        if response.status_code == 200:
            html = response.text.lower()
            domain_lower = domain.lower()

            # Check if domain appears in the results
            if domain_lower in html:
                result["verified"] = True
                result["status"] = "verified"
                result["details"] = "Domein gevonden in Thuiswinkel Waarborg ledenlijst"
                result["url"] = search_url
            else:
                # Also try without TLD
                domain_name = domain_lower.split(".")[0]
                if domain_name in html and len(domain_name) > 3:
                    result["verified"] = True
                    result["status"] = "likely_verified"
                    result["details"] = "Mogelijk lid (naam gevonden, controleer handmatig)"
                    result["url"] = search_url
                else:
                    result["status"] = "not_found"
                    result["details"] = "Niet gevonden in Thuiswinkel Waarborg ledenlijst"
                    result["url"] = search_url
        else:
            result["status"] = "check_failed"
            result["error"] = "HTTP {}".format(response.status_code)

    except Exception as e:
        result["error"] = str(e)
        result["status"] = "check_failed"

    return result


def verify_webwinkelkeur(domain):
    """
    Verify WebwinkelKeur membership.
    Checks webwinkelkeur.nl for the domain.
    """
    result = {
        "name": "WebwinkelKeur",
        "claimed": False,
        "verified": False,
        "status": "not_checked",
        "details": None,
        "score": None,
        "reviews": None,
        "url": None,
        "error": None,
    }

    try:
        session = _get_session()

        # WebwinkelKeur uses domain-based URLs
        check_url = "https://www.webwinkelkeur.nl/leden/{}".format(quote(domain))
        response = session.get(check_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)

        if response.status_code == 200:
            html = response.text
            soup = BeautifulSoup(html, "lxml")

            # Check if it's a valid member page (not a 404/redirect to homepage)
            page_text = soup.get_text().lower()
            if domain.lower() in page_text or "lid van webwinkelkeur" in page_text:
                result["verified"] = True
                result["status"] = "verified"
                result["details"] = "Geregistreerd bij WebwinkelKeur"
                result["url"] = check_url

                # Try to extract score
                score_match = re.search(r'(\d[.,]\d)\s*/\s*10', html)
                if score_match:
                    result["score"] = score_match.group(1).replace(",", ".")

                # Try to extract review count
                review_match = re.search(r'(\d+)\s*(?:reviews?|beoordelingen)', html, re.IGNORECASE)
                if review_match:
                    result["reviews"] = int(review_match.group(1))
            else:
                result["status"] = "not_found"
                result["details"] = "Niet gevonden bij WebwinkelKeur"
        elif response.status_code == 404:
            result["status"] = "not_found"
            result["details"] = "Niet gevonden bij WebwinkelKeur"
        else:
            result["status"] = "check_failed"
            result["error"] = "HTTP {}".format(response.status_code)

    except Exception as e:
        result["error"] = str(e)
        result["status"] = "check_failed"

    return result


def verify_trusted_shops(domain):
    """
    Verify Trusted Shops certification.
    Checks trustedshops.com for the domain.
    """
    result = {
        "name": "Trusted Shops",
        "claimed": False,
        "verified": False,
        "status": "not_checked",
        "details": None,
        "score": None,
        "reviews": None,
        "url": None,
        "error": None,
    }

    try:
        session = _get_session()

        # Trusted Shops search
        search_url = "https://www.trustedshops.nl/shops/?q={}".format(quote(domain))
        response = session.get(search_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)

        if response.status_code == 200:
            html = response.text.lower()
            domain_lower = domain.lower()

            if domain_lower in html:
                result["verified"] = True
                result["status"] = "verified"
                result["details"] = "Gecertificeerd door Trusted Shops"
                result["url"] = search_url

                # Try to extract score
                score_match = re.search(r'(\d[.,]\d{2})\s*/\s*5', html)
                if score_match:
                    result["score"] = score_match.group(1).replace(",", ".")
            else:
                result["status"] = "not_found"
                result["details"] = "Niet gevonden bij Trusted Shops"
                result["url"] = search_url
        else:
            result["status"] = "check_failed"
            result["error"] = "HTTP {}".format(response.status_code)

    except Exception as e:
        result["error"] = str(e)
        result["status"] = "check_failed"

    return result


def fetch_trustpilot(domain):
    """
    Fetch Trustpilot score and review count for a domain.
    """
    result = {
        "name": "Trustpilot",
        "claimed": False,
        "verified": False,
        "status": "not_checked",
        "details": None,
        "score": None,
        "reviews": None,
        "rating_category": None,
        "url": None,
        "error": None,
    }

    try:
        session = _get_session()

        profile_url = "https://www.trustpilot.com/review/{}".format(domain)
        response = session.get(profile_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)

        if response.status_code == 200:
            html = response.text
            soup = BeautifulSoup(html, "lxml")

            # Check if it's a real profile page
            if "trustpilot.com/review/{}".format(domain) in response.url.lower():
                result["verified"] = True
                result["status"] = "found"
                result["url"] = profile_url

                # Extract TrustScore
                score_el = soup.find("span", {"class": re.compile("typography.*headingSmall", re.IGNORECASE)})
                if score_el:
                    score_text = score_el.get_text(strip=True)
                    score_match = re.search(r'(\d[.,]\d)', score_text)
                    if score_match:
                        result["score"] = score_match.group(1).replace(",", ".")

                # Also try data attributes
                if not result["score"]:
                    score_match = re.search(r'"trustScore":\s*(\d+\.?\d*)', html)
                    if score_match:
                        result["score"] = score_match.group(1)

                # Extract review count
                review_match = re.search(r'"numberOfReviews":\s*"?(\d+)"?', html)
                if review_match:
                    result["reviews"] = int(review_match.group(1))
                else:
                    review_el = soup.find(string=re.compile(r'\d+\s*(reviews|beoordelingen)', re.IGNORECASE))
                    if review_el:
                        num_match = re.search(r'(\d[\d.,]*)', str(review_el))
                        if num_match:
                            result["reviews"] = int(num_match.group(1).replace(".", "").replace(",", ""))

                # Rating category
                if result["score"]:
                    try:
                        score_float = float(result["score"])
                        if score_float >= 4.5:
                            result["rating_category"] = "Uitstekend"
                        elif score_float >= 4.0:
                            result["rating_category"] = "Goed"
                        elif score_float >= 3.0:
                            result["rating_category"] = "Gemiddeld"
                        elif score_float >= 2.0:
                            result["rating_category"] = "Matig"
                        else:
                            result["rating_category"] = "Slecht"
                    except ValueError:
                        pass

                if result["score"]:
                    result["details"] = "TrustScore: {}/5 ({} reviews)".format(
                        result["score"],
                        result["reviews"] or "?"
                    )
                else:
                    result["details"] = "Trustpilot profiel gevonden"
            else:
                result["status"] = "not_found"
                result["details"] = "Geen Trustpilot profiel"
        elif response.status_code == 404:
            result["status"] = "not_found"
            result["details"] = "Geen Trustpilot profiel"
        else:
            result["status"] = "check_failed"
            result["error"] = "HTTP {}".format(response.status_code)

    except Exception as e:
        result["error"] = str(e)
        result["status"] = "check_failed"

    return result


def verify_all_trustmarks(url, claimed_trustmarks=None):
    """
    Verify all trustmarks for a domain.
    
    Args:
        url: The website URL
        claimed_trustmarks: List of trustmark names found on the site
    
    Returns dict with verification results per trustmark.
    """
    domain = _extract_domain(url)
    logger.info("Keurmerk verificatie voor: %s", domain)

    claimed = set(t.lower() for t in (claimed_trustmarks or []))

    results = {
        "domain": domain,
        "verifications": [],
        "summary": {
            "total_checked": 0,
            "verified": 0,
            "not_found": 0,
            "claimed_but_not_verified": 0,
            "not_claimed_but_found": 0,
        },
    }

    checks = [
        ("thuiswinkel", verify_thuiswinkel),
        ("webwinkelkeur", verify_webwinkelkeur),
        ("trusted shops", verify_trusted_shops),
        ("trustpilot", fetch_trustpilot),
    ]

    for name_key, check_fn in checks:
        try:
            verification = check_fn(domain)
            
            # Mark if it was claimed on the website
            is_claimed = any(name_key in c for c in claimed)
            verification["claimed"] = is_claimed

            results["verifications"].append(verification)
            results["summary"]["total_checked"] += 1

            if verification["verified"]:
                results["summary"]["verified"] += 1
                if not is_claimed:
                    results["summary"]["not_claimed_but_found"] += 1
            else:
                results["summary"]["not_found"] += 1
                if is_claimed:
                    results["summary"]["claimed_but_not_verified"] += 1

        except Exception as e:
            logger.error("Verificatie fout voor %s: %s", name_key, e)
            results["verifications"].append({
                "name": name_key.title(),
                "claimed": any(name_key in c for c in claimed),
                "verified": False,
                "status": "check_failed",
                "error": str(e),
            })

    logger.info(
        "Keurmerk verificatie voltooid voor %s: %d geverifieerd, %d niet gevonden, %d vals geclaimed",
        domain,
        results["summary"]["verified"],
        results["summary"]["not_found"],
        results["summary"]["claimed_but_not_verified"],
    )

    return results


def save_trustmark_result(result, shop_id, scan_id, db_session):
    """Save trustmark verification results."""
    from app.models.collectors import TrustmarkRecord

    now = datetime.now(timezone.utc)
    
    verifications = result.get("verifications", [])
    
    record = TrustmarkRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        verifications=json.dumps(verifications),
        total_checked=result["summary"]["total_checked"],
        total_verified=result["summary"]["verified"],
        total_not_found=result["summary"]["not_found"],
        claimed_not_verified=result["summary"]["claimed_but_not_verified"],
        trustpilot_score=None,
        trustpilot_reviews=None,
        source="trustmark_verification",
        raw_data=json.dumps(result),
        collected_at=now,
    )

    # Extract Trustpilot data
    for v in verifications:
        if v.get("name") == "Trustpilot":
            if v.get("score"):
                try:
                    record.trustpilot_score = float(v["score"])
                except (ValueError, TypeError):
                    pass
            record.trustpilot_reviews = v.get("reviews")

    db_session.add(record)
    db_session.commit()
    return record


# ── CLI ──

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.trustmark_verify <url>")
        sys.exit(1)

    url = sys.argv[1]
    result = verify_all_trustmarks(url)

    print("\n" + "=" * 60)
    print("Keurmerk Verificatie - {}".format(result["domain"]))
    print("=" * 60)

    for v in result["verifications"]:
        status_icon = {
            "verified": "✅", "found": "✅",
            "likely_verified": "🟡",
            "not_found": "❌",
            "check_failed": "⚠️",
        }.get(v.get("status"), "❓")

        print("\n{} {}".format(status_icon, v["name"]))
        if v.get("details"):
            print("   {}".format(v["details"]))
        if v.get("score"):
            print("   Score: {}/5".format(v["score"]))
        if v.get("reviews"):
            print("   Reviews: {}".format(v["reviews"]))
        if v.get("claimed"):
            if v.get("verified"):
                print("   ✓ Geclaimed op site EN geverifieerd")
            else:
                print("   ⚠️ WEL geclaimed op site, NIET geverifieerd!")
        if v.get("url"):
            print("   {}".format(v["url"]))
        if v.get("error"):
            print("   Fout: {}".format(v["error"]))

    s = result["summary"]
    print("\n" + "-" * 40)
    print("Gecontroleerd: {} | Geverifieerd: {} | Niet gevonden: {}".format(
        s["total_checked"], s["verified"], s["not_found"]))
    if s["claimed_but_not_verified"] > 0:
        print("⚠️  WAARSCHUWING: {} keurmerk(en) geclaimed maar niet geverifieerd!".format(
            s["claimed_but_not_verified"]))
