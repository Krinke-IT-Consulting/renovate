import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Probleme - Krinke-IT - Update Zentrale" };

export default function Page() {
  return (
    <>
      <PageHeader title="Probleme" description="Konfigurationsfehler, fehlgeschlagene Läufe, hängende PRs und rote Builds." />
      <EmptyState title="Noch keine Probleme erfasst">
        <p>Probleme werden aus den abgeglichenen Daten abgeleitet. Der erste Abgleich ist noch nicht gelaufen.</p>
      </EmptyState>
    </>
  );
}
