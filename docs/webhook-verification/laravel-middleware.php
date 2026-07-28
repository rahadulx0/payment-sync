<?php
// Laravel middleware snippet — verify a payment-sync webhook. Register on the
// route that receives callbacks. Requires verify.php (paysync_verify_webhook).
//
//   Route::post('/paysync/webhook', WebhookController::class)
//        ->middleware(VerifyPaySyncSignature::class);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

require_once __DIR__ . '/verify.php';

class VerifyPaySyncSignature
{
    public function handle(Request $request, Closure $next)
    {
        $secret     = config('services.paysync.webhook_secret');
        $prevSecret = config('services.paysync.webhook_secret_prev'); // set during rotation
        $header     = $request->header('X-PaySync-Signature', '');
        $raw        = $request->getContent(); // raw body, not the parsed input

        if (!paysync_verify_webhook($secret, $header, $raw, $prevSecret)) {
            abort(401, 'Invalid signature');
        }

        // Idempotency: skip an event id you have already handled.
        $eventId = $request->header('X-PaySync-Event-Id');
        if (\App\Models\ProcessedWebhook::where('event_id', $eventId)->exists()) {
            return response()->json(['ok' => true]); // already processed
        }

        return $next($request);
    }
}
