import type { NextConfig } from "next";

// Public host(s) this app is served under (behind nginx at
// https://<PUBLIC_HOST>/projects/genie). Because we run `next dev` on a
// different origin than the browser sees, Next 16 blocks cross-origin dev
// resource requests (RSC/flight, HMR, server actions) unless the public host is
// allowlisted — without it the client never finishes hydrating and hangs on the
// "Connecting…" splash. Read from PUBLIC_HOST (the admin runner keeps it in the
// child env); comma-separate for several.
const publicHosts = (process.env.PUBLIC_HOST ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/projects/genie",
  images: { unoptimized: true },
  transpilePackages: ["react-markdown", "remark-gfm"],
  allowedDevOrigins: publicHosts,
  experimental: {
    serverActions: {
      allowedOrigins: publicHosts,
    },
  },
  env: {
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || (process.env.NODE_ENV === "production" ? "wss://api.genie.teleporthq.ai" : "ws://localhost:9876"),
  },
};

export default nextConfig;
