"""
KVK (Kamer van Koophandel) Lookup Collector

Looks up KVK numbers found during scraping against:
1. Official KVK API (if API key configured in .env)
2. Free fallback via OpenKVK / web search

Returns: company name, address, legal form, SBI codes, active status.
Also checks if the KVK number matches the website domain/business.
"""
import json
import logging
import os
import re
from datetime import datetime, timezone, date
from typing import Optional, List
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 15
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# KVK API configuration
KVK_API_KEY = os.environ.get("KVK_API_KEY", "")
KVK_API_BASE = "https://api.kvk.nl/api/v2"
KVK_TEST_BASE = "https://api.kvk.nl/test/api/v2"


def _get_api_base():
    """Return test or production API base URL."""
    if os.environ.get("KVK_USE_TEST", "").lower() in ("1", "true", "yes"):
        return KVK_TEST_BASE
    return KVK_API_BASE


# ── Official KVK API ──

def _kvk_api_search(kvk_number):
    """Look up a KVK number via the official KVK API."""
    if not KVK_API_KEY:
        return None

    result = {
        "source": "kvk_api",
        "kvk_number": kvk_number,
        "company_name": None,
        "trade_names": [],
        "legal_form": None,
        "address": {},
        "is_active": None,
        "sbi_codes": [],
        "registration_date": None,
        "error": None,
    }

    try:
        base = _get_api_base()
        headers = {"apikey": KVK_API_KEY}

        # Step 1: Zoeken API
        search_url = "{}/zoeken?kvkNummer={}".format(base, kvk_number)
        response = requests.get(search_url, headers=headers, timeout=REQUEST_TIMEOUT)

        if response.status_code == 200:
            data = response.json()
            results = data.get("resultaten", [])
            if results:
                r = results[0]
                result["company_name"] = r.get("naam")
                result["kvk_number"] = r.get("kvkNummer", kvk_number)

                addr = r.get("adres", {}).get("binnenlandsAdres", {})
                result["address"] = {
                    "street": addr.get("straatnaam"),
                    "house_number": addr.get("huisnummer"),
                    "postal_code": addr.get("postcode"),
                    "city": addr.get("plaats"),
                    "country": "Nederland",
                }

                # Step 2: Basisprofiel for more details
                links = r.get("links", [])
                basisprofiel_url = None
                for link in links:
                    if link.get("rel") == "basisprofiel":
                        basisprofiel_url = link.get("href")
                        break

                if basisprofiel_url:
                    bp_response = requests.get(
                        basisprofiel_url, headers=headers, timeout=REQUEST_TIMEOUT
                    )
                    if bp_response.status_code == 200:
                        bp = bp_response.json()
                        result["legal_form"] = bp.get("indNonMailing")

                        # SBI codes
                        sbi = bp.get("spiActiviteiten", [])
                        result["sbi_codes"] = [
                            {"code": s.get("sbiCode"), "description": s.get("sbiOmschrijving")}
                            for s in sbi
                        ]

                        # Trade names
                        namen = bp.get("handelsnamen", [])
                        result["trade_names"] = [n.get("naam") for n in namen if n.get("naam")]

                        # Registration date
                        reg_date = bp.get("registratieDatumAanvang")
                        if reg_date:
                            result["registration_date"] = reg_date

        elif response.status_code == 403:
            result["error"] = "KVK API key ongeldig of verlopen"
        elif response.status_code == 404:
            result["error"] = "KVK-nummer niet gevonden"
        else:
            result["error"] = "KVK API HTTP {}".format(response.status_code)

    except Exception as e:
        result["error"] = str(e)

    return result


# ── Free fallback: OpenKVK / web search ──

def _openkvk_search(kvk_number):
    """Look up a KVK number via OpenKVK (gratis)."""
    result = {
        "source": "openkvk",
        "kvk_number": kvk_number,
        "company_name": None,
        "trade_names": [],
        "legal_form": None,
        "address": {},
        "is_active": None,
        "sbi_codes": [],
        "registration_date": None,
        "error": None,
    }

    try:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})

        # Try OpenKVK.nl
        url = "https://openkvk.nl/api/v1/bv/{}".format(kvk_number)
        response = session.get(url, timeout=REQUEST_TIMEOUT)

        if response.status_code == 200:
            try:
                data = response.json()
                if isinstance(data, dict):
                    result["company_name"] = data.get("handelsnaam") or data.get("naam")
                    result["legal_form"] = data.get("rechtsvorm")
                    result["is_active"] = data.get("status", "").lower() != "uitgeschreven"

                    addr = {}
                    if data.get("straat"):
                        addr["street"] = data.get("straat")
                    if data.get("huisnummer"):
                        addr["house_number"] = str(data.get("huisnummer"))
                    if data.get("postcode"):
                        addr["postal_code"] = data.get("postcode")
                    if data.get("plaats"):
                        addr["city"] = data.get("plaats")
                    addr["country"] = "Nederland"
                    result["address"] = addr

                    if data.get("sbiActiviteiten"):
                        result["sbi_codes"] = data["sbiActiviteiten"]

                    return result
            except (json.JSONDecodeError, ValueError):
                pass

        # Fallback: scrape kvk.nl zoeken
        search_url = "https://www.kvk.nl/zoeken/handelsregister/?kvknummer={}".format(kvk_number)
        response = session.get(search_url, timeout=REQUEST_TIMEOUT, allow_redirects=True)

        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "lxml")
            page_text = soup.get_text()

            # Try to extract company name from results
            name_el = soup.select_one("h3.handelsnaam, .company-name, [data-kvk-nummer]")
            if name_el:
                result["company_name"] = name_el.get_text(strip=True)

        # Fallback: DuckDuckGo search
        if not result["company_name"]:
            ddg_url = "https://html.duckduckgo.com/html/?q={}".format(
                quote('KVK {} bedrijf naam adres'.format(kvk_number))
            )
            response = session.get(ddg_url, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "lxml")
                for link in soup.select("a.result__a"):
                    title = link.get_text(strip=True)
                    href = link.get("href", "")
                    # Look for KVK or company registry results
                    if "kvk.nl" in href or "openkvk" in href or kvk_number in title:
                        # Extract company name from title
                        # Titles often look like: "Bedrijfsnaam - KVK 12345678"
                        name = re.sub(r'\s*[-|]\s*(KVK|kvk|Kamer).*$', '', title)
                        name = re.sub(r'\s*\d{8}\s*', '', name).strip()
                        if name and len(name) > 2:
                            result["company_name"] = name
                            break

    except Exception as e:
        result["error"] = str(e)

    return result


# ── Domain-name match check ──

def _check_domain_match(domain, company_name, trade_names):
    """
    Check if the website domain matches the company name or trade names.
    Returns a match score and details.
    """
    if not company_name and not trade_names:
        return {"match": "unknown", "score": 0, "details": "Geen bedrijfsnaam beschikbaar"}

    domain_clean = domain.lower().replace("-", "").replace(".", "")
    all_names = [company_name] + (trade_names or [])
    all_names = [n for n in all_names if n]

    best_match = 0
    best_name = None

    for name in all_names:
        name_clean = name.lower().replace(" ", "").replace("-", "").replace(".", "")

        # Exact match
        if name_clean in domain_clean or domain_clean in name_clean:
            return {
                "match": "strong",
                "score": 100,
                "details": "Domeinnaam komt overeen met '{}'".format(name),
                "matched_name": name,
            }

        # Partial match - check significant words
        words = [w for w in name.lower().split() if len(w) > 3]
        if words:
            matched_words = sum(1 for w in words if w in domain_clean)
            score = int((matched_words / len(words)) * 100)
            if score > best_match:
                best_match = score
                best_name = name

    if best_match >= 50:
        return {
            "match": "partial",
            "score": best_match,
            "details": "Domeinnaam komt deels overeen met '{}'".format(best_name),
            "matched_name": best_name,
        }

    return {
        "match": "none",
        "score": 0,
        "details": "Domeinnaam komt NIET overeen met bedrijfsnaam(en): {}".format(
            ", ".join(all_names[:3])
        ),
    }


# ── Domain search at KVK ──

def _search_kvk_by_domain(domain):
    """
    Search KVK for a business registered under this domain name.
    Strips TLD and searches as trade name.
    """
    result = {
        "source": "domain_search",
        "search_term": None,
        "found": False,
        "results": [],
        "error": None,
    }

    # Extract meaningful name from domain (remove TLD)
    domain_name = domain.split(".")[0].lower()
    # Also try with hyphens replaced by spaces
    search_terms = [domain_name]
    if "-" in domain_name:
        search_terms.append(domain_name.replace("-", " "))

    result["search_term"] = domain_name

    try:
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT})

        for term in search_terms:
            if len(term) < 3:
                continue

            # Try official KVK API first
            if KVK_API_KEY:
                try:
                    base = _get_api_base()
                    headers = {"apikey": KVK_API_KEY}
                    search_url = "{}/zoeken?handelsnaam={}".format(base, quote(term))
                    response = requests.get(search_url, headers=headers, timeout=REQUEST_TIMEOUT)
                    if response.status_code == 200:
                        data = response.json()
                        for r in data.get("resultaten", [])[:5]:
                            addr = r.get("adres", {}).get("binnenlandsAdres", {})
                            result["results"].append({
                                "kvk_number": r.get("kvkNummer"),
                                "name": r.get("naam"),
                                "city": addr.get("plaats"),
                                "type": r.get("type"),
                            })
                        if result["results"]:
                            result["found"] = True
                            return result
                except Exception:
                    pass

            # Fallback: DuckDuckGo search
            ddg_url = "https://html.duckduckgo.com/html/?q={}".format(
                quote('site:kvk.nl "{}"'.format(term))
            )
            response = session.get(ddg_url, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "lxml")
                for link in soup.select("a.result__a"):
                    title = link.get_text(strip=True)
                    href = link.get("href", "")
                    if "kvk.nl" in href:
                        # Extract KVK number from URL or title
                        kvk_match = re.search(r'(\d{8})', href + " " + title)
                        result["results"].append({
                            "kvk_number": kvk_match.group(1) if kvk_match else None,
                            "name": title[:100],
                            "city": None,
                            "type": None,
                            "url": href,
                        })

                if result["results"]:
                    result["found"] = True
                    return result

    except Exception as e:
        result["error"] = str(e)

    return result


# ── Main lookup function ──

def lookup_kvk(kvk_numbers: List[str], domain: str) -> dict:
    """
    Look up one or more KVK numbers AND search domain name at KVK.
    Uses official API if key is available, otherwise free fallback.

    Args:
        kvk_numbers: List of KVK numbers found on the website
        domain: The website domain (for matching)

    Returns dict with lookup results per KVK number + domain search.
    """
    logger.info("KVK lookup voor %d nummer(s), domein: %s", len(kvk_numbers), domain)

    results = {
        "domain": domain,
        "kvk_numbers_found": kvk_numbers,
        "lookups": [],
        "domain_search": None,
        "api_used": "kvk_api" if KVK_API_KEY else "openkvk_fallback",
        "total_found": 0,
        "total_active": 0,
        "domain_match": None,
    }

    # Step 1: Search KVK by domain name (always, even without KVK numbers)
    if domain:
        logger.info("Zoek domein '%s' als handelsnaam bij KVK", domain)
        domain_search = _search_kvk_by_domain(domain)
        results["domain_search"] = domain_search
        if domain_search.get("found"):
            logger.info("Domein '%s' gevonden bij KVK: %d resultaten", domain, len(domain_search["results"]))

    # Step 2: Look up specific KVK numbers found on the site
    for kvk_number in kvk_numbers[:5]:  # Max 5 lookups
        kvk_number = kvk_number.strip()
        if not re.match(r'^\d{8}$', kvk_number):
            logger.warning("Ongeldig KVK-nummer: %s", kvk_number)
            continue

        # Try official API first, then fallback
        lookup = None
        if KVK_API_KEY:
            lookup = _kvk_api_search(kvk_number)

        if not lookup or not lookup.get("company_name"):
            lookup = _openkvk_search(kvk_number)

        if lookup and lookup.get("company_name"):
            results["total_found"] += 1
            if lookup.get("is_active") is not False:
                results["total_active"] += 1

            # Check domain match
            domain_match = _check_domain_match(
                domain,
                lookup.get("company_name"),
                lookup.get("trade_names", []),
            )
            lookup["domain_match"] = domain_match

            # Use the best match for the overall result
            if not results["domain_match"] or domain_match["score"] > results["domain_match"]["score"]:
                results["domain_match"] = domain_match

        results["lookups"].append(lookup or {
            "kvk_number": kvk_number,
            "error": "Niet gevonden",
            "source": "none",
        })

    logger.info(
        "KVK lookup voltooid: %d gevonden, %d actief, domein-match: %s",
        results["total_found"], results["total_active"],
        results.get("domain_match", {}).get("match", "n/a"),
    )

    return results


def save_kvk_result(result: dict, shop_id: int, scan_id: int, db_session):
    """Save KVK lookup results to the database."""
    from app.models.collectors import KvKRecord

    now = datetime.now(timezone.utc)
    saved_any = False

    for lookup in result.get("lookups", []):
        if not lookup.get("kvk_number"):
            continue

        addr = lookup.get("address", {})
        reg_date = None
        if lookup.get("registration_date"):
            try:
                rd = str(lookup["registration_date"])
                if len(rd) == 8:
                    reg_date = date(int(rd[:4]), int(rd[4:6]), int(rd[6:8]))
            except (ValueError, TypeError):
                pass

        # Include domain_search in raw_data of first record
        raw = dict(lookup)
        if not saved_any and result.get("domain_search"):
            raw["domain_search"] = result["domain_search"]

        record = KvKRecord(
            shop_id=shop_id,
            scan_id=scan_id,
            kvk_number=lookup.get("kvk_number"),
            company_name=lookup.get("company_name"),
            trade_names=json.dumps(lookup.get("trade_names", [])),
            legal_form=lookup.get("legal_form"),
            registration_date=reg_date,
            street=addr.get("street"),
            house_number=addr.get("house_number"),
            postal_code=addr.get("postal_code"),
            city=addr.get("city"),
            country=addr.get("country", "Nederland"),
            is_active=lookup.get("is_active"),
            sbi_codes=json.dumps(lookup.get("sbi_codes", [])),
            source=lookup.get("source", "unknown"),
            raw_data=json.dumps(raw),
            collected_at=now,
        )
        db_session.add(record)
        saved_any = True

    # If no KVK numbers were found but domain search had results, save a placeholder
    if not saved_any and result.get("domain_search", {}).get("found"):
        ds = result["domain_search"]
        first_result = ds["results"][0] if ds.get("results") else {}
        record = KvKRecord(
            shop_id=shop_id,
            scan_id=scan_id,
            kvk_number=first_result.get("kvk_number"),
            company_name=first_result.get("name"),
            city=first_result.get("city"),
            source="domain_search",
            raw_data=json.dumps({"domain_search": ds}),
            collected_at=now,
        )
        db_session.add(record)

    db_session.commit()
    return result


# ── CLI ──

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.kvk_lookup <kvk_nummer> [domein]")
        print("  Voorbeeld: python -m app.collectors.kvk_lookup 12345678 bol.com")
        print("\n  Stel KVK_API_KEY in .env in voor de officiele API.")
        print("  Zonder API key wordt OpenKVK/web search gebruikt.")
        sys.exit(1)

    kvk_nums = [sys.argv[1]]
    domain = sys.argv[2] if len(sys.argv) > 2 else ""

    print("\nKVK API key: {}".format("Ja" if KVK_API_KEY else "Nee (gratis fallback)"))
    result = lookup_kvk(kvk_nums, domain)

    print("\n" + "=" * 60)
    print("KVK Lookup")
    print("=" * 60)

    for lookup in result["lookups"]:
        print("\nKVK-nummer: {}".format(lookup.get("kvk_number", "?")))
        if lookup.get("error"):
            print("  Fout: {}".format(lookup["error"]))
        if lookup.get("company_name"):
            print("  Bedrijfsnaam: {}".format(lookup["company_name"]))
        if lookup.get("trade_names"):
            print("  Handelsnamen: {}".format(", ".join(lookup["trade_names"])))
        if lookup.get("legal_form"):
            print("  Rechtsvorm: {}".format(lookup["legal_form"]))
        addr = lookup.get("address", {})
        if addr.get("street"):
            print("  Adres: {} {}, {} {}".format(
                addr.get("street", ""), addr.get("house_number", ""),
                addr.get("postal_code", ""), addr.get("city", ""),
            ))
        if lookup.get("is_active") is not None:
            print("  Actief: {}".format("Ja" if lookup["is_active"] else "NEE - Uitgeschreven!"))
        if lookup.get("sbi_codes"):
            print("  Activiteiten:")
            for sbi in lookup["sbi_codes"][:3]:
                if isinstance(sbi, dict):
                    print("    {} - {}".format(sbi.get("code", ""), sbi.get("description", "")))
                else:
                    print("    {}".format(sbi))
        if lookup.get("domain_match"):
            dm = lookup["domain_match"]
            icon = {"strong": "✅", "partial": "🟡", "none": "❌"}.get(dm["match"], "❓")
            print("  {} Domein-match: {} ({}%)".format(icon, dm["details"], dm["score"]))
        print("  Bron: {}".format(lookup.get("source", "?")))
