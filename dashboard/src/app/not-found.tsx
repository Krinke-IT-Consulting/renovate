import Link from "next/link";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Seite nicht gefunden" />
      <EmptyState title="Diese Seite gibt es nicht">
        <p className="flex flex-wrap gap-x-6">
          <Link href="/" className="inline-flex min-h-11 items-center font-medium text-olive underline underline-offset-4">
            Zurück zur Übersicht
          </Link>
          <Link href="/repos" className="inline-flex min-h-11 items-center font-medium text-olive underline underline-offset-4">
            Alle Repos ansehen
          </Link>
        </p>
      </EmptyState>
    </>
  );
}
