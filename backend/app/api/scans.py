"""
Scans API endpoints: create scan, get status, list scans.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional
import json

from app.core.database import get_db, SessionLocal
from app.core.deps import get_current_user
from app.models.user import User
from app.models.shop import Shop
from app.models.scan import Scan, ScanStatus
from app.schemas.scan import ScanCreate, ScanResponse
from app.services.scan_service import run_scrape_collector, run_whois_collector, run_ssl_collector, run_dns_http_collector, run_tech_collector, run_trustmark_collector, run_ad_tracker_collector, run_kvk_collector

router = APIRouter()

VALID_COLLECTORS = {"whois", "ssl", "scrape", "kvk", "dns_http", "tech", "trustmark", "ad_tracker"}


@router.post("/", response_model=ScanResponse, status_code=status.HTTP_201_CREATED)
def create_scan(
    scan_data: ScanCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start a new scan on a shop."""
    # Validate shop exists
    shop = db.query(Shop).filter(Shop.id == scan_data.shop_id).first()
    if not shop:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webwinkel niet gevonden",
        )

    # Validate collectors
    invalid = set(scan_data.collectors) - VALID_COLLECTORS
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ongeldige collectors: {', '.join(invalid)}. "
                   f"Geldige opties: {', '.join(VALID_COLLECTORS)}",
        )

    # Create scan record
    scan = Scan(
        shop_id=scan_data.shop_id,
        user_id=current_user.id,
        status=ScanStatus.PENDING,
        collectors_requested=json.dumps(scan_data.collectors),
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Run collectors as background task
    background_tasks.add_task(
        _run_scan_background,
        scan_id=scan.id,
        shop_id=shop.id,
        collectors=scan_data.collectors,
        max_pages=scan_data.max_pages,
    )

    return scan


def _run_scan_background(scan_id: int, shop_id: int, collectors: list[str], max_pages: int = 200):
    """Background task that runs the requested collectors."""
    import logging
    from datetime import datetime, timezone
    logger = logging.getLogger(__name__)

    db = SessionLocal()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        shop = db.query(Shop).filter(Shop.id == shop_id).first()

        if not scan or not shop:
            logger.error(f"Scan {scan_id} or shop {shop_id} not found")
            return

        scan.status = "running"
        scan.started_at = datetime.now(timezone.utc)
        db.commit()

        # Run WHOIS first (fast, ~2 seconds)
        if "whois" in collectors:
            try:
                run_whois_collector(shop=shop, scan=scan, db=db)
            except Exception as e:
                logger.error(f"WHOIS collector failed: {e}")

        # Run SSL check (fast, ~2 seconds)
        if "ssl" in collectors:
            try:
                run_ssl_collector(shop=shop, scan=scan, db=db)
            except Exception as e:
                logger.error(f"SSL collector failed: {e}")

        # Run DNS/HTTP/redirect check (fast, ~3 seconds)
        if "dns_http" in collectors:
            try:
                run_dns_http_collector(shop=shop, scan=scan, db=db)
            except Exception as e:
                logger.error(f"DNS/HTTP collector failed: {e}")

        # Run technology detection (fast, ~2 seconds)
        if "tech" in collectors:
            try:
                tech_result = run_tech_collector(shop=shop, scan=scan, db=db)
            except Exception as e:
                tech_result = {}
                logger.error(f"Tech detection failed: {e}")

        # Run trustmark verification (moderate, ~10 seconds)
        if "trustmark" in collectors:
            try:
                # Pass claimed trustmarks from tech detection
                claimed = tech_result.get("trustmarks", []) if isinstance(tech_result, dict) else []
                run_trustmark_collector(shop=shop, scan=scan, db=db, claimed_trustmarks=claimed)
            except Exception as e:
                logger.error(f"Trustmark verification failed: {e}")

        # Run ad tracker detection (moderate, ~15 seconds with online search)
        if "ad_tracker" in collectors:
            try:
                run_ad_tracker_collector(shop=shop, scan=scan, db=db)
            except Exception as e:
                logger.error(f"Ad tracker detection failed: {e}")

        # Run scraper (slow, crawls pages)
        if "scrape" in collectors:
            try:
                run_scrape_collector(shop=shop, scan=scan, db=db, max_pages=max_pages)
            except Exception as e:
                logger.error(f"Scrape collector failed: {e}")

        # Run KVK lookup (after scraper, needs KVK numbers from scraped pages)
        if "kvk" in collectors:
            try:
                run_kvk_collector(shop=shop, scan=scan, db=db)
            except Exception as e:
                logger.error(f"KVK lookup failed: {e}")

        # If not already marked completed by the last collector
        if scan.status == "running":
            scan.status = "completed"
            scan.completed_at = datetime.now(timezone.utc)
            scan.error_message = None
            db.commit()

    except Exception as e:
        logger.error(f"Scan background task failed: {e}")
        try:
            scan.status = "failed"
            scan.error_message = str(e)
            db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.get("/{scan_id}", response_model=ScanResponse)
def get_scan(
    scan_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get scan status and details."""
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scan niet gevonden",
        )
    return scan


@router.get("/{scan_id}/progress")
def get_scan_progress(
    scan_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get real-time scan progress."""
    from app.services.progress import get_scan_progress as _get_progress

    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scan niet gevonden",
        )

    progress = _get_progress(scan)
    return {
        "scan_id": scan.id,
        "status": scan.status,
        "progress": progress,
    }


@router.get("/", response_model=list[ScanResponse])
def list_scans(
    shop_id: Optional[int] = None,
    scan_status: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List scans with optional filters."""
    query = db.query(Scan)

    if shop_id:
        query = query.filter(Scan.shop_id == shop_id)

    if scan_status:
        query = query.filter(Scan.status == scan_status)

    scans = (
        query.order_by(Scan.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return scans
