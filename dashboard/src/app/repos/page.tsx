import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const dynamic = "force-dynamic";

export const metadata = { title: "Repos - Krinke-IT - Update Zentrale" };

export default function Page() {
  return (
    <>
      <PageHeader title="Repos" description="Alle angebundenen Repositories mit Onboarding-Status und Build-Check." />
      <EmptyState title="Noch keine Repos">
        <p>Der erste Abgleich mit GitHub ist noch nicht gelaufen. Sobald er abgeschlossen ist, erscheinen hier alle Repos, in denen die GitHub App installiert ist.</p>
      </EmptyState>
    </>
  );
}
