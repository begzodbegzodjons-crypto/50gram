import type { NextConfig } from "next";

// CF_EXPORT=1 → Cloudflare Pages uchun to'liq statik eksport
// (API'lar Worker'da: NEXT_PUBLIC_API_BASE/NEXT_PUBLIC_WS_BASE env'lari bilan)
const isCfExport = process.env.CF_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isCfExport ? "export" : "standalone",
  ...(isCfExport ? { images: { unoptimized: true } } : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
