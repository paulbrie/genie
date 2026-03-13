import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "",
  images: { unoptimized: true },
  transpilePackages: ["react-markdown", "remark-gfm"],
};

export default nextConfig;
