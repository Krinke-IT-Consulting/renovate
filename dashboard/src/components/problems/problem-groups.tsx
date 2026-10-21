import Link from "next/link";
import { ExternalLink } from "@/components/data/external-link";
import { StatusIcon } from "@/components/status/status";
import { PROBLEM_KIND_LABEL, PROBLEM_KIND_ORDER, PROBLEM_KIND_TONE } from "@/domain/status-tone";
import type { ProblemKind } from "@/domain/problems";
import { formatDate, formatDateTime } from "@/lib/format";
import { parseList, withParams, type RawSearchParams } from "@/lib/search-params";
import { repoDetailHref } from "@/lib/repo-detail-href";
import type { ProblemRow } from "@/queries/problems";

/** So viele Einträge je Gruppe sind zunächst sichtbar. */
export const PROBLEM_GROUP_VISIBLE = 10;

const LINK = "inline-flex min-h-11 items-center font-medium text-rheinblau underline-offset-4 hover:underline";

function ProblemEntry({ problem, showRepo, state }: { problem: ProblemRow; showRepo: boolean; state: "offen" | "behoben" }) {
  const resolved = state === "behoben" && problem.resolvedAt;
  const since = resolved ? problem.resolvedAt! : problem.firstSeenAt;
  const { evidence } = problem;
  return (
    <li className="flex flex-col gap-x-5 px-4 py-1 md:flex-row md:items-center">
      {showRepo ? (
        <Link href={repoDetailHref(problem.repoFullName)} className={`${LINK} md:w-64 md:shrink-0 [overflow-wrap:anywhere]`}>
          {problem.repoFullName}
        </Link>
      ) : null}
      <p className="min-w-0 flex-1 py-1 text-sm md:py-2">{problem.message}</p>
      <p className="py-0.5 text-sm whitespace-nowrap text-ink-soft tabular-nums md:w-40 md:py-0">
        <time dateTime={since.toISOString()} title={formatDateTime(since)}>
          {resolved ? "behoben am " : "seit "}
          {formatDate(since)}
        </time>
      </p>
      <p className="md:w-36 md:shrink-0">
        {evidence.external ? (
          <ExternalLink href={evidence.href} className="min-h-11 text-sm">
            {evidence.label}
          </ExternalLink>
        ) : (
          <Link href={evidence.href} className={`${LINK} text-sm`}>
            {evidence.label}
          </Link>
        )}
      </p>
    </li>
  );
}

/**
 * Probleme nach Art gruppiert (Reihenfolge `PROBLEM_KIND_ORDER`), je Gruppe die ersten 10.
 * "weitere X anzeigen" ist ein Link mit `?alle=<art>` und kommt ohne Client-JS aus. Auch für das
 * Repo-Detail gedacht (`showRepo={false}`, `pathname` = Adresse der Seite).
 */
export function ProblemGroups({
  problems,
  state,
  pathname,
  searchParams,
  showRepo = true,
  headingLevel = 2,
}: {
  problems: ProblemRow[];
  state: "offen" | "behoben";
  pathname: string;
  searchParams: RawSearchParams;
  showRepo?: boolean;
  /** 3, wenn die Gruppen unter einer Abschnittsüberschrift stehen (Repo-Detail). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const expandedKinds = parseList<ProblemKind>(searchParams, "alle", PROBLEM_KIND_ORDER);
  const groups = PROBLEM_KIND_ORDER.map((kind) => ({ kind, items: problems.filter((p) => p.kind === kind) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="space-y-8">
      {groups.map(({ kind, items }) => {
        const expanded = expandedKinds.includes(kind);
        const visible = expanded ? items : items.slice(0, PROBLEM_GROUP_VISIBLE);
        const hidden = items.length - visible.length;
        const headingId = `problem-gruppe-${kind}`;
        return (
          <section key={kind} aria-labelledby={headingId}>
            <Heading id={headingId} className={headingLevel === 3 ? "mb-2 flex flex-wrap items-center gap-x-2 text-base font-semibold [overflow-wrap:anywhere]" : "mb-2 flex flex-wrap items-center gap-x-2 text-lg font-semibold [overflow-wrap:anywhere]"}>
              <StatusIcon tone={PROBLEM_KIND_TONE[kind]} className="size-5" />
              {PROBLEM_KIND_LABEL[kind]}
              <span className="font-sans text-base font-medium text-ink-soft tabular-nums">
                <span className="sr-only">Anzahl: </span>
                {items.length}
              </span>
            </Heading>
            <div className="overflow-hidden rounded-xl bg-papier shadow-karte">
              <ul className="divide-y divide-border/70 py-1">
                {visible.map((p) => (
                  <ProblemEntry key={p.id} problem={p} showRepo={showRepo} state={state} />
                ))}
              </ul>
              {hidden > 0 || (expanded && items.length > PROBLEM_GROUP_VISIBLE) ? (
                <div className="border-t border-border/70 px-4">
                  <Link
                    href={withParams(pathname, searchParams, {
                      alle: expanded ? expandedKinds.filter((k) => k !== kind) : [...expandedKinds, kind],
                    })}
                    scroll={false}
                    replace
                    className={`${LINK} text-sm`}
                  >
                    {expanded ? "Weniger anzeigen" : `weitere ${hidden} anzeigen`}
                    <span className="sr-only"> ({PROBLEM_KIND_LABEL[kind]})</span>
                  </Link>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
