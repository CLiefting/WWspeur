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
from app.collectors.whois_lookup import lookup_whois, save_whois_result
from app.collectors.ssl_check import check_ssl, save_ssl_result
from app.collectors.dns_http import check_dns_http_redirects, save_dns_http_result
from app.collectors.tech_detect import detect_technologies, save_tech_result
from app.collectors.trustmark_verify import verify_all_trustmarks, save_trustmark_result
from app.collectors.ad_tracker import detect_ad_trackers, save_ad_tracker_result
from app.services.progress import update_scan_progress

logger = logging.getLogger(__name__)


def _mark_collector_done(scan, collector_name, db):
    """Mark a collector as completed on the scan."""
    completed = json.loads(scan.collectors_completed or "[]")
    completed.append(collector_name)
    scan.collectors_completed = json.dumps(completed)

    requested = json.loads(scan.collectors_requested or "[]")
    if set(completed) >= set(requested):
        scan.status = "completed"
        scan.completed_at = datetime.now(timezone.utc)
        scan.error_message = None
    db.commit()


def run_whois_collector(shop: Shop, scan: Scan, db: Session) -> dict:
    """Run the WHOIS collector on a shop."""
    logger.info(f"Starting WHOIS collector for shop {shop.id}: {shop.url}")

    try:
        update_scan_progress(scan, db, {
            "collector": "whois",
            "status": "WHOIS lookup uitvoeren...",
        })

        result = lookup_whois(shop.url)
        save_whois_result(result, shop.id, scan.id, db)
        _mark_collector_done(scan, "whois", db)

        logger.info(f"WHOIS collector completed for shop {shop.id}")
        return result

    except Exception as e:
        logger.error(f"WHOIS collector failed for shop {shop.id}: {e}")
        return {"error": str(e)}


def run_ssl_collector(shop: Shop, scan: Scan, db: Session) -> dict:
    """Run the SSL collector on a shop."""
    logger.info(f"Starting SSL collector for shop {shop.id}: {shop.url}")

    try:
        update_scan_progress(scan, db, {
            "collector": "ssl",
            "status": "SSL certificaat controleren...",
        })

        result = check_ssl(shop.url)
        save_ssl_result(result, shop.id, scan.id, db)
        _mark_collector_done(scan, "ssl", db)

        logger.info(f"SSL collector completed for shop {shop.id}")
        return result

    except Exception as e:
        logger.error(f"SSL collector failed for shop {shop.id}: {e}")
        return {"error": str(e)}


def run_dns_http_collector(shop: Shop, scan: Scan, db: Session) -> dict:
    """Run the DNS/HTTP/redirect collector on a shop."""
    logger.info(f"Starting DNS/HTTP collector for shop {shop.id}: {shop.url}")

    try:
        update_scan_progress(scan, db, {
            "collector": "dns_http",
            "status": "DNS records en HTTP headers controleren...",
        })

        result = check_dns_http_redirects(shop.url)
        save_dns_http_result(result, shop.id, scan.id, db)
        _mark_collector_done(scan, "dns_http", db)

        logger.info(f"DNS/HTTP collector completed for shop {shop.id}")
        return result

    except Exception as e:
        logger.error(f"DNS/HTTP collector failed for shop {shop.id}: {e}")
        return {"error": str(e)}


def run_tech_collector(shop: Shop, scan: Scan, db: Session) -> dict:
    """Run the technology detection collector."""
    logger.info(f"Starting tech detection for shop {shop.id}: {shop.url}")

    try:
        update_scan_progress(scan, db, {
            "collector": "tech",
            "status": "Technologieen detecteren...",
        })

        result = detect_technologies(shop.url)
        save_tech_result(result, shop.id, scan.id, db)
        _mark_collector_done(scan, "tech", db)

        logger.info(f"Tech detection completed for shop {shop.id}")
        return result

    except Exception as e:
        logger.error(f"Tech detection failed for shop {shop.id}: {e}")
        return {"error": str(e)}


def run_trustmark_collector(shop: Shop, scan: Scan, db: Session, claimed_trustmarks=None) -> dict:
    """Run the trustmark verification collector."""
    logger.info(f"Starting trustmark verification for shop {shop.id}: {shop.url}")

    try:
        update_scan_progress(scan, db, {
            "collector": "trustmark",
            "status": "Keurmerken verifiëren...",
        })

        result = verify_all_trustmarks(shop.url, claimed_trustmarks)
        save_trustmark_result(result, shop.id, scan.id, db)
        _mark_collector_done(scan, "trustmark", db)

        logger.info(f"Trustmark verification completed for shop {shop.id}")
        return result

    except Exception as e:
        logger.error(f"Trustmark verification failed for shop {shop.id}: {e}")
        return {"error": str(e)}


def run_ad_tracker_collector(shop: Shop, scan: Scan, db: Session) -> dict:
    """Run the ad tracker detection collector."""
    logger.info(f"Starting ad tracker detection for shop {shop.id}: {shop.url}")

    try:
        update_scan_progress(scan, db, {
            "collector": "ad_tracker",
            "status": "Advertentie trackers detecteren...",
        })

        result = detect_ad_trackers(shop.url, search_online=True)
        save_ad_tracker_result(result, shop.id, scan.id, db)
        _mark_collector_done(scan, "ad_tracker", db)

        logger.info(f"Ad tracker detection completed for shop {shop.id}")
        return result

    except Exception as e:
        logger.error(f"Ad tracker detection failed for shop {shop.id}: {e}")
        return {"error": str(e)}


def run_scrape_collector(
    shop: Shop, scan: Scan, db: Session, max_pages: int = 200,
) -> dict:
    """Run the HTML scraper collector on a shop."""
    logger.info(f"Starting scrape collector for shop {shop.id}: {shop.url}")

    try:
        def on_progress(progress_data):
            progress_data["collector"] = "scrape"
            try:
                update_scan_progress(scan, db, progress_data)
            except Exception as e:
                logger.warning(f"Could not update progress: {e}")

        result = crawl_website(
            start_url=shop.url,
            max_pages=max_pages,
            on_progress=on_progress,
        )

        save_crawl_result(result, shop.id, scan.id, db)
        _mark_collector_done(scan, "scrape", db)

        summary = {
            "pages_crawled": result.pages_crawled,
            "emails_found": len(result.emails),
            "phones_found": len(result.phones),
            "kvk_numbers_found": len(result.kvk_numbers),
        }
        logger.info(f"Scrape collector completed for shop {shop.id}: {summary}")
        return summary

    except Exception as e:
        logger.error(f"Scrape collector failed for shop {shop.id}: {e}")
        raise
