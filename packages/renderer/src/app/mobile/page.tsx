import { MobileApp } from "@/components/mobile/mobile-app";

// Static prototype of the Genie mobile experience. Self-contained: renders
// entirely from mock data (no WebSocket / auth / store), so it runs standalone
// in a phone browser at /mobile. See components/mobile/mock-data.ts.
export default function MobilePage() {
  return <MobileApp />;
}
