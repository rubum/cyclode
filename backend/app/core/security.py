import hmac
import hashlib
import time
from typing import Optional


def verify_github_signature(raw_body: bytes, signature_header: Optional[str], secret: Optional[str]) -> bool:
    """
    Verifies GitHub HMAC-SHA256 webhook signature.
    Header format: 'sha256=<hex_digest>'
    """
    if not secret:
        # If no secret is configured, allow in dev mode
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    
    expected_hash = signature_header[7:]
    computed_hash = hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(computed_hash, expected_hash)


def verify_slack_signature(
    raw_body: bytes,
    signature_header: Optional[str],
    timestamp_header: Optional[str],
    signing_secret: Optional[str]
) -> bool:
    """
    Verifies Slack v0 signature with timestamp replay protection.
    """
    if not signing_secret:
        return True
    if not signature_header or not timestamp_header:
        return False

    # Replay protection: check timestamp is within 5 minutes
    try:
        req_time = int(timestamp_header)
        if abs(time.time() - req_time) > 60 * 5:
            return False
    except ValueError:
        return False

    sig_basestring = f"v0:{timestamp_header}:{raw_body.decode('utf-8')}".encode("utf-8")
    computed_hash = "v0=" + hmac.new(
        signing_secret.encode("utf-8"),
        sig_basestring,
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(computed_hash, signature_header)


def verify_appsignal_token(token_param: Optional[str], expected_token: Optional[str]) -> bool:
    """
    Verifies AppSignal webhook authentication token.
    """
    if not expected_token:
        return True
    if not token_param:
        return False
    return hmac.compare_digest(token_param, expected_token)
