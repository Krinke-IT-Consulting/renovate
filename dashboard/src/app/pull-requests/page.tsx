import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pull Requests - Krinke-IT - Update Zentrale" };

export default function Page() {
  return (
    <>
      <PageHeader title="Pull Requests" description="Offene Renovate-PRs über alle Repos." />
      <EmptyState title="Noch keine Pull Requests">
        <p>Der erste Abgleich mit GitHub ist noch nicht gelaufen. Danach erscheinen hier alle offenen Renovate-PRs mit CI-Status.</p>
      </EmptyState>
    </>
  );
}
