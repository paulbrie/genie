import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrientationRouter } from "@/components/mobile/orientation-router";
import "./globals.css";

export const metadata: Metadata = {
  title: "Genie",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <OrientationRouter />
        <TooltipProvider delayDuration={400}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
