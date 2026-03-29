"""
Scan progress tracking via dedicated progress column on the Scan model.
"""
import json
from datetime import datetime, timezone


def update_scan_progress(scan, db, progress_data: dict):
    """
    Update scan progress. Stored as JSON in the dedicated progress column.

    progress_data should contain:
        pages_crawled, pages_queued, max_pages, current_url,
        emails_found, phones_found, kvk_found, btw_found
    """
    progress_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    scan.progress = json.dumps(progress_data)
    db.commit()


def get_scan_progress(scan) -> dict:
    """Extract progress data from a scan record."""
    if scan.progress:
        try:
            return json.loads(scan.progress)
        except json.JSONDecodeError:
            pass

    # Backwards compatibility: old records had progress in error_message
    if scan.error_message and scan.error_message.startswith("PROGRESS:"):
        try:
            return json.loads(scan.error_message[9:])
        except json.JSONDecodeError:
            pass

    return {}
