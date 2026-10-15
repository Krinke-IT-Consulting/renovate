import Link from "next/link";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Seite nicht gefunden" />
      <EmptyState title="Diese Seite gibt es nicht">
        <p>
          <Link href="/" className="font-medium text-olive underline underline-offset-4">
            Zurück zur Übersicht
          </Link>
        </p>
      </EmptyState>
    </>
  );
}
