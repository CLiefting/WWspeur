"""
WHOIS Collector

Fetches domain registration data:
- Registrar
- Registration/expiration dates
- Domain age
- Registrant info (name, org, country)
- Privacy protection detection
- Name servers
"""
import json
import logging
from datetime import datetime, timezone, date
from typing import Optional
from urllib.parse import urlparse

import whois

logger = logging.getLogger(__name__)

# Keywords that indicate privacy/proxy registration
PRIVACY_KEYWORDS = [
    "privacy", "proxy", "redacted", "whoisguard", "domains by proxy",
    "contact privacy", "withheld", "gdpr", "data protected",
    "whois privacy", "perfect privacy", "identity protect",
    "not disclosed", "statutory masking", "domain protection",
]


def _extract_domain(url: str) -> str:
    """Extract the registrable domain from a URL."""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    domain = parsed.netloc.lower().removeprefix("www.")
    return domain


def _to_date(value) -> Optional[date]:
    """Convert various date formats to a date object."""
    if value is None:
        return None
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    # Try parsing string
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        pass
    return None


def _to_str(value) -> Optional[str]:
    """Convert value to string, handling lists."""
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return str(value)


def _detect_privacy(whois_data) -> bool:
    """Detect if WHOIS data is privacy-protected."""
    fields_to_check = [
        getattr(whois_data, 'org', None),
        getattr(whois_data, 'name', None),
        getattr(whois_data, 'registrant', None),
        getattr(whois_data, 'emails', None),
    ]
    
    for field in fields_to_check:
        if field is None:
            continue
        text = str(field).lower() if not isinstance(field, list) else " ".join(str(f) for f in field).lower()
        if any(kw in text for kw in PRIVACY_KEYWORDS):
            return True
    
    # If most fields are None/empty, likely privacy protected
    registrant_fields = [
        getattr(whois_data, 'name', None),
        getattr(whois_data, 'org', None),
        getattr(whois_data, 'address', None),
    ]
    empty_count = sum(1 for f in registrant_fields if not f)
    if empty_count >= 2:
        return None  # Onvoldoende data om vast te stellen

    return False


def lookup_whois(url: str) -> dict:
    """
    Perform a WHOIS lookup for the domain in the given URL.
    
    Returns a dict with all extracted WHOIS data.
    """
    domain = _extract_domain(url)
    logger.info(f"WHOIS lookup voor: {domain}")
    
    result = {
        "domain": domain,
        "registrar": None,
        "registrant_name": None,
        "registrant_organization": None,
        "registrant_country": None,
        "registration_date": None,
        "expiration_date": None,
        "updated_date": None,
        "name_servers": [],
        "domain_age_days": None,
        "is_privacy_protected": None,
        "raw_data": None,
        "error": None,
    }
    
    try:
        w = whois.whois(domain)
        
        if w is None or (hasattr(w, 'status') and w.status is None):
            result["error"] = "Geen WHOIS data gevonden"
            return result
        
        # Registrar
        result["registrar"] = _to_str(getattr(w, 'registrar', None))
        
        # Registrant info
        result["registrant_name"] = _to_str(getattr(w, 'name', None))
        result["registrant_organization"] = _to_str(getattr(w, 'org', None))
        result["registrant_country"] = _to_str(getattr(w, 'country', None))
        
        # Dates
        result["registration_date"] = _to_date(getattr(w, 'creation_date', None))
        result["expiration_date"] = _to_date(getattr(w, 'expiration_date', None))
        result["updated_date"] = _to_date(getattr(w, 'updated_date', None))
        
        # Domain age
        if result["registration_date"]:
            today = datetime.now(timezone.utc).date()
            result["domain_age_days"] = (today - result["registration_date"]).days
        
        # Name servers
        ns = getattr(w, 'name_servers', None)
        if ns:
            if isinstance(ns, list):
                result["name_servers"] = list(dict.fromkeys(str(n).lower() for n in ns if n))
            else:
                result["name_servers"] = [str(ns).lower()]
        
        # Privacy detection
        result["is_privacy_protected"] = _detect_privacy(w)
        
        # Raw data for debugging (afgekapt op 10.000 tekens)
        try:
            raw = w.text if hasattr(w, 'text') else str(w)
            result["raw_data"] = raw[:10_000] if raw else None
        except Exception:
            result["raw_data"] = None
        
        logger.info(
            f"WHOIS voltooid voor {domain}: "
            f"registrar={result['registrar']}, "
            f"leeftijd={result['domain_age_days']} dagen, "
            f"privacy={result['is_privacy_protected']}"
        )
        
    except whois.parser.PywhoisError as e:
        error_msg = str(e)
        logger.warning(f"WHOIS fout voor {domain}: {error_msg}")
        result["error"] = error_msg
    except Exception as e:
        logger.error(f"WHOIS onverwachte fout voor {domain}: {e}")
        result["error"] = str(e)
    
    return result


def save_whois_result(
    result: dict,
    shop_id: int,
    scan_id: Optional[int],
    db_session,
):
    """Save WHOIS result to the database."""
    from app.models.collectors import WhoisRecord
    
    now = datetime.now(timezone.utc)
    
    record = WhoisRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        registrar=result.get("registrar"),
        registrant_name=result.get("registrant_name"),
        registrant_organization=result.get("registrant_organization"),
        registrant_country=result.get("registrant_country"),
        registration_date=result.get("registration_date"),
        expiration_date=result.get("expiration_date"),
        updated_date=result.get("updated_date"),
        name_servers=json.dumps(result.get("name_servers", [])),
        domain_age_days=result.get("domain_age_days"),
        is_privacy_protected=result.get("is_privacy_protected"),
        source="whois_lookup",
        raw_data=result.get("raw_data"),
        collected_at=now,
    )
    
    db_session.add(record)
    db_session.flush()
    return record


# ── CLI for standalone testing ──

if __name__ == "__main__":
    import sys
    
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    
    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.whois_lookup <url>")
        print("Voorbeeld: python -m app.collectors.whois_lookup https://bol.com")
        sys.exit(1)
    
    url = sys.argv[1]
    result = lookup_whois(url)
    
    print(f"\n{'='*60}")
    print(f"WHOIS - {result['domain']}")
    print(f"{'='*60}")
    
    if result.get("error"):
        print(f"⚠️  Fout: {result['error']}")
    
    print(f"Registrar:      {result['registrar'] or '—'}")
    print(f"Registrant:     {result['registrant_name'] or '—'}")
    print(f"Organisatie:    {result['registrant_organization'] or '—'}")
    print(f"Land:           {result['registrant_country'] or '—'}")
    print(f"Geregistreerd:  {result['registration_date'] or '—'}")
    print(f"Vervalt:        {result['expiration_date'] or '—'}")
    print(f"Domein leeftijd: {result['domain_age_days'] or '—'} dagen")
    print(f"Privacy:        {'Ja' if result['is_privacy_protected'] else 'Nee'}")
    
    if result['name_servers']:
        print(f"Nameservers:    {', '.join(result['name_servers'])}")
