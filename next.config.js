/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Force HTTPS for 2 years incl. subdomains. Vercel already serves HTTPS,
  // this just tells browsers to never downgrade.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Block clickjacking — the wall should never load in an iframe.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stop MIME sniffing.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak full URLs (esp. /note/[id]) to external links.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable browser features we never use.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  },
  // Cross-origin policies — keep the page safely isolated.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
