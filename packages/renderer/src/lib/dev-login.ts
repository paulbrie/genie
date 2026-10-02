/** Dev-only: `/?login=user@example.com` → manager /test-login → `/?token=…`. */
export function tryDevLoginRedirect(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "production") return false;

  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return false;

  const params = new URLSearchParams(window.location.search);
  const email = params.get("login");
  if (!email?.includes("@")) return false;
  // OAuth / test-login callback — don't loop.
  if (params.get("token")) return false;

  params.delete("login");
  const redirectPath =
    window.location.pathname +
    (params.toString() ? `?${params.toString()}` : "") +
    window.location.hash;

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:9876";
  const httpBase = wsUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
  const url =
    `${httpBase}/test-login?email=${encodeURIComponent(email)}` +
    `&redirect=${encodeURIComponent(redirectPath || "/")}`;

  window.location.replace(url);
  return true;
}
