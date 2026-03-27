"""
Scan progress tracking.
Stores progress in a simple JSON field on the scan record,
so the frontend can poll for updates.
"""
import json
from datetime import datetime, timezone


def update_scan_progress(scan, db, progress_data: dict):
    """
    Update scan progress. Stores progress as JSON in error_message field
    (we'll repurpose this temporarily; in production add a proper progress column).
    
    progress_data should contain:
        pages_crawled, pages_queued, max_pages, current_url,
        emails_found, phones_found, kvk_found, btw_found
    """
    progress_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    # Store progress as JSON prefixed with "PROGRESS:" so we can distinguish
    # from actual error messages
    scan.error_message = "PROGRESS:" + json.dumps(progress_data)
    db.commit()


def get_scan_progress(scan) -> dict:
    """Extract progress data from a scan record."""
    if scan.error_message and scan.error_message.startswith("PROGRESS:"):
        try:
            return json.loads(scan.error_message[9:])
        except json.JSONDecodeError:
            pass
    return {}
