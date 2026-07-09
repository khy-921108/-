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
    // @napi-rs/canvas(네이티브 .node)를 webpack 번들 대신 node_modules에서 로드 → Vercel 런타임 로드 가능
    // (미설정 시 서버리스에서 모듈 로드 실패 → 서명 로그 fail-safe 생략됨. ③-4 버그2)
    serverComponentsExternalPackages: ['@napi-rs/canvas'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
    ],
  },
};

module.exports = nextConfig;
