"""
Risico-score berekening voor webwinkels.

Elke check levert punten op (hogere score = betrouwbaarder).
Drempelwaarden bepalen het risiconiveau.

Pas SCORING_RULES en THRESHOLDS aan om het systeem te kalibreren.
"""
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


# ── Drempelwaarden (score 0–100) ──────────────────────────────────────────────
# score >= drempel → dat niveau of beter
THRESHOLDS = {
    "low":      70,   # >= 70 → laag risico
    "medium":   40,   # >= 40 → gemiddeld
    "high":     15,   # >= 15 → hoog
    # < 15 → kritiek
}


# ── Scoringsregels ────────────────────────────────────────────────────────────
# Elke regel: (sleutel, beschrijving, punten, malus_punten)
# punten     = opgeteld als de check slaagt
# malus      = afgetrokken als de check faalt (kan negatief worden)
#
# Totaal maximaal bereikbare punten = som van alle 'punten' waarden.
# Score wordt genormaliseerd naar 0–100.

@dataclass
class Rule:
    key: str
    label: str
    points: int       # punten bij aanwezig / positief
    malus: int = 0    # aftrek bij afwezig / negatief (altijd positief getal)
    tip: str = ""     # uitleg wat ontbreekt


SCORING_RULES = [
    # ── Contactgegevens ────────────────────────────────────────────────────────
    Rule("has_address",      "Fysiek adres gevonden",         15, malus=15,
         tip="Geen adres op de website gevonden."),
    Rule("has_email",        "E-mailadres gevonden",          10, malus=10,
         tip="Geen e-mailadres op de website gevonden."),
    Rule("has_phone",        "Telefoonnummer gevonden",        5, malus=0,
         tip="Geen telefoonnummer gevonden."),

    # ── Bedrijfsregistratie ────────────────────────────────────────────────────
    Rule("has_kvk",          "KvK-nummer gevonden",           15, malus=10,
         tip="Geen KvK-nummer op de website gevonden."),
    Rule("has_btw",          "BTW-nummer gevonden",            5, malus=0,
         tip="Geen BTW-nummer gevonden."),
    Rule("kvk_verified",     "KvK geverifieerd in register",  10, malus=5,
         tip="KvK-nummer niet verifieerbaar in het register."),

    # ── Pagina's ───────────────────────────────────────────────────────────────
    Rule("has_contact_page", "Contactpagina aanwezig",         5, malus=5,
         tip="Geen contactpagina gevonden."),
    Rule("has_privacy",      "Privacyverklaring aanwezig",     5, malus=3,
         tip="Geen privacyverklaring gevonden."),
    Rule("has_terms",        "Algemene voorwaarden aanwezig",  5, malus=3,
         tip="Geen algemene voorwaarden gevonden."),
    Rule("has_returns",      "Retourbeleid aanwezig",          5, malus=3,
         tip="Geen retourbeleid gevonden."),

    # ── Bankrekening ──────────────────────────────────────────────────────────
    Rule("has_nl_iban",      "Nederlandse bankrekening (NL IBAN)",  10, malus=5,
         tip="Geen Nederlandse bankrekening gevonden."),
    Rule("no_foreign_iban",  "Geen buitenlandse bankrekening",      0,  malus=20,
         tip="Buitenlandse bankrekening gevonden — verhoogd risico voor NL webwinkel."),

    # ── Technisch ─────────────────────────────────────────────────────────────
    Rule("has_ssl",          "Geldig SSL-certificaat",         5, malus=10,
         tip="Geen geldig SSL-certificaat."),
    Rule("domain_age_1yr",   "Domein ouder dan 1 jaar",        5, malus=5,
         tip="Domein is jonger dan 1 jaar — verhoogd risico."),
    Rule("domain_age_2yr",   "Domein ouder dan 2 jaar",        5, malus=0,
         tip="Domein is jonger dan 2 jaar."),

    # ── Keurmerken ────────────────────────────────────────────────────────────
    Rule("has_verified_tm",  "Geverifieerd keurmerk aanwezig", 5, malus=0,
         tip="Geen geverifieerd keurmerk gevonden."),
    Rule("no_fake_tm",       "Geen vals keurmerk",            10, malus=20,
         tip="Vals of niet-geverifieerd keurmerk gevonden — sterke rode vlag."),

    # ── Fraudedatabases ───────────────────────────────────────────────────────
    Rule("not_in_scam_db",   "Niet in fraudedatabase",         0, malus=40,
         tip="Domein gevonden in fraudedatabase (opgelicht.nl / fraudehelpdesk.nl / watchlistinternet.nl) — kritiek risico."),
]

MAX_SCORE = sum(r.points for r in SCORING_RULES)  # theoretisch maximum


@dataclass
class ScoreResult:
    score: float                    # 0–100 genormaliseerd
    raw_score: int                  # ruwe punten
    max_raw: int                    # maximaal haalbaar
    risk_level: str                 # unknown / low / medium / high / critical
    checks: dict = field(default_factory=dict)   # key → True/False
    earned: dict = field(default_factory=dict)   # key → punten verdiend
    tips: list = field(default_factory=list)     # verbeterpunten


def _collect_data(shop_id: int, db) -> dict:
    """Haal de meest recente collector-resultaten op voor een shop."""
    from app.models.collectors import (
        ScrapeRecord, WhoisRecord, SSLRecord,
        TrustmarkRecord, KvkRecord, ScamCheckRecord,
    )

    def latest(model):
        return (
            db.query(model)
            .filter(model.shop_id == shop_id)
            .order_by(model.id.desc())
            .first()
        )

    scrape    = latest(ScrapeRecord)
    whois     = latest(WhoisRecord)
    ssl       = latest(SSLRecord)
    trustmark = latest(TrustmarkRecord)
    kvk_rec   = latest(KvkRecord)
    scam      = latest(ScamCheckRecord)

    def parse(val):
        if not val:
            return []
        try:
            return json.loads(val) if isinstance(val, str) else val
        except Exception:
            return []

    data = {
        # Scrape
        "emails":        len(parse(scrape.emails_found))    if scrape else 0,
        "phones":        len(parse(scrape.phones_found))    if scrape else 0,
        "addresses":     len(parse(scrape.addresses_found)) if scrape else 0,
        "contact_page":  scrape.has_contact_page            if scrape else False,
        "privacy_page":  scrape.has_privacy_page            if scrape else False,
        "terms_page":    scrape.has_terms_page              if scrape else False,
        "returns_page":  scrape.has_return_policy           if scrape else False,
        "kvk_on_site":   len(parse(scrape.kvk_number_found)) > 0 if scrape else False,
        "ibans":         parse(scrape.iban_found) if scrape else [],
        # WHOIS
        "domain_age":    whois.domain_age_days              if whois else None,
        # SSL
        "ssl_valid":     (ssl.has_ssl and not ssl.is_expired) if ssl else False,
        # Trustmark
        "tm_verified":   (trustmark.total_verified or 0)    if trustmark else 0,
        "tm_fake":       (trustmark.claimed_not_verified or 0) if trustmark else 0,
        # KvK
        "kvk_verified":  bool(kvk_rec and kvk_rec.kvk_number) if kvk_rec else False,
        # Scam check — None = not yet run, False = clean, True = flagged
        "scam_flagged":  scam.flagged if scam else None,
    }
    return data


def calculate_risk(shop_id: int, db) -> ScoreResult:
    """Bereken de risicoscore voor een webwinkel op basis van scanresultaten."""
    data = _collect_data(shop_id, db)

    checks = {
        "has_address":      data["addresses"] > 0,
        "has_email":        data["emails"] > 0,
        "has_phone":        data["phones"] > 0,
        "has_kvk":          data["kvk_on_site"],
        "has_btw":          False,  # BTW zit nog niet als los veld in ScrapeRecord
        "has_nl_iban":      any(iban.upper().startswith("NL") for iban in data["ibans"]),
        "no_foreign_iban":  not any(not iban.upper().startswith("NL") for iban in data["ibans"]),
        "kvk_verified":     data["kvk_verified"],
        "has_contact_page": bool(data["contact_page"]),
        "has_privacy":      bool(data["privacy_page"]),
        "has_terms":        bool(data["terms_page"]),
        "has_returns":      bool(data["returns_page"]),
        "has_ssl":          data["ssl_valid"],
        "domain_age_1yr":   (data["domain_age"] or 0) >= 365,
        "domain_age_2yr":   (data["domain_age"] or 0) >= 730,
        "has_verified_tm":  data["tm_verified"] > 0,
        "no_fake_tm":       data["tm_fake"] == 0,
        # Scam check: True (clean) als scam_flagged False is; als None (niet gedraaid) → True (geen malus)
        "not_in_scam_db":   data["scam_flagged"] is not True,
    }

    raw_score = 0
    earned = {}
    tips = []

    for rule in SCORING_RULES:
        ok = checks.get(rule.key, False)
        if ok:
            pts = rule.points
        else:
            pts = -rule.malus
            if rule.malus > 0 and rule.tip:
                tips.append({"key": rule.key, "label": rule.label, "tip": rule.tip, "impact": rule.malus})

        earned[rule.key] = pts
        raw_score += pts

    # Normaliseer naar 0–100 (clamp zodat malussen niet onder 0 gaan)
    raw_clamped = max(0, raw_score)
    score = round((raw_clamped / MAX_SCORE) * 100, 1)

    # Bepaal risiconiveau
    if score >= THRESHOLDS["low"]:
        level = "low"
    elif score >= THRESHOLDS["medium"]:
        level = "medium"
    elif score >= THRESHOLDS["high"]:
        level = "high"
    else:
        level = "critical"

    # Sorteer tips op impact (grootste aftrek eerst)
    tips.sort(key=lambda t: t["impact"], reverse=True)

    logger.info(
        "Risicoscore voor shop %s: %.1f/100 → %s (ruw: %d/%d)",
        shop_id, score, level, raw_score, MAX_SCORE,
    )

    return ScoreResult(
        score=score,
        raw_score=raw_score,
        max_raw=MAX_SCORE,
        risk_level=level,
        checks=checks,
        earned=earned,
        tips=tips,
    )


def apply_risk_to_shop(shop_id: int, db) -> ScoreResult:
    """Bereken en sla de risicoscore op in de Shop tabel."""
    from app.models.shop import Shop

    result = calculate_risk(shop_id, db)
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if shop:
        shop.risk_score = result.score
        shop.risk_level = result.risk_level
        db.commit()
    return result
