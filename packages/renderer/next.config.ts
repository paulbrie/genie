import type { NextConfig } from "next";

console.log("[next.config] NEXT_PUBLIC_WS_URL =", process.env.NEXT_PUBLIC_WS_URL ?? "(not set)");

const nextConfig: NextConfig = {
  basePath: "",
  images: { unoptimized: true },
  transpilePackages: ["react-markdown", "remark-gfm"],
  env: {
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:9876",
  },
};

export default nextConfig;
