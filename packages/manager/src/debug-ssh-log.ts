/** Debug-mode NDJSON logging for SSH connection investigation (session 114075). */
export function dbgSsh(
  location: string,
  message: string,
  hypothesisId: string,
  data: Record<string, unknown> = {},
): void {
  // #region agent log
  fetch("http://127.0.0.1:7268/ingest/ced5d343-d953-4369-ac9a-13e0420b30c9", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "114075" },
    body: JSON.stringify({
      sessionId: "114075",
      location,
      message,
      hypothesisId,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}
