/**
 * @type {import('next').NextConfig}
 */
const config = {
  reactStrictMode: true,

  // Enable standalone output for Docker deployments
  output: 'standalone',

  // Image optimization: use Vercel's optimizer on Vercel, skip for self-hosted
  images: process.env.VERCEL
    ? {} // Vercel handles optimization
    : { unoptimized: true }, // Self-hosted: skip optimization

  // Enable instrumentation hook for scheduler initialization
  experimental: {
    instrumentationHook: true,
  },
};

export default config;
