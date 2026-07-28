import type { NextConfig } from 'next';

const API_ORIGIN = process.env['NEXT_PUBLIC_API_ORIGIN'] ?? 'http://localhost:3000';

// Strict CSP: no unsafe-inline scripts, connect-src limited to the API origin
// (architecture §13, Task 11 §4.2). 'unsafe-inline' for styles is required by
// Tailwind's runtime-injected critical CSS; scripts stay locked down.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${API_ORIGIN}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Types are checked via `pnpm typecheck`; ESLint via the repo config. Both run
  // outside the build, so the build itself just compiles.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
