import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // deploy trigger
  basePath: "",
  images: { unoptimized: true },
  transpilePackages: ["react-markdown", "remark-gfm"],
  env: {
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || (process.env.NODE_ENV === "production" ? "wss://api.genie.teleporthq.ai" : "ws://localhost:9876"),
  },
};

export default nextConfig;
