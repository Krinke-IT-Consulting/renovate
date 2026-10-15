import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Jobs - Krinke-IT - Update Zentrale" };

export default function Page() {
  return (
    <>
      <PageHeader title="Jobs" description="Renovate-Läufe mit Auslöser, Status und Log-Auszug." />
      <EmptyState title="Noch kein Lauf">
        <p>Der erste Abgleich mit Renovate CE ist noch nicht gelaufen. Danach erscheinen hier die Läufe aller Repos.</p>
      </EmptyState>
    </>
  );
}
