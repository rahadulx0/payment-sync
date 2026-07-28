<?php
// WordPress / WooCommerce snippet — register a REST route that verifies a
// payment-sync webhook. Drop into a small mu-plugin. No plugin is shipped by
// payment-sync (documented REST integration only). Requires verify.php.

require_once __DIR__ . '/verify.php';

add_action('rest_api_init', function () {
    register_rest_route('paysync/v1', '/webhook', [
        'methods'             => 'POST',
        'permission_callback' => '__return_true',
        'callback'            => 'paysync_handle_webhook',
    ]);
});

function paysync_handle_webhook(WP_REST_Request $request) {
    $secret = get_option('paysync_webhook_secret');
    $header = $request->get_header('x_paysync_signature');
    $raw    = $request->get_body(); // raw body

    if (!paysync_verify_webhook($secret, (string) $header, (string) $raw)) {
        return new WP_REST_Response(['error' => 'invalid_signature'], 401);
    }

    $event = json_decode($raw, true);
    if ($event['event_type'] === 'payment.verified') {
        $order = wc_get_order($event['data']['order_id']);
        if ($order && !$order->is_paid()) {
            $order->payment_complete($event['data']['transaction_id']);
        }
    }
    return new WP_REST_Response(['ok' => true], 200);
}
