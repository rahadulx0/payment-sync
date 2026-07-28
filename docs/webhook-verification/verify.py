"""payment-sync webhook verifier - Python reference (stdlib only).

Verify BEFORE json.loads, over the exact raw request body::

    raw = request.get_data()  # bytes, Flask example
    ok = verify_paysync_webhook(secret, request.headers["X-PaySync-Signature"], raw)

Header: ``t=<unix>,v1=<hex>[,v0=<hex>]``, v1 = HMAC_SHA256(secret, f"{t}.{raw}").
During rotation both v1 (new) and v0 (old) are sent; accept either.
"""

import hashlib
import hmac
import time


def verify_paysync_webhook(secret, header, raw_body, prev_secret=None, tolerance=300, now=None):
    now = now if now is not None else int(time.time())
    if isinstance(raw_body, bytes):
        raw_body = raw_body.decode("utf-8")

    t = None
    sigs = []
    for part in header.split(","):
        kv = part.strip().split("=", 1)
        if len(kv) != 2:
            continue
        if kv[0] == "t":
            try:
                t = int(kv[1])
            except ValueError:
                return False
        elif kv[0] in ("v1", "v0"):
            sigs.append(kv[1])

    if t is None or not sigs:
        return False
    if abs(now - t) > tolerance:
        return False

    secrets = [secret] + ([prev_secret] if prev_secret else [])
    for s in secrets:
        expected = hmac.new(s.encode(), f"{t}.{raw_body}".encode(), hashlib.sha256).hexdigest()
        for sig in sigs:
            if hmac.compare_digest(expected, sig):
                return True
    return False
