import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
