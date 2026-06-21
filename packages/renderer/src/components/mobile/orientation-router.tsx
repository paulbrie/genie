"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Orientation-driven routing for the mobile prototype:
//   • portrait  → send the user to /mobile (the touch experience)
//   • landscape → if they're on /mobile, send them back to the desktop app
// Mounted once in the root layout so it governs both the desktop shell and
// /mobile. Guards against redundant navigations so it can't loop.
export function OrientationRouter() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");

    const apply = () => {
      const onMobile = pathname === "/mobile" || pathname.startsWith("/mobile/");
      if (mq.matches && !onMobile) {
        router.replace("/mobile");
      } else if (!mq.matches && onMobile) {
        router.replace("/");
      }
    };

    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pathname, router]);

  return null;
}
