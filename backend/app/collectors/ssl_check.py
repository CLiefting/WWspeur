"""
SSL Certificate Collector

Checks SSL/TLS certificate for a domain:
- Certificate validity (expired/valid)
- Issuer (Let's Encrypt, DigiCert, etc.)
- Valid from/until dates
- Self-signed detection
- Subject Alternative Names (SAN)
- Signature algorithm
"""
import json
import ssl
import socket
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Free/cheap SSL issuers (not necessarily suspicious, but noteworthy)
FREE_SSL_ISSUERS = [
    "let's encrypt",
    "zerossl",
    "buypass",
    "ssl.com",
]


def _extract_domain(url: str) -> str:
    """Extract domain from URL."""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    domain = parsed.netloc.lower().lstrip("www.")
    return domain


def _parse_cert_date(date_str: str) -> Optional[datetime]:
    """Parse SSL certificate date string to datetime."""
    if not date_str:
        return None
    try:
        # OpenSSL format: 'Mar 15 00:00:00 2024 GMT'
        return datetime.strptime(date_str, "%b %d %H:%M:%S %Y %Z")
    except ValueError:
        try:
            return datetime.strptime(date_str, "%Y%m%d%H%M%SZ")
        except ValueError:
            logger.warning(f"Kon datum niet parsen: {date_str}")
            return None


def _extract_issuer_cn(issuer_tuples) -> Optional[str]:
    """Extract Common Name from issuer tuple structure."""
    if not issuer_tuples:
        return None
    for item in issuer_tuples:
        for key, value in item:
            if key == "commonName":
                return value
            if key == "organizationName":
                return value
    return None


def _extract_subject_cn(subject_tuples) -> Optional[str]:
    """Extract Common Name from subject tuple structure."""
    if not subject_tuples:
        return None
    for item in subject_tuples:
        for key, value in item:
            if key == "commonName":
                return value
    return None


def check_ssl(url: str, port: int = 443, timeout: int = 10) -> dict:
    """
    Check SSL certificate for the domain in the given URL.
    
    Returns a dict with certificate details.
    """
    domain = _extract_domain(url)
    logger.info(f"SSL check voor: {domain}")
    
    result = {
        "domain": domain,
        "has_ssl": False,
        "issuer": None,
        "issuer_organization": None,
        "subject": None,
        "valid_from": None,
        "valid_until": None,
        "is_expired": None,
        "is_self_signed": None,
        "certificate_version": None,
        "serial_number": None,
        "signature_algorithm": None,
        "san_domains": [],
        "is_free_ssl": None,
        "days_until_expiry": None,
        "raw_data": None,
        "error": None,
    }
    
    try:
        # Create SSL context
        context = ssl.create_default_context()
        
        # Connect and get certificate
        with socket.create_connection((domain, port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                cert = ssock.getpeercert()
                cert_binary = ssock.getpeercert(binary_form=True)
        
        if not cert:
            result["error"] = "Geen certificaat ontvangen"
            return result
        
        result["has_ssl"] = True
        
        # Issuer
        issuer = cert.get("issuer", ())
        result["issuer"] = _extract_issuer_cn(issuer)
        
        # Extract issuer organization separately
        for item in issuer:
            for key, value in item:
                if key == "organizationName":
                    result["issuer_organization"] = value
                    break
        
        # Subject
        subject = cert.get("subject", ())
        result["subject"] = _extract_subject_cn(subject)
        
        # Dates
        not_before = cert.get("notBefore")
        not_after = cert.get("notAfter")
        result["valid_from"] = _parse_cert_date(not_before)
        result["valid_until"] = _parse_cert_date(not_after)
        
        # Expiry check
        if result["valid_until"]:
            now = datetime.now(timezone.utc)
            valid_until_utc = result["valid_until"].replace(tzinfo=timezone.utc)
            result["is_expired"] = now > valid_until_utc
            result["days_until_expiry"] = (valid_until_utc - now).days
        
        # Self-signed detection
        issuer_cn = result["issuer"]
        subject_cn = result["subject"]
        if issuer_cn and subject_cn:
            result["is_self_signed"] = issuer_cn.lower() == subject_cn.lower()
        
        # Version
        result["certificate_version"] = cert.get("version")
        
        # Serial number
        result["serial_number"] = cert.get("serialNumber")
        
        # Subject Alternative Names
        san = cert.get("subjectAltName", ())
        result["san_domains"] = [value for typ, value in san if typ == "DNS"]
        
        # Signature algorithm (from cert dict if available)
        # Note: not always available in Python's ssl module
        sig_alg = cert.get("signatureAlgorithm")
        if sig_alg:
            result["signature_algorithm"] = sig_alg
        
        # Free SSL detection
        if result["issuer"]:
            issuer_lower = result["issuer"].lower()
            result["is_free_ssl"] = any(free in issuer_lower for free in FREE_SSL_ISSUERS)
        
        # Raw data for debugging
        result["raw_data"] = json.dumps({
            k: str(v) for k, v in cert.items()
        }, indent=2)
        
        logger.info(
            f"SSL voltooid voor {domain}: "
            f"issuer={result['issuer']}, "
            f"expired={result['is_expired']}, "
            f"self_signed={result['is_self_signed']}, "
            f"days_left={result['days_until_expiry']}"
        )
        
    except ssl.SSLCertVerificationError as e:
        logger.warning(f"SSL verificatie fout voor {domain}: {e}")
        result["error"] = f"Certificaat verificatie mislukt: {e}"
        result["has_ssl"] = True  # Has SSL but invalid
        result["is_expired"] = "expired" in str(e).lower()
        result["is_self_signed"] = "self-signed" in str(e).lower() or "self signed" in str(e).lower()
        
    except ssl.SSLError as e:
        logger.warning(f"SSL fout voor {domain}: {e}")
        result["error"] = f"SSL fout: {e}"
        
    except socket.timeout:
        logger.warning(f"Timeout bij SSL check voor {domain}")
        result["error"] = "Verbinding timeout"
        
    except socket.gaierror:
        logger.warning(f"DNS fout voor {domain}")
        result["error"] = "Domein niet gevonden (DNS)"
        
    except ConnectionRefusedError:
        logger.warning(f"Verbinding geweigerd voor {domain}:443")
        result["error"] = "Verbinding geweigerd op poort 443"
        result["has_ssl"] = False
        
    except Exception as e:
        logger.error(f"SSL onverwachte fout voor {domain}: {e}")
        result["error"] = str(e)
    
    return result


def save_ssl_result(
    result: dict,
    shop_id: int,
    scan_id: Optional[int],
    db_session,
):
    """Save SSL check result to the database."""
    from app.models.collectors import SSLRecord
    
    now = datetime.now(timezone.utc)
    
    record = SSLRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        has_ssl=result.get("has_ssl", False),
        issuer=result.get("issuer"),
        subject=result.get("subject"),
        valid_from=result.get("valid_from"),
        valid_until=result.get("valid_until"),
        is_expired=result.get("is_expired"),
        is_self_signed=result.get("is_self_signed"),
        certificate_version=result.get("certificate_version"),
        serial_number=result.get("serial_number"),
        signature_algorithm=result.get("signature_algorithm"),
        san_domains=json.dumps(result.get("san_domains", [])),
        source="ssl_check",
        raw_data=result.get("raw_data"),
        collected_at=now,
    )
    
    db_session.add(record)
    db_session.commit()
    return record


# ── CLI for standalone testing ──

if __name__ == "__main__":
    import sys
    
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    
    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.ssl_check <url>")
        print("Voorbeeld: python -m app.collectors.ssl_check https://bol.com")
        sys.exit(1)
    
    url = sys.argv[1]
    result = check_ssl(url)
    
    print(f"\n{'='*60}")
    print(f"SSL - {result['domain']}")
    print(f"{'='*60}")
    
    if result.get("error"):
        print(f"⚠️  Fout: {result['error']}")
    
    print(f"Heeft SSL:       {'Ja' if result['has_ssl'] else 'Nee'}")
    print(f"Issuer:          {result['issuer'] or '—'}")
    print(f"Subject:         {result['subject'] or '—'}")
    print(f"Geldig vanaf:    {result['valid_from'] or '—'}")
    print(f"Geldig tot:      {result['valid_until'] or '—'}")
    print(f"Verlopen:        {'Ja' if result['is_expired'] else 'Nee' if result['is_expired'] is not None else '—'}")
    print(f"Self-signed:     {'Ja' if result['is_self_signed'] else 'Nee' if result['is_self_signed'] is not None else '—'}")
    print(f"Gratis SSL:      {'Ja' if result['is_free_ssl'] else 'Nee' if result['is_free_ssl'] is not None else '—'}")
    print(f"Dagen tot expiry: {result['days_until_expiry'] or '—'}")
    
    if result['san_domains']:
        print(f"SAN domeinen ({len(result['san_domains'])}):")
        for d in result['san_domains'][:10]:
            print(f"  {d}")
        if len(result['san_domains']) > 10:
            print(f"  ... en {len(result['san_domains']) - 10} meer")
