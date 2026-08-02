// k6: the realistic worst case — many phones reconnecting after an outage and
// uploading their queues at once (Task 17 §4.7b).
//   k6 run -e BASE_URL=... -e DEVICE_TOKEN=pdt_... -e INSTALL_ID=... test/load/burst.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL;
const TOKEN = __ENV.DEVICE_TOKEN;
const INSTALL = __ENV.INSTALL_ID;

export const options = {
  scenarios: {
    // 10 devices × 50-message batches, all inside one minute.
    burst: { executor: 'per-vu-iterations', vus: 10, iterations: 1, maxDuration: '1m' },
  },
  thresholds: {
    'http_req_duration{endpoint:upload}': ['p(95)<800'], // 50-message batch
    http_req_failed: ['rate<0.001'],
  },
};

function hex64(seed) {
  let s = '';
  for (let i = 0; i < 64; i++) s += '0123456789abcdef'[(seed * (i + 7) + i) % 16];
  return s;
}

export default function () {
  const messages = [];
  for (let i = 0; i < 50; i++) {
    const seed = __VU * 1000 + i + (Date.now() % 1000);
    messages.push({
      client_msg_hash: hex64(seed),
      sms_address: 'bKash',
      raw_message: `Cash In Tk 1,500.00 from 01759584276 successful. Fee Tk 0.00. Balance Tk 9,000.00. TrxID BURST${seed} at 05/01/2026 16:55`,
      device_received_at: new Date().toISOString(),
    });
  }

  const res = http.post(
    `${BASE}/api/v1/sms/upload`,
    JSON.stringify({ upload_source: 'MANUAL_SYNC', messages }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
        'X-Install-Id': INSTALL,
      },
      tags: { endpoint: 'upload' },
    },
  );
  // The batch must be accepted whole; per-message results settle client-side.
  check(res, { 'upload 202': (r) => r.status === 202 });
}
