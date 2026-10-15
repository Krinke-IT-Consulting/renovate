import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Übersicht"
        description="Der Lagebericht: was Ihre Entscheidung braucht, in fester Reihenfolge."
      />
      <EmptyState title="Noch kein Abgleich erfolgt">
        <p>
          Sobald der erste Abgleich mit GitHub und Renovate CE gelaufen ist, steht hier, was Ihre
          Entscheidung braucht: Sicherheitsupdates, rote Builds, fehlgeschlagene Läufe, Major-Updates,
          nicht onboardete Repos und hängende PRs.
        </p>
      </EmptyState>
    </>
  );
}
