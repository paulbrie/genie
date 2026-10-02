import type { Viewport } from "next";

// Scoped to the /mobile route only — gives the prototype a real phone viewport
// (device-width, no zoom-out) and a themed status bar, without touching the
// desktop app's rendering.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1e1e2e",
  viewportFit: "cover",
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
