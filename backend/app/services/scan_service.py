"""
Scan service: orchestrates running collectors on a shop.
"""
import json
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.shop import Shop
from app.models.scan import Scan
from app.collectors.scraper import crawl_website, save_crawl_result
from app.services.progress import update_scan_progress

logger = logging.getLogger(__name__)


def run_scrape_collector(
    shop: Shop,
    scan: Scan,
    db: Session,
    max_pages: int = 200,
) -> dict:
    logger.info(f"Starting scrape collector for shop {shop.id}: {shop.url}")
    
    try:
        scan.status = "running"
        scan.started_at = datetime.now(timezone.utc)
        db.commit()

        def on_progress(progress_data):
            try:
                update_scan_progress(scan, db, progress_data)
            except Exception as e:
                logger.warning(f"Could not update progress: {e}")

        result = crawl_website(
            start_url=shop.url,
            max_pages=max_pages,
            on_progress=on_progress,
        )
        
        record = save_crawl_result(
            result=result,
            shop_id=shop.id,
            scan_id=scan.id,
            db_session=db,
        )
        
        completed = json.loads(scan.collectors_completed or "[]")
        completed.append("scrape")
        scan.collectors_completed = json.dumps(completed)
        
        requested = json.loads(scan.collectors_requested or "[]")
        if set(completed) >= set(requested):
            scan.status = "completed"
            scan.completed_at = datetime.now(timezone.utc)
        
        scan.error_message = None
        db.commit()
        
        summary = {
            "pages_crawled": result.pages_crawled,
            "pages_failed": result.pages_failed,
            "emails_found": len(result.emails),
            "phones_found": len(result.phones),
            "kvk_numbers_found": len(result.kvk_numbers),
            "btw_numbers_found": len(result.btw_numbers),
            "iban_numbers_found": len(result.iban_numbers),
            "addresses_found": len(result.addresses),
            "external_links_found": len(result.external_links),
            "social_media_found": len(result.social_media),
        }
        
        logger.info(f"Scrape collector completed for shop {shop.id}: {summary}")
        return summary
        
    except Exception as e:
        logger.error(f"Scrape collector failed for shop {shop.id}: {e}")
        scan.status = "failed"
        scan.error_message = str(e)
        scan.completed_at = datetime.now(timezone.utc)
        db.commit()
        raise
