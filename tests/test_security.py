import hmac
import hashlib
from app.core.security import verify_github_signature, verify_slack_signature, verify_appsignal_token


def test_github_signature_verification():
    secret = "test_secret_key"
    payload = b'{"action":"opened","issue":{"number":42}}'
    
    # Compute valid signature
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    valid_header = f"sha256={digest}"

    assert verify_github_signature(payload, valid_header, secret) is True
    assert verify_github_signature(payload, "sha256=invalidhash", secret) is False
    assert verify_github_signature(payload, None, secret) is False


def test_appsignal_token_verification():
    token = "appsignal_secret_token"
    assert verify_appsignal_token(token, token) is True
    assert verify_appsignal_token("wrong_token", token) is False
