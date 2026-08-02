// k6: steady load at 3× expected peak (architecture §16.4, Task 17 §4.7).
//   k6 run -e BASE_URL=https://staging-api.example.com -e SERVER_KEY=psk_live_... \
//          -e COMPANY_CODE=COMP-XXXX test/load/steady.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL;
const KEY = __ENV.SERVER_KEY;
const COMPANY = __ENV.COMPANY_CODE;

export const options = {
  scenarios: {
    steady: { executor: 'constant-vus', vus: 20, duration: '30m' },
  },
  thresholds: {
    // The numbers that matter to a client's checkout page.
    'http_req_duration{endpoint:register}': ['p(95)<300'],
    'http_req_duration{endpoint:poll}': ['p(95)<300'],
    http_req_failed: ['rate<0.001'], // zero 5xx in practice
  },
};

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${KEY}`,
    'X-Company-Id': COMPANY,
  };
}

export default function () {
  const orderId = `LOAD-${__VU}-${__ITER}-${Date.now()}`;
  const register = http.post(
    `${BASE}/api/v1/payments/register`,
    JSON.stringify({
      order_id: orderId,
      amount: '1500.00',
      transaction_id: `LOAD${__VU}${__ITER}`.toUpperCase().slice(0, 16),
      provider: 'BKASH',
      callback_url: 'https://receiver.example.com/hook',
    }),
    { headers: headers(), tags: { endpoint: 'register' } },
  );
  check(register, { 'register 2xx': (r) => r.status === 200 || r.status === 201 });

  const poll = http.get(`${BASE}/api/v1/payments/${orderId}`, {
    headers: headers(),
    tags: { endpoint: 'poll' },
  });
  check(poll, { 'poll 200': (r) => r.status === 200 });

  sleep(1);
}
