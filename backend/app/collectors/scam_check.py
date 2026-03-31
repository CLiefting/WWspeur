"""
Scam-database check: zoekt het domein op bij Nederlandse fraudedatabases.

Gecheckte bronnen:
- opgelicht.nl       — meldingen van oplichting door consumenten
- fraudehelpdesk.nl  — officiële fraudemeldpunt
- watchlistinternet.nl — door ConsuWijzer bijgehouden waarschuwingslijst
"""
import logging
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Gedeelde sessie met browser-headers om 403/429 te vermijden
_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
})

TIMEOUT = 15


def _extract_domain(url: str) -> str:
    """Geeft het kale domein terug zonder www. en subdomains."""
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = parsed.netloc or parsed.path
    host = host.lower().lstrip("www.")
    # Verwijder poort
    host = host.split(":")[0]
    return host


def _check_opgelicht(domain: str) -> dict:
    """Zoek domein op bij opgelicht.nl via de zoekfunctie."""
    result = {"found": False, "count": 0, "url": None, "hits": []}
    try:
        search_url = f"https://www.opgelicht.nl/oplichters/?zoek={domain}"
        resp = _SESSION.get(search_url, timeout=TIMEOUT, allow_redirects=True)
        result["url"] = search_url

        if resp.status_code != 200:
            logger.debug(f"opgelicht.nl: HTTP {resp.status_code} voor {domain}")
            return result

        soup = BeautifulSoup(resp.text, "html.parser")

        # Tel hits — opgelicht.nl toont resultaten als li-elementen of articles
        hits = []
        for item in soup.select("article, .result-item, li.search-result"):
            text = item.get_text(separator=" ", strip=True)
            if domain.lower() in text.lower():
                title_el = item.select_one("h2, h3, .title, a")
                title = title_el.get_text(strip=True) if title_el else text[:100]
                hits.append(title)

        # Fallback: zoek in de volledige tekst
        if not hits:
            page_text = soup.get_text()
            # Tel hoe vaak het domein terugkomt (excl. navigatie-links)
            occurrences = len(re.findall(re.escape(domain), page_text, re.IGNORECASE))
            if occurrences >= 2:
                hits.append(f"Domein {occurrences}x gevonden in zoekresultaten")

        result["found"] = len(hits) > 0
        result["count"] = len(hits)
        result["hits"] = hits[:5]

    except Exception as e:
        logger.warning(f"opgelicht.nl check mislukt voor {domain}: {e}")

    return result


def _check_fraudehelpdesk(domain: str) -> dict:
    """Zoek domein op bij fraudehelpdesk.nl."""
    result = {"found": False, "count": 0, "url": None, "hits": []}
    try:
        search_url = f"https://www.fraudehelpdesk.nl/zoeken/?s={domain}"
        resp = _SESSION.get(search_url, timeout=TIMEOUT, allow_redirects=True)
        result["url"] = search_url

        if resp.status_code != 200:
            logger.debug(f"fraudehelpdesk.nl: HTTP {resp.status_code} voor {domain}")
            return result

        soup = BeautifulSoup(resp.text, "html.parser")

        hits = []
        # fraudehelpdesk.nl gebruikt WordPress-achtige search results
        for item in soup.select("article, .post, .search-result, li.result"):
            text = item.get_text(separator=" ", strip=True)
            if domain.lower() in text.lower():
                title_el = item.select_one("h1, h2, h3, .entry-title, a")
                title = title_el.get_text(strip=True) if title_el else text[:100]
                hits.append(title)

        # Fallback: zoek "geen resultaten" bericht — als dat er niet is, zijn er resultaten
        page_text = soup.get_text()
        if not hits:
            occurrences = len(re.findall(re.escape(domain), page_text, re.IGNORECASE))
            no_results_phrases = [
                "geen resultaten", "nothing found", "0 resultaten",
                "no results", "niets gevonden",
            ]
            has_no_results = any(p in page_text.lower() for p in no_results_phrases)
            if occurrences >= 2 and not has_no_results:
                hits.append(f"Domein {occurrences}x gevonden in zoekresultaten")

        result["found"] = len(hits) > 0
        result["count"] = len(hits)
        result["hits"] = hits[:5]

    except Exception as e:
        logger.warning(f"fraudehelpdesk.nl check mislukt voor {domain}: {e}")

    return result


def _check_watchlist(domain: str) -> dict:
    """Zoek domein op bij watchlistinternet.nl."""
    result = {"found": False, "count": 0, "url": None, "hits": [], "warning_level": None}
    try:
        # Watchlist Internet heeft een directe domeinkopzoeking
        search_url = f"https://www.watchlistinternet.nl/zoeken/?q={domain}"
        resp = _SESSION.get(search_url, timeout=TIMEOUT, allow_redirects=True)
        result["url"] = search_url

        if resp.status_code != 200:
            logger.debug(f"watchlistinternet.nl: HTTP {resp.status_code} voor {domain}")
            return result

        soup = BeautifulSoup(resp.text, "html.parser")

        hits = []
        warning_level = None

        for item in soup.select("article, .warning-item, .result, li.post"):
            text = item.get_text(separator=" ", strip=True)
            if domain.lower() in text.lower():
                title_el = item.select_one("h1, h2, h3, .title, a")
                title = title_el.get_text(strip=True) if title_el else text[:100]
                hits.append(title)

                # Probeer waarschuwingsniveau te achterhalen
                classes = " ".join(item.get("class", []))
                if "red" in classes or "gevaarlijk" in text.lower() or "oplichting" in text.lower():
                    warning_level = "hoog"
                elif "orange" in classes or "verdacht" in text.lower():
                    warning_level = "medium"
                elif not warning_level:
                    warning_level = "laag"

        if not hits:
            page_text = soup.get_text()
            occurrences = len(re.findall(re.escape(domain), page_text, re.IGNORECASE))
            no_results_phrases = ["geen resultaten", "niets gevonden", "no results", "0 resultaten"]
            has_no_results = any(p in page_text.lower() for p in no_results_phrases)
            if occurrences >= 2 and not has_no_results:
                hits.append(f"Domein {occurrences}x gevonden in zoekresultaten")
                warning_level = "onbekend"

        result["found"] = len(hits) > 0
        result["count"] = len(hits)
        result["hits"] = hits[:5]
        result["warning_level"] = warning_level

    except Exception as e:
        logger.warning(f"watchlistinternet.nl check mislukt voor {domain}: {e}")

    return result


def check_scam_databases(url: str) -> dict:
    """
    Voer de scam-database checks uit voor een domein.

    Geeft een dict terug met:
    - domain: gecheckt domein
    - flagged: True als minstens één database een hit heeft
    - sources: resultaten per bron
    - total_hits: totaal aantal hits over alle bronnen
    - error: eventuele foutmelding
    """
    domain = _extract_domain(url)
    logger.info(f"Scam-check voor domein: {domain}")

    sources = {}
    total_hits = 0

    try:
        sources["opgelicht"] = _check_opgelicht(domain)
        time.sleep(0.5)  # Beleefd wachten tussen requests

        sources["fraudehelpdesk"] = _check_fraudehelpdesk(domain)
        time.sleep(0.5)

        sources["watchlist"] = _check_watchlist(domain)

        total_hits = sum(s.get("count", 0) for s in sources.values())
        flagged = any(s.get("found", False) for s in sources.values())

        logger.info(
            f"Scam-check klaar voor {domain}: flagged={flagged}, "
            f"hits={total_hits} ({[k for k,v in sources.items() if v.get('found')]})"
        )

        return {
            "domain": domain,
            "flagged": flagged,
            "sources": sources,
            "total_hits": total_hits,
            "error": None,
        }

    except Exception as e:
        logger.error(f"Scam-check mislukt voor {domain}: {e}", exc_info=True)
        return {
            "domain": domain,
            "flagged": False,
            "sources": sources,
            "total_hits": total_hits,
            "error": str(e),
        }


def save_scam_check_result(result: dict, shop_id: int, scan_id: int, db) -> None:
    """Sla het scam-check resultaat op in de database."""
    import json
    from app.models.collectors import ScamCheckRecord

    record = ScamCheckRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        domain=result.get("domain", ""),
        flagged=result.get("flagged", False),
        total_hits=result.get("total_hits", 0),
        opgelicht_found=result.get("sources", {}).get("opgelicht", {}).get("found", False),
        opgelicht_count=result.get("sources", {}).get("opgelicht", {}).get("count", 0),
        opgelicht_hits=json.dumps(result.get("sources", {}).get("opgelicht", {}).get("hits", [])),
        fraudehelpdesk_found=result.get("sources", {}).get("fraudehelpdesk", {}).get("found", False),
        fraudehelpdesk_count=result.get("sources", {}).get("fraudehelpdesk", {}).get("count", 0),
        fraudehelpdesk_hits=json.dumps(result.get("sources", {}).get("fraudehelpdesk", {}).get("hits", [])),
        watchlist_found=result.get("sources", {}).get("watchlist", {}).get("found", False),
        watchlist_count=result.get("sources", {}).get("watchlist", {}).get("count", 0),
        watchlist_hits=json.dumps(result.get("sources", {}).get("watchlist", {}).get("hits", [])),
        watchlist_warning_level=result.get("sources", {}).get("watchlist", {}).get("warning_level"),
        raw_data=json.dumps(result),
        source="scam_check",
        collected_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    logger.info(f"ScamCheckRecord opgeslagen voor shop {shop_id}: flagged={result.get('flagged')}")
