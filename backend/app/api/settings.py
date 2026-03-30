"""
Settings API — beheer API-sleutels en configuratie.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.settings import Setting

router = APIRouter()

# Vaste definitie van alle ondersteunde instellingen
SETTING_DEFINITIONS = [
    {
        "key": "meta_access_token",
        "label": "Meta / Facebook Access Token",
        "service": "meta",
        "description": (
            "Vereist voor de Meta Ad Library API om het advertentieaccount achter een "
            "Facebook Pixel te achterhalen. Genereer een token op "
            "developers.facebook.com → Tools → Graph API Explorer. "
            "Benodigde scope: ads_read."
        ),
    },
    {
        "key": "hackertarget_api_key",
        "label": "HackerTarget API Key",
        "service": "hackertarget",
        "description": (
            "Optioneel. Zonder sleutel geldt een limiet van 5 lookups per dag. "
            "Met een betaald account (hackertarget.com) vervalt die limiet. "
            "Wordt gebruikt voor reverse Analytics-ID lookups (UA-/GTM-)."
        ),
    },
    {
        "key": "spyonweb_api_key",
        "label": "SpyOnWeb API Key",
        "service": "spyonweb",
        "description": (
            "Optioneel. SpyOnWeb koppelt Analytics- en AdSense-ID's aan domeinen. "
            "Zonder sleutel wordt de publieke HTML-pagina gescraped (beperkt). "
            "API-sleutel beschikbaar via spyonweb.com."
        ),
    },
    {
        "key": "google_api_key",
        "label": "Google API Key",
        "service": "google",
        "description": (
            "Optioneel. Momenteel niet actief gebruikt — voorbereid voor toekomstige "
            "Google-integraties (bijv. Safe Browsing API). "
            "Aanmaken via console.cloud.google.com."
        ),
    },
]


def _get_or_create_all(db: Session):
    """Zorg dat alle gedefinieerde instellingen bestaan in de DB."""
    for defn in SETTING_DEFINITIONS:
        existing = db.query(Setting).filter(Setting.key == defn["key"]).first()
        if not existing:
            db.add(Setting(
                key=defn["key"],
                value=None,
                label=defn["label"],
                description=defn["description"],
                service=defn["service"],
            ))
    db.commit()


def _mask(value: str) -> str:
    """Toon alleen de laatste 4 tekens, de rest als sterretjes."""
    if not value:
        return ""
    if len(value) <= 4:
        return "*" * len(value)
    return "*" * (len(value) - 4) + value[-4:]


def get_setting_value(key: str, db: Session) -> str:
    """Helper voor collectors: haal de plaintext waarde op van een instelling."""
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if row else None


@router.get("/")
def list_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Geeft alle instellingen terug (waarden gemaskeerd)."""
    _get_or_create_all(db)
    rows = {r.key: r for r in db.query(Setting).all()}

    result = []
    for defn in SETTING_DEFINITIONS:
        row = rows.get(defn["key"])
        result.append({
            "key": defn["key"],
            "label": defn["label"],
            "description": defn["description"],
            "service": defn["service"],
            "is_configured": bool(row and row.value),
            "masked_value": _mask(row.value) if row else "",
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
        })
    return result


@router.put("/{key}")
def update_setting(
    key: str,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sla een nieuwe waarde op voor een instelling."""
    defn = next((d for d in SETTING_DEFINITIONS if d["key"] == key), None)
    if not defn:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Instelling niet gevonden")

    value = body.get("value", "").strip() or None

    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(Setting(key=key, value=value, label=defn["label"],
                       description=defn["description"], service=defn["service"]))
    db.commit()

    return {
        "key": key,
        "is_configured": bool(value),
        "masked_value": _mask(value) if value else "",
    }


@router.delete("/{key}")
def clear_setting(
    key: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Verwijder de waarde van een instelling."""
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = None
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
    return {"key": key, "is_configured": False}
