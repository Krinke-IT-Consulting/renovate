import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "./globals.css";
import { SiteHeader } from "@/components/shell/site-header";
import { APP_NAME } from "@/components/shell/nav-items";
import { AutoRefresh } from "@/components/shell/auto-refresh";
import { getDb } from "@/db/client";
import { loadSyncStamp, type SyncSourceState } from "@/queries/sync";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Zustand aller Repositories und Renovate-Läufe an einer Stelle.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Der Nutzer kommt ausschliesslich aus x-dashboard-user, das proxy.ts aus der Authelia-Antwort setzt.
  const account = (await headers()).get("x-dashboard-user")?.trim().slice(0, 64) || null;
  // Ohne Datenbank bleibt die Shell bedienbar; der Stempel meldet den Ausfall.
  let sync: SyncSourceState[] | null;
  try {
    sync = await loadSyncStamp(getDb());
  } catch {
    sync = null;
  }

  return (
    <html lang="de">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-papier focus:px-4 focus:py-3 focus:font-medium focus:text-rheinblau focus:shadow-md"
        >
          Zum Inhalt springen
        </a>
        <SiteHeader account={account} sync={sync} />
        <AutoRefresh />
        <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 outline-none sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
