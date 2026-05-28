import { NextRequest, NextResponse } from "next/server";

const MANAGER_URL = (process.env.NEXT_PUBLIC_WS_URL || "wss://api.genie.teleporthq.ai").replace("ws://", "http://").replace("wss://", "https://");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const res = await fetch(`${MANAGER_URL}/api/public/invite/${encodeURIComponent(token)}`);
    if (!res.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Manager unavailable" }, { status: 502 });
  }
}
