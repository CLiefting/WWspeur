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
from app.services.scan_service import run_scrape_collector

router = APIRouter()

VALID_COLLECTORS = {"whois", "ssl", "scrape", "kvk"}


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
    )

    return scan


def _run_scan_background(scan_id: int, shop_id: int, collectors: list[str]):
    """Background task that runs the requested collectors."""
    import logging
    logger = logging.getLogger(__name__)

    # Create a new DB session for the background task
    db = SessionLocal()
    try:
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        shop = db.query(Shop).filter(Shop.id == shop_id).first()

        if not scan or not shop:
            logger.error(f"Scan {scan_id} or shop {shop_id} not found")
            return

        if "scrape" in collectors:
            try:
                run_scrape_collector(shop=shop, scan=scan, db=db)
            except Exception as e:
                logger.error(f"Scrape collector failed: {e}")

        # TODO: Add other collectors here as they are built
        # if "whois" in collectors:
        #     run_whois_collector(shop=shop, scan=scan, db=db)
        # if "ssl" in collectors:
        #     run_ssl_collector(shop=shop, scan=scan, db=db)
        # if "kvk" in collectors:
        #     run_kvk_collector(shop=shop, scan=scan, db=db)

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
