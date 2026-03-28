"""
DNS + HTTP Headers + Redirect Collector

Checks:
- DNS records: A, AAAA, MX, TXT (SPF/DMARC), NS, CNAME
- HTTP security headers: HSTS, CSP, X-Frame-Options, etc.
- Redirect chain analysis: how many hops, HTTP→HTTPS redirect
- Server identification
"""
import json
import socket
import logging
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 10
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Security headers to check (header name, description, is_critical)
SECURITY_HEADERS = [
    ("Strict-Transport-Security", "HSTS — forceert HTTPS", True),
    ("Content-Security-Policy", "CSP — voorkomt XSS", True),
    ("X-Frame-Options", "Clickjacking bescherming", False),
    ("X-Content-Type-Options", "MIME sniffing bescherming", False),
    ("X-XSS-Protection", "XSS filter (legacy)", False),
    ("Referrer-Policy", "Referrer info beperking", False),
    ("Permissions-Policy", "Browser feature beperking", False),
    ("Cross-Origin-Opener-Policy", "COOP — isolatie", False),
    ("Cross-Origin-Resource-Policy", "CORP — resource isolatie", False),
]


def _extract_domain(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return urlparse(url).netloc.lower().lstrip("www.")


def _lookup_ip_org(ip: str) -> str:
    """Look up the organization that owns an IP address via WHOIS."""
    try:
        import ipwhois
        obj = ipwhois.IPWhois(ip)
        result = obj.lookup_rdap(depth=0)
        org = result.get("network", {}).get("name", "")
        if not org:
            org = result.get("asn_description", "")
        return org
    except ImportError:
        # Fallback: use socket reverse DNS
        try:
            hostname = socket.getfqdn(ip)
            if hostname and hostname != ip:
                # Extract org-like info from hostname
                parts = hostname.split(".")
                if len(parts) >= 2:
                    return ".".join(parts[-2:])
            return ""
        except Exception:
            return ""
    except Exception:
        return ""


def _resolve_dns(domain: str) -> dict:
    """Resolve DNS records for a domain using socket + system resolver."""
    dns_data = {
        "a_records": [],
        "a_records_with_org": [],  # [{ip, org}]
        "aaaa_records": [],
        "mx_records": [],
        "txt_records": [],
        "ns_records": [],
        "cname_records": [],
        "has_spf": False,
        "has_dmarc": False,
        "has_mx": False,
        "spf_record": None,
        "dmarc_record": None,
        "error": None,
    }

    try:
        # Try importing dns.resolver (dnspython) for full DNS lookups
        import dns.resolver

        # A records
        try:
            answers = dns.resolver.resolve(domain, "A")
            for r in answers:
                ip = str(r)
                org = _lookup_ip_org(ip)
                dns_data["a_records"].append(ip)
                dns_data["a_records_with_org"].append({"ip": ip, "org": org})
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            pass

        # AAAA records (IPv6)
        try:
            answers = dns.resolver.resolve(domain, "AAAA")
            dns_data["aaaa_records"] = [str(r) for r in answers]
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            pass

        # MX records
        try:
            answers = dns.resolver.resolve(domain, "MX")
            dns_data["mx_records"] = [
                {"priority": r.preference, "host": str(r.exchange).rstrip(".")}
                for r in answers
            ]
            dns_data["has_mx"] = len(dns_data["mx_records"]) > 0
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            pass

        # TXT records (SPF, DMARC, etc.)
        try:
            answers = dns.resolver.resolve(domain, "TXT")
            dns_data["txt_records"] = [str(r).strip('"') for r in answers]
            for txt in dns_data["txt_records"]:
                if txt.startswith("v=spf1"):
                    dns_data["has_spf"] = True
                    dns_data["spf_record"] = txt
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            pass

        # DMARC (separate _dmarc subdomain)
        try:
            answers = dns.resolver.resolve(f"_dmarc.{domain}", "TXT")
            for r in answers:
                txt = str(r).strip('"')
                if txt.startswith("v=DMARC1"):
                    dns_data["has_dmarc"] = True
                    dns_data["dmarc_record"] = txt
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            pass

        # NS records
        try:
            answers = dns.resolver.resolve(domain, "NS")
            dns_data["ns_records"] = [str(r).rstrip(".") for r in answers]
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            pass

        # CNAME
        try:
            answers = dns.resolver.resolve(domain, "CNAME")
            dns_data["cname_records"] = [str(r).rstrip(".") for r in answers]
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN, dns.resolver.NoNameservers):
            pass

    except ImportError:
        # Fallback: basic socket resolution if dnspython not installed
        logger.warning("dnspython niet geïnstalleerd, gebruik basis DNS lookup")
        try:
            ips = socket.getaddrinfo(domain, None)
            seen = set()
            for family, _, _, _, addr in ips:
                ip = addr[0]
                if ip not in seen:
                    seen.add(ip)
                    if family == socket.AF_INET:
                        dns_data["a_records"].append(ip)
                    elif family == socket.AF_INET6:
                        dns_data["aaaa_records"].append(ip)
        except socket.gaierror as e:
            dns_data["error"] = f"DNS resolutie mislukt: {e}"

    except Exception as e:
        dns_data["error"] = str(e)

    return dns_data


def _check_http_headers(url: str) -> dict:
    """Check HTTP response headers for security and server info."""
    headers_data = {
        "status_code": None,
        "server": None,
        "powered_by": None,
        "security_headers": {},  # header_name -> value or None
        "security_score": 0,  # 0-100
        "missing_critical": [],
        "missing_optional": [],
        "present_headers": [],
        "all_headers": {},
        "cookies_secure": None,
        "cookies_httponly": None,
        "error": None,
    }

    try:
        response = requests.get(
            url,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )

        headers_data["status_code"] = response.status_code
        headers_data["server"] = response.headers.get("Server")
        headers_data["powered_by"] = response.headers.get("X-Powered-By")

        # Store all response headers
        headers_data["all_headers"] = dict(response.headers)

        # Check security headers
        present = 0
        total = len(SECURITY_HEADERS)

        for header_name, description, is_critical in SECURITY_HEADERS:
            value = response.headers.get(header_name)
            headers_data["security_headers"][header_name] = value

            if value:
                present += 1
                headers_data["present_headers"].append({
                    "name": header_name,
                    "value": value[:200],  # Truncate long values
                    "description": description,
                })
            else:
                if is_critical:
                    headers_data["missing_critical"].append({
                        "name": header_name,
                        "description": description,
                    })
                else:
                    headers_data["missing_optional"].append({
                        "name": header_name,
                        "description": description,
                    })

        # Security score based on headers present
        headers_data["security_score"] = round((present / total) * 100) if total > 0 else 0

        # Check cookies
        set_cookies = response.headers.get("Set-Cookie", "")
        if set_cookies:
            headers_data["cookies_secure"] = "Secure" in set_cookies
            headers_data["cookies_httponly"] = "HttpOnly" in set_cookies

    except requests.Timeout:
        headers_data["error"] = "Timeout"
    except requests.ConnectionError:
        headers_data["error"] = "Verbinding mislukt"
    except Exception as e:
        headers_data["error"] = str(e)

    return headers_data


def _check_redirects(url: str) -> dict:
    """Analyze the redirect chain for a URL."""
    redirect_data = {
        "original_url": url,
        "final_url": None,
        "redirect_count": 0,
        "redirect_chain": [],
        "http_to_https": False,
        "domain_changed": False,
        "original_domain": None,
        "final_domain": None,
        "error": None,
    }

    try:
        # Start with HTTP to check if it redirects to HTTPS
        http_url = url.replace("https://", "http://")
        if not http_url.startswith("http://"):
            http_url = "http://" + http_url.lstrip("https://")

        response = requests.get(
            http_url,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )

        redirect_data["final_url"] = response.url
        redirect_data["redirect_count"] = len(response.history)

        original_domain = urlparse(http_url).netloc.lower().lstrip("www.")
        final_domain = urlparse(response.url).netloc.lower().lstrip("www.")
        redirect_data["original_domain"] = original_domain
        redirect_data["final_domain"] = final_domain

        # Check if domain changed
        redirect_data["domain_changed"] = original_domain != final_domain

        # Build redirect chain
        chain = []
        for r in response.history:
            chain.append({
                "url": r.url,
                "status_code": r.status_code,
                "location": r.headers.get("Location", ""),
            })
        chain.append({
            "url": response.url,
            "status_code": response.status_code,
            "location": "(final)",
        })
        redirect_data["redirect_chain"] = chain

        # Check HTTP to HTTPS redirect
        if http_url.startswith("http://") and response.url.startswith("https://"):
            redirect_data["http_to_https"] = True

    except requests.Timeout:
        redirect_data["error"] = "Timeout"
    except requests.ConnectionError:
        redirect_data["error"] = "Verbinding mislukt"
    except Exception as e:
        redirect_data["error"] = str(e)

    return redirect_data


def check_dns_http_redirects(url: str) -> dict:
    """
    Run all DNS, HTTP header, and redirect checks.
    Returns a combined result dict.
    """
    domain = _extract_domain(url)
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    logger.info(f"DNS/HTTP/Redirect check voor: {domain}")

    dns = _resolve_dns(domain)
    headers = _check_http_headers(url)
    redirects = _check_redirects(url)

    result = {
        "domain": domain,
        "url": url,
        "dns": dns,
        "headers": headers,
        "redirects": redirects,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }

    logger.info(
        f"DNS/HTTP check voltooid voor {domain}: "
        f"A={len(dns['a_records'])}, MX={len(dns['mx_records'])}, "
        f"SPF={'Ja' if dns['has_spf'] else 'Nee'}, "
        f"security_score={headers['security_score']}%, "
        f"redirects={redirects['redirect_count']}"
    )

    return result


def save_dns_http_result(result: dict, shop_id: int, scan_id: int, db_session):
    """Save DNS/HTTP/redirect results to the scrape_records table as extended data."""
    # We store this as a JSON blob in a new dedicated table
    from app.models.collectors import DnsHttpRecord

    now = datetime.now(timezone.utc)

    record = DnsHttpRecord(
        shop_id=shop_id,
        scan_id=scan_id,
        # DNS
        a_records=json.dumps(result["dns"]["a_records_with_org"]),
        mx_records=json.dumps(result["dns"]["mx_records"]),
        txt_records=json.dumps(result["dns"]["txt_records"]),
        ns_records=json.dumps(result["dns"]["ns_records"]),
        has_spf=result["dns"]["has_spf"],
        has_dmarc=result["dns"]["has_dmarc"],
        has_mx=result["dns"]["has_mx"],
        spf_record=result["dns"]["spf_record"],
        dmarc_record=result["dns"]["dmarc_record"],
        # HTTP headers
        http_status_code=result["headers"]["status_code"],
        server_header=result["headers"]["server"],
        powered_by=result["headers"]["powered_by"],
        security_score=result["headers"]["security_score"],
        security_headers_present=json.dumps(result["headers"]["present_headers"]),
        security_headers_missing=json.dumps(
            result["headers"]["missing_critical"] + result["headers"]["missing_optional"]
        ),
        # Redirects
        redirect_count=result["redirects"]["redirect_count"],
        redirect_chain=json.dumps(result["redirects"]["redirect_chain"]),
        http_to_https=result["redirects"]["http_to_https"],
        domain_changed=result["redirects"]["domain_changed"],
        final_url=result["redirects"]["final_url"],
        # Meta
        source="dns_http_check",
        raw_data=json.dumps(result),
        collected_at=now,
    )

    db_session.add(record)
    db_session.commit()
    return record


# ── CLI ──

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if len(sys.argv) < 2:
        print("Gebruik: python -m app.collectors.dns_http <url>")
        sys.exit(1)

    url = sys.argv[1]
    result = check_dns_http_redirects(url)

    d = result["dns"]
    h = result["headers"]
    r = result["redirects"]

    print(f"\n{'='*60}")
    print(f"DNS / HTTP / Redirects — {result['domain']}")
    print(f"{'='*60}")

    print(f"\n── DNS ──")
    print(f"A records:    {', '.join(d['a_records']) or '—'}")
    if d['aaaa_records']:
        print(f"AAAA records: {', '.join(d['aaaa_records'])}")
    if d['mx_records']:
        mx_str = ', '.join("{} (pri {})".format(m.get('host',''), m.get('priority','')) for m in d['mx_records'])
        print("MX records:   " + mx_str)
    else:
        print(f"MX records:   GEEN — site kan geen e-mail ontvangen!")
    print(f"NS records:   {', '.join(d['ns_records']) or '—'}")
    print(f"SPF:          {'Ja — ' + (d['spf_record'] or '') if d['has_spf'] else 'Nee'}")
    print(f"DMARC:        {'Ja' if d['has_dmarc'] else 'Nee'}")

    print(f"\n── HTTP Headers ──")
    print(f"Status:       {h['status_code']}")
    print(f"Server:       {h['server'] or '—'}")
    if h['powered_by']:
        print(f"Powered by:   {h['powered_by']}")
    print(f"Security score: {h['security_score']}%")

    if h['present_headers']:
        print(f"Aanwezig ({len(h['present_headers'])}):")
        for hdr in h['present_headers']:
            print(f"  ✓ {hdr['name']}")
    if h['missing_critical']:
        print(f"Ontbrekend (kritiek):")
        for hdr in h['missing_critical']:
            print(f"  ✗ {hdr['name']} — {hdr['description']}")
    if h['missing_optional']:
        print(f"Ontbrekend (optioneel):")
        for hdr in h['missing_optional']:
            print(f"  ○ {hdr['name']}")

    print(f"\n── Redirects ──")
    print(f"Aantal:       {r['redirect_count']}")
    print(f"HTTP→HTTPS:   {'Ja' if r['http_to_https'] else 'Nee'}")
    print(f"Domein wijzigt: {'Ja → ' + r['final_domain'] if r['domain_changed'] else 'Nee'}")
    if r['redirect_chain']:
        print(f"Keten:")
        for step in r['redirect_chain']:
            print(f"  {step['status_code']} → {step['url']}")
