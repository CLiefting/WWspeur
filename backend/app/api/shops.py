"""
Shops API endpoints: create, list, detail, update, delete, CSV import.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from urllib.parse import urlparse
from typing import Optional
import csv
import io
import ipaddress
import socket

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.shop import Shop
from app.schemas.shop import ShopCreate, ShopResponse, ShopListResponse, ShopUpdate
from app.schemas.scan import ShopDetailResponse

router = APIRouter()

THUMBNAIL_CACHE_DIR = "/tmp/wwspeur_thumbnails"
THUMBNAIL_MAX_AGE = 86400  # 24 uur


@router.get("/{shop_id}/thumbnail")
def get_thumbnail(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Geeft een JPEG thumbnail van de homepage van een shop."""
    import subprocess, os, time
    from fastapi.responses import FileResponse, Response

    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Webwinkel niet gevonden")

    os.makedirs(THUMBNAIL_CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(THUMBNAIL_CACHE_DIR, f"{shop_id}.jpg")

    # Gebruik cache als recent genoeg
    if os.path.exists(cache_path) and (time.time() - os.path.getmtime(cache_path)) < THUMBNAIL_MAX_AGE:
        return FileResponse(cache_path, media_type="image/jpeg")

    script_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports", "thumbnail.js")
    node_modules = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "node_modules")

    try:
        result = subprocess.run(
            ["node", script_path, shop.url, cache_path],
            capture_output=True, text=True, timeout=25,
            env={**os.environ, "NODE_PATH": node_modules},
        )
        if result.returncode == 0 and os.path.exists(cache_path):
            return FileResponse(cache_path, media_type="image/jpeg")
    except Exception:
        pass

    raise HTTPException(status_code=503, detail="Thumbnail niet beschikbaar")

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]

_MAX_CSV_SIZE = 5 * 1024 * 1024  # 5 MB


def _is_private_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in net for net in _PRIVATE_NETWORKS)
    except ValueError:
        return False


def validate_public_url(url: str) -> None:
    """Raise HTTPException if the URL resolves to a private/internal IP (SSRF prevention)."""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    blocked_hostnames = {"localhost", "metadata.google.internal", "169.254.169.254"}
    if hostname in blocked_hostnames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Interne adressen zijn niet toegestaan",
        )

    # Resolve hostname and check if it points to a private IP
    try:
        infos = socket.getaddrinfo(hostname, None)
        for info in infos:
            ip = info[4][0]
            if _is_private_ip(ip):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Interne adressen zijn niet toegestaan",
                )
    except HTTPException:
        raise
    except OSError:
        pass  # DNS resolution failed — laat de collector het zelf afhandelen


def extract_domain(url: str) -> str:
    """Extract domain from a URL."""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    domain = parsed.netloc or parsed.path.split("/")[0]
    # Remove www. prefix
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def normalize_url(url: str) -> str:
    """Normalize a URL to ensure it has a scheme."""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


@router.post("/", response_model=ShopResponse, status_code=status.HTTP_201_CREATED)
def create_shop(
    shop_data: ShopCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a new webshop to investigate."""
    url = normalize_url(shop_data.url)
    validate_public_url(url)
    domain = extract_domain(url)

    # Check if URL already exists
    existing = db.query(Shop).filter(Shop.url == url).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Deze URL bestaat al (shop ID: {existing.id})",
        )

    shop = Shop(
        url=url,
        domain=domain,
        name=shop_data.name,
        notes=shop_data.notes,
        added_by=current_user.id,
    )
    db.add(shop)
    db.commit()
    db.refresh(shop)

    return shop


@router.post("/import-csv", response_model=dict)
async def import_csv(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Import webshops from a CSV file.
    The CSV should have a 'url' column (or just one URL per line).
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Alleen CSV-bestanden zijn toegestaan",
        )

    content = await file.read(_MAX_CSV_SIZE + 1)
    if len(content) > _MAX_CSV_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="CSV-bestand is te groot (max 5 MB)",
        )
    text = content.decode("utf-8-sig")  # Handle BOM

    added = []
    skipped = []
    errors = []

    # Try to detect if it has a header
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Het CSV-bestand is leeg",
        )

    # Check if first row is a header
    first_row = rows[0]
    start_idx = 0
    url_col = 0

    if any(h.lower().strip() in ("url", "website", "link", "webshop") for h in first_row):
        start_idx = 1
        # Find the URL column
        for i, h in enumerate(first_row):
            if h.lower().strip() in ("url", "website", "link", "webshop"):
                url_col = i
                break

    for row_num, row in enumerate(rows[start_idx:], start=start_idx + 1):
        if not row or not row[url_col].strip():
            continue

        raw_url = row[url_col].strip()

        try:
            url = normalize_url(raw_url)
            validate_public_url(url)
            domain = extract_domain(url)

            existing = db.query(Shop).filter(
                (Shop.url == url) | (Shop.domain == domain)
            ).first()
            if existing:
                skipped.append({"url": raw_url, "reason": "Bestaat al"})
                continue

            shop = Shop(
                url=url,
                domain=domain,
                added_by=current_user.id,
            )
            db.add(shop)
            added.append(raw_url)

        except Exception as e:
            errors.append({"url": raw_url, "row": row_num, "error": str(e)})

    db.commit()

    return {
        "total_processed": len(rows) - start_idx,
        "added": len(added),
        "skipped": len(skipped),
        "errors": len(errors),
        "added_urls": added,
        "skipped_details": skipped,
        "error_details": errors,
    }


@router.get("/", response_model=ShopListResponse)
def list_shops(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    risk_level: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all shops with pagination and filtering."""
    query = db.query(Shop)

    # Search filter
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            (Shop.url.ilike(search_term))
            | (Shop.domain.ilike(search_term))
            | (Shop.name.ilike(search_term))
        )

    # Risk level filter
    if risk_level:
        query = query.filter(Shop.risk_level == risk_level)

    total = query.count()

    # Sort: unscanned first (alphabetical), then scanned (alphabetical)
    from app.models.scan import Scan
    from sqlalchemy import case, exists

    has_scan = (
        db.query(Scan.id)
        .filter(Scan.shop_id == Shop.id, Scan.status == "completed")
        .exists()
    )

    shops = (
        query.order_by(
            case((has_scan, 1), else_=0).asc(),  # 0=unscanned first, 1=scanned
            Shop.domain.asc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    # Add last_scanned and scan_stats from related records
    from app.models.collectors import ScrapeRecord
    import json as json_mod

    shop_responses = []
    for shop in shops:
        latest_scan = (
            db.query(Scan.completed_at)
            .filter(Scan.shop_id == shop.id, Scan.status == "completed")
            .order_by(Scan.completed_at.desc())
            .first()
        )
        resp = ShopResponse.from_orm(shop)
        if latest_scan and latest_scan.completed_at:
            resp.last_scanned = latest_scan.completed_at

        # Get stats from latest scrape record
        latest_scrape = (
            db.query(ScrapeRecord)
            .filter(ScrapeRecord.shop_id == shop.id)
            .order_by(ScrapeRecord.id.desc())
            .first()
        )
        if latest_scrape:
            def count_json(val):
                if not val:
                    return 0
                try:
                    parsed = json_mod.loads(val)
                    if isinstance(parsed, list):
                        return len([x for x in parsed if x])
                    return 1 if parsed else 0
                except Exception:
                    return 1 if val else 0

            resp.scan_stats = {
                "emails": count_json(latest_scrape.emails_found),
                "phones": count_json(latest_scrape.phones_found),
                "addresses": count_json(latest_scrape.addresses_found),
                "kvk": count_json(latest_scrape.kvk_number_found),
                "btw": count_json(latest_scrape.btw_number_found),
                "iban": count_json(latest_scrape.iban_found),
                "contact": latest_scrape.has_contact_page or False,
                "privacy": latest_scrape.has_privacy_page or False,
                "terms": latest_scrape.has_terms_page or False,
                "returns": latest_scrape.has_return_policy or False,
                "is_opening_soon": latest_scrape.is_opening_soon,
                "is_maintenance": latest_scrape.is_maintenance,
                "has_delivery_time": latest_scrape.has_delivery_time,
                "has_preorder": latest_scrape.has_preorder,
                "has_whatsapp_contact": latest_scrape.has_whatsapp_contact,
                "has_suspicious_prices": latest_scrape.has_suspicious_prices,
                "detected_languages": json_mod.loads(latest_scrape.detected_languages) if latest_scrape.detected_languages else [],
            }

        # Add WHOIS summary
        from app.models.collectors import WhoisRecord, SSLRecord, TrustmarkRecord, TechRecord
        latest_whois = (
            db.query(WhoisRecord)
            .filter(WhoisRecord.shop_id == shop.id)
            .order_by(WhoisRecord.id.desc())
            .first()
        )
        if latest_whois:
            if resp.scan_stats is None:
                resp.scan_stats = {}
            resp.scan_stats["registrar"] = latest_whois.registrar or None
            resp.scan_stats["domain_age"] = latest_whois.domain_age_days
            resp.scan_stats["registration_date"] = str(latest_whois.registration_date) if latest_whois.registration_date else None

        # Add SSL summary
        latest_ssl = (
            db.query(SSLRecord)
            .filter(SSLRecord.shop_id == shop.id)
            .order_by(SSLRecord.id.desc())
            .first()
        )
        if latest_ssl:
            if resp.scan_stats is None:
                resp.scan_stats = {}
            resp.scan_stats["ssl_valid"] = latest_ssl.has_ssl or False
            resp.scan_stats["ssl_issuer"] = latest_ssl.issuer

        # Add trustmark summary
        latest_tm = (
            db.query(TrustmarkRecord)
            .filter(TrustmarkRecord.shop_id == shop.id)
            .order_by(TrustmarkRecord.id.desc())
            .first()
        )
        if latest_tm:
            if resp.scan_stats is None:
                resp.scan_stats = {}
            resp.scan_stats["trustmarks_verified"] = latest_tm.total_verified or 0
            resp.scan_stats["trustpilot_score"] = latest_tm.trustpilot_score
            resp.scan_stats["claimed_not_verified"] = latest_tm.claimed_not_verified or 0

        # Add tech summary
        latest_tech = (
            db.query(TechRecord)
            .filter(TechRecord.shop_id == shop.id)
            .order_by(TechRecord.id.desc())
            .first()
        )
        if latest_tech:
            if resp.scan_stats is None:
                resp.scan_stats = {}
            resp.scan_stats["platform"] = latest_tech.ecommerce_platform or latest_tech.cms or None

        # Add scam check summary
        from app.models.collectors import ScamCheckRecord, StatusCheckRecord
        latest_scam = (
            db.query(ScamCheckRecord)
            .filter(ScamCheckRecord.shop_id == shop.id)
            .order_by(ScamCheckRecord.id.desc())
            .first()
        )
        if latest_scam:
            if resp.scan_stats is None:
                resp.scan_stats = {}
            resp.scan_stats["scam_flagged"] = latest_scam.flagged
            resp.scan_stats["scam_hits"] = latest_scam.total_hits

        # Add latest status check
        latest_status = (
            db.query(StatusCheckRecord)
            .filter(StatusCheckRecord.shop_id == shop.id)
            .order_by(StatusCheckRecord.checked_at.desc())
            .first()
        )
        if latest_status:
            if resp.scan_stats is None:
                resp.scan_stats = {}
            resp.scan_stats["is_online"] = latest_status.is_online
            resp.scan_stats["last_status_check"] = latest_status.checked_at.isoformat() if latest_status.checked_at else None

        shop_responses.append(resp)

    return ShopListResponse(
        shops=shop_responses,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/risk-config", response_model=dict)
def get_risk_config(current_user: User = Depends(get_current_user)):
    """Geeft de scoringsregels en drempelwaarden terug."""
    from app.services.risk_score import SCORING_RULES, THRESHOLDS, MAX_SCORE
    return {
        "thresholds": THRESHOLDS,
        "max_score": MAX_SCORE,
        "rules": [
            {"key": r.key, "label": r.label, "points": r.points, "malus": r.malus, "tip": r.tip}
            for r in SCORING_RULES
        ],
    }


@router.post("/{shop_id}/recalculate-risk", response_model=dict)
def recalculate_risk(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Herbereken de risicoscore voor een shop op basis van bestaande scandata."""
    from app.services.risk_score import apply_risk_to_shop
    result = apply_risk_to_shop(shop_id, db)
    return {
        "shop_id": shop_id,
        "score": result.score,
        "risk_level": result.risk_level,
        "checks": result.checks,
        "tips": result.tips,
    }


@router.get("/{shop_id}", response_model=ShopDetailResponse)
def get_shop(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get full details of a shop including all collector results."""
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webwinkel niet gevonden",
        )
    return shop


@router.put("/{shop_id}", response_model=ShopResponse)
def update_shop(
    shop_id: int,
    shop_data: ShopUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update shop details."""
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webwinkel niet gevonden",
        )

    if shop_data.name is not None:
        shop.name = shop_data.name
    if shop_data.notes is not None:
        shop.notes = shop_data.notes

    db.commit()
    db.refresh(shop)

    return shop


@router.delete("/all", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_shops(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete all shops and all associated scan data."""
    from app.models.collectors import (
        WhoisRecord, SSLRecord, ScrapeRecord, DnsHttpRecord,
        TechRecord, TrustmarkRecord, AdTrackerRecord, KvKRecord, ScamCheckRecord, StatusCheckRecord, BagValidationRecord,
    )
    from app.models.scan import Scan

    for model in [StatusCheckRecord, BagValidationRecord, ScamCheckRecord, KvKRecord, AdTrackerRecord, TrustmarkRecord, TechRecord, DnsHttpRecord, ScrapeRecord, WhoisRecord, SSLRecord]:
        db.query(model).delete()
    db.query(Scan).delete()
    db.query(Shop).delete()
    db.commit()


@router.delete("/{shop_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shop(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a shop and all its associated data."""
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webwinkel niet gevonden",
        )

    db.delete(shop)
    db.commit()


@router.delete("/{shop_id}/scans", status_code=status.HTTP_204_NO_CONTENT)
def clear_shop_scans(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear all scan data for a shop but keep the shop itself."""
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webwinkel niet gevonden")

    from app.models.collectors import (
        WhoisRecord, SSLRecord, ScrapeRecord, DnsHttpRecord,
        TechRecord, TrustmarkRecord, AdTrackerRecord, KvKRecord, ScamCheckRecord, StatusCheckRecord, BagValidationRecord,
    )
    from app.models.scan import Scan

    for model in [StatusCheckRecord, BagValidationRecord, ScamCheckRecord, KvKRecord, AdTrackerRecord, TrustmarkRecord, TechRecord, DnsHttpRecord, ScrapeRecord, WhoisRecord, SSLRecord]:
        db.query(model).filter(model.shop_id == shop_id).delete()
    db.query(Scan).filter(Scan.shop_id == shop_id).delete()
    db.commit()


@router.post("/{shop_id}/check-status")
def check_shop_status(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Check whether a shop's website is currently online or offline."""
    import time
    import requests
    from datetime import datetime, timezone
    from app.models.collectors import StatusCheckRecord

    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webwinkel niet gevonden")

    is_online = False
    http_status_code = None
    response_time_ms = None
    error_message = None

    try:
        start = time.monotonic()
        resp = requests.head(shop.url, timeout=10, allow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
        response_time_ms = int((time.monotonic() - start) * 1000)
        http_status_code = resp.status_code
        is_online = resp.status_code < 500
    except requests.exceptions.ConnectionError:
        error_message = "Verbinding geweigerd of host onbereikbaar"
    except requests.exceptions.Timeout:
        error_message = "Verzoek verlopen (timeout)"
    except Exception as e:
        error_message = str(e)[:500]

    record = StatusCheckRecord(
        shop_id=shop_id,
        is_online=is_online,
        http_status_code=http_status_code,
        response_time_ms=response_time_ms,
        error_message=error_message,
        checked_at=datetime.now(timezone.utc),
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "is_online": is_online,
        "http_status_code": http_status_code,
        "response_time_ms": response_time_ms,
        "error_message": error_message,
        "checked_at": record.checked_at.isoformat(),
    }


@router.get("/{shop_id}/check-status/history")
def get_status_history(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the last 20 status checks for a shop."""
    from app.models.collectors import StatusCheckRecord

    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webwinkel niet gevonden")

    records = (
        db.query(StatusCheckRecord)
        .filter(StatusCheckRecord.shop_id == shop_id)
        .order_by(StatusCheckRecord.checked_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "is_online": r.is_online,
            "http_status_code": r.http_status_code,
            "response_time_ms": r.response_time_ms,
            "error_message": r.error_message,
            "checked_at": r.checked_at.isoformat() if r.checked_at else None,
        }
        for r in records
    ]


@router.get("/{shop_id}/report")
def download_report(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate and download a Word document report for a shop."""
    import json
    import subprocess
    import tempfile
    import os
    from fastapi.responses import FileResponse

    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webwinkel niet gevonden",
        )

    # Serialize shop data using the detail response schema
    from app.schemas.scan import ShopDetailResponse
    shop_data = ShopDetailResponse.from_orm(shop).dict()

    # Convert datetime objects to strings
    def serialize(obj):
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        return obj

    shop_json = json.dumps(shop_data, default=serialize)

    # Generate report using Node.js script
    report_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")
    script_path = os.path.join(report_dir, "generate_report.js")

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            ["node", script_path, tmp_path],
            input=shop_json,
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            os.unlink(tmp_path)
            raise HTTPException(
                status_code=500,
                detail="Rapport generatie mislukt: {}".format(result.stderr[:200]),
            )

        from datetime import datetime as dt
        timestamp = dt.now().strftime("%Y%m%d_%H%M%S")
        filename = "wwspeur_{}_{}.docx".format(
            shop.domain.replace(".", "_"),
            timestamp,
        )

        # background_tasks verwijdert het bestand nadat FileResponse het heeft verstuurd
        from fastapi import BackgroundTasks
        bg = BackgroundTasks()
        bg.add_task(os.unlink, tmp_path)

        return FileResponse(
            path=tmp_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=filename,
            background=bg,
        )

    except subprocess.TimeoutExpired:
        os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail="Rapport generatie timeout")


@router.get("/{shop_id}/evidence")
def download_evidence(
    shop_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Genereer bewijsdocumenten (PDF per bronpagina) voor een shop.
    Per URL waarop bevindingen zijn gedaan wordt een PDF gemaakt met
    een screenshot van de pagina en een tabel van de gevonden gegevens.
    De PDFs worden verpakt in een ZIP-bestand.
    """
    import json
    import subprocess
    import tempfile
    import os
    import zipfile
    import shutil
    from fastapi.responses import FileResponse
    from fastapi import BackgroundTasks

    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webwinkel niet gevonden",
        )

    from app.schemas.scan import ShopDetailResponse
    shop_data = ShopDetailResponse.from_orm(shop).dict()

    def serialize(obj):
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        return obj

    shop_json = json.dumps(shop_data, default=serialize)

    report_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")
    script_path = os.path.join(report_dir, "generate_evidence.js")

    evidence_dir = tempfile.mkdtemp(prefix="wwspeur_evidence_")

    try:
        result = subprocess.run(
            ["node", script_path, evidence_dir],
            input=shop_json,
            capture_output=True,
            text=True,
            timeout=300,  # Max 5 minuten (meerdere paginas)
        )

        if result.returncode != 0:
            shutil.rmtree(evidence_dir, ignore_errors=True)
            raise HTTPException(
                status_code=500,
                detail="Bewijs generatie mislukt: {}".format(result.stderr[:200]),
            )

        try:
            output = json.loads(result.stdout)
        except Exception:
            shutil.rmtree(evidence_dir, ignore_errors=True)
            raise HTTPException(status_code=500, detail="Onverwachte output van bewijs generator")

        files = output.get("files", [])
        if not files:
            shutil.rmtree(evidence_dir, ignore_errors=True)
            raise HTTPException(
                status_code=404,
                detail="Geen bronpagina's met bevindingen gevonden. Voer eerst een scan uit.",
            )

        # Pak alle PDFs in een ZIP
        from datetime import datetime as dt
        timestamp = dt.now().strftime("%Y%m%d_%H%M%S")
        zip_path = tempfile.mktemp(suffix=".zip")

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for f in files:
                for key in ("meta", "pagina"):
                    fname = f.get(key)
                    if fname:
                        pdf_path = os.path.join(evidence_dir, fname)
                        if os.path.exists(pdf_path):
                            zf.write(pdf_path, fname)

        def cleanup():
            shutil.rmtree(evidence_dir, ignore_errors=True)
            try:
                os.unlink(zip_path)
            except OSError:
                pass

        bg = BackgroundTasks()
        bg.add_task(cleanup)

        return FileResponse(
            path=zip_path,
            media_type="application/zip",
            filename="wwspeur_bewijs_{}_{}.zip".format(
                shop.domain.replace(".", "_"), timestamp
            ),
            background=bg,
        )

    except subprocess.TimeoutExpired:
        shutil.rmtree(evidence_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Bewijs generatie timeout (te veel paginas)")
    except HTTPException:
        raise
    except Exception as e:
        shutil.rmtree(evidence_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/batch-reports")
def download_batch_reports(
    shop_ids: list[int],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate reports for multiple shops and return as ZIP."""
    import json
    import subprocess
    import tempfile
    import os
    import zipfile
    from fastapi.responses import FileResponse
    from fastapi import BackgroundTasks
    from datetime import datetime as dt
    from app.schemas.scan import ShopDetailResponse

    report_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")
    script_path = os.path.join(report_dir, "generate_report.js")

    timestamp = dt.now().strftime("%Y%m%d_%H%M%S")
    zip_path = tempfile.mktemp(suffix=".zip")

    def serialize(obj):
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        return obj

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for shop_id in shop_ids[:50]:  # Max 50 reports
            shop = db.query(Shop).filter(Shop.id == shop_id).first()
            if not shop:
                continue

            try:
                shop_data = ShopDetailResponse.from_orm(shop).dict()
                shop_json = json.dumps(shop_data, default=serialize)

                with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
                    tmp_path = tmp.name

                result = subprocess.run(
                    ["node", script_path, tmp_path],
                    input=shop_json,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )

                if result.returncode == 0:
                    docx_name = "wwspeur_{}_{}.docx".format(
                        shop.domain.replace(".", "_"), timestamp
                    )
                    zf.write(tmp_path, docx_name)

                os.unlink(tmp_path)

            except Exception as e:
                continue

    bg = BackgroundTasks()
    bg.add_task(os.unlink, zip_path)

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename="wwspeur_rapporten_{}.zip".format(timestamp),
        background=bg,
    )
