<?php
// payment-sync webhook verifier — PHP reference.
// Verify BEFORE json_decode, over the exact raw request body:
//
//   $raw = file_get_contents('php://input');
//   $ok  = paysync_verify_webhook($secret, $_SERVER['HTTP_X_PAYSYNC_SIGNATURE'], $raw);
//
// Header: `t=<unix>,v1=<hex>[,v0=<hex>]`, v1 = HMAC_SHA256(secret, "$t.$raw").

function paysync_verify_webhook(string $secret, string $header, string $rawBody, ?string $prevSecret = null, int $tolerance = 300, ?int $now = null): bool {
    $now = $now ?? time();
    $t = null;
    $sigs = [];
    foreach (explode(',', $header) as $part) {
        $kv = explode('=', trim($part), 2);
        if (count($kv) !== 2) continue;
        if ($kv[0] === 't') $t = (int) $kv[1];
        elseif ($kv[0] === 'v1' || $kv[0] === 'v0') $sigs[] = $kv[1];
    }
    if ($t === null || count($sigs) === 0) return false;
    if (abs($now - $t) > $tolerance) return false;

    $secrets = [$secret];
    if ($prevSecret) $secrets[] = $prevSecret;
    foreach ($secrets as $s) {
        $expected = hash_hmac('sha256', $t . '.' . $rawBody, $s);
        foreach ($sigs as $sig) {
            if (hash_equals($expected, $sig)) return true;
        }
    }
    return false;
}

// Idempotency: store X-PaySync-Event-Id and ignore an id you have already processed.
