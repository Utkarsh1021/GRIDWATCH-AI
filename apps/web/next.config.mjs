/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    const api = process.env.API_URL || 'http://localhost:3001';
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/ingest', destination: `${api}/ingest` },
      { source: '/events', destination: `${api}/events` },
      { source: '/health', destination: `${api}/health` },
    ];
  },
};

export default nextConfig;