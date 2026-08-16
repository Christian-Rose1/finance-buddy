import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  typedRoutes: true,
};

export default nextConfig;
