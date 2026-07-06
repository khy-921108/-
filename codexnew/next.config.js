/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 작업허가 양식(.xlsx)은 런타임에 fs로 읽으므로 serverless 번들에 강제 포함
  // (import 가 아니라 readFile 이라 NFT 자동 추적 대상이 아님).
  experimental: {
    outputFileTracingIncludes: {
      '/api/work-permits/[id]/xlsx': ['./src/lib/templates/**'],
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
    ],
  },
};

module.exports = nextConfig;
