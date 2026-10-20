import Link from "next/link";
import { withParams, type RawSearchParams } from "@/lib/search-params";

/** Blättern über Links in der Adresse (`seite`); erscheint nur bei mehr als einer Seite. */
export function Pagination({
  page,
  pageCount,
  pathname,
  searchParams,
}: {
  page: number;
  pageCount: number;
  pathname: string;
  searchParams: RawSearchParams;
}) {
  if (pageCount <= 1) return null;
  const link = (p: number) => withParams(pathname, searchParams, { seite: p > 1 ? String(p) : undefined });
  const cls =
    "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-rheinblau hover:bg-papier";
  return (
    <nav aria-label="Seiten" className="mt-4 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={link(page - 1)} className={cls}>
          Zurück
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-ink-soft tabular-nums">
        Seite {page} von {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={link(page + 1)} className={cls}>
          Weiter
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
