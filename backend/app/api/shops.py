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

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.shop import Shop
from app.schemas.shop import ShopCreate, ShopResponse, ShopListResponse, ShopUpdate
from app.schemas.scan import ShopDetailResponse

router = APIRouter()


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

    content = await file.read()
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
            domain = extract_domain(url)

            existing = db.query(Shop).filter(Shop.url == url).first()
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
    shops = (
        query.order_by(Shop.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return ShopListResponse(
        shops=shops,
        total=total,
        page=page,
        page_size=page_size,
    )


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
            raise HTTPException(
                status_code=500,
                detail="Rapport generatie mislukt: {}".format(result.stderr[:200]),
            )

        filename = "WWSpeur_{}_{}.docx".format(
            shop.domain.replace(".", "_"),
            shop_data.get("created_at", "")[:10],
        )

        return FileResponse(
            path=tmp_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=filename,
        )

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Rapport generatie timeout")
