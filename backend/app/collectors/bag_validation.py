"""
BAG/PDOK adresvalidatie collector.

Valideert gevonden adressen via de gratis PDOK Locatieserver API.
Geen API-sleutel nodig.
"""
import json
import logging
import time
from datetime import datetime, timezone

import requests

logger = logging.getLogger(__name__)

PDOK_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"
MAX_ADDRESSES = 10      # maximaal te valideren adressen per scan
REQUEST_TIMEOUT = 8
DELAY = 0.3             # beleefd wachten tussen verzoeken


def _validate_single(address: str) -> dict:
    """Valideer één adres via PDOK. Geeft dict terug met valid, bag_address, score."""
    try:
        resp = requests.get(
            PDOK_URL,
            params={"q": address, "fq": "type:adres", "rows": 1},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        docs = data.get("response", {}).get("docs", [])
        if not docs:
            return {"address": address, "valid": False, "bag_address": None, "score": 0.0}
        doc = docs[0]
        score = float(doc.get("score", 0))
        bag_address = doc.get("weergavenaam", "")
        # Score > 5 en een retouradres → geldig
        valid = score > 5 and bool(bag_address)
        return {
            "address": address,
            "valid": valid,
            "bag_address": bag_address if valid else None,
            "score": round(score, 2),
        }
    except Exception as e:
        logger.warning(f"PDOK lookup mislukt voor '{address}': {e}")
        return {"address": address, "valid": None, "bag_address": None, "error": str(e)}


def validate_addresses(addresses: list) -> dict:
    """Valideer een lijst adressen (max MAX_ADDRESSES) via PDOK."""
    results = []
    for addr in addresses[:MAX_ADDRESSES]:
        result = _validate_single(addr)
        results.append(result)
        time.sleep(DELAY)

    valid = sum(1 for r in results if r.get("valid") is True)
    invalid = sum(1 for r in results if r.get("valid") is False)
    return {
        "addresses_checked": len(results),
        "addresses_valid": valid,
        "addresses_invalid": invalid,
        "results": results,
    }


def save_bag_result(result: dict, shop_id: int, scan_id: int, db_session) -> object:
    from app.models.collectors import BagValidationRecord
    record = BagValidationRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        addresses_checked=result["addresses_checked"],
        addresses_valid=result["addresses_valid"],
        addresses_invalid=result["addresses_invalid"],
        validation_results=json.dumps(result["results"]),
        collected_at=datetime.now(timezone.utc),
    )
    db_session.add(record)
    db_session.commit()
    return record
