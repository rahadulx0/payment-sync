// Types for the JS reference verifier (so the API test suite can execute it).
export function verifyPaySyncWebhook(input: {
  secret: string;
  prevSecret?: string;
  header: string;
  rawBody: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): boolean;
