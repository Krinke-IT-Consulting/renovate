import Link from "next/link";
import { FilterBar, FilterChips, type ChipOption } from "@/components/data/filter-chips";
import { ProblemGroups } from "@/components/problems/problem-groups";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { getDb } from "@/db/client";
import type { ProblemKind } from "@/domain/problems";
import { PROBLEM_KIND_LABEL, PROBLEM_KIND_ORDER } from "@/domain/status-tone";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";
import { parseList, parseOne, withParams, type RawSearchParams } from "@/lib/search-params";
import { listJobRepos } from "@/queries/jobs";
import { RESOLVED_WINDOW_DAYS, countProblems, listProblems } from "@/queries/problems";

export const dynamic = "force-dynamic";

export const metadata = { title: "Probleme - Krinke-IT - Update Zentrale" };

const VIEWS = ["offen", "behoben"] as const;
const VIEW_LABEL = { offen: "Offen", behoben: "Behoben" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const db = getDb();

  const ansicht = parseOne(sp, "ansicht", VIEWS, "offen");
  const kinds = parseList<ProblemKind>(sp, "art", PROBLEM_KIND_ORDER);
  // Ist ein Repo in der Adresse genannt, gelten auch entfernte Repos als bekannt (kein stilles Verwerfen).
  const knownRepos = await listJobRepos(db, { includeRemoved: true });
  const repos = parseList(
    sp,
    "repo",
    knownRepos.map((r) => r.fullName),
  );

  // Die Repo-Chips bieten die Repos an, die in dieser Ansicht (mit Art-Filter) Probleme haben.
  const [inView, counts] = await Promise.all([
    listProblems(db, { state: ansicht, kinds }),
    countProblems(db, { repos, kinds, includeRemoved: repos.length > 0 }),
  ]);
  // Mit Repo-Filter gehören auch entfernte Repos dazu; die Chips oben bleiben bei den aktiven Repos.
  const problems =
    repos.length > 0 ? await listProblems(db, { state: ansicht, kinds, repos, includeRemoved: true }) : inView;

  const repoNames = [...new Set([...inView.map((p) => p.repoFullName), ...repos])].sort();
  const repoOptions: ChipOption<string>[] = repoNames.map((value) => ({ value, label: value }));
  const kindOptions: ChipOption<ProblemKind>[] = PROBLEM_KIND_ORDER.map((value) => ({
    value,
    label: PROBLEM_KIND_LABEL[value],
  }));

  const filtered = repos.length > 0 || kinds.length > 0;
  const resetHref = withParams("/probleme", sp, { repo: undefined, art: undefined, alle: undefined });
  const viewHref = (v: (typeof VIEWS)[number]) => withParams("/probleme", sp, { ansicht: v === "offen" ? undefined : v, alle: undefined });

  const description =
    ansicht === "offen"
      ? problems.length === 0
        ? "Aktuell ist nichts offen."
        : `${plural(problems.length, "offenes Problem", "offene Probleme")}, nach Art gruppiert.`
      : `${plural(problems.length, "behobenes Problem", "behobene Probleme")} der letzten ${RESOLVED_WINDOW_DAYS} Tage.`;

  return (
    <>
      <PageHeader title="Probleme" description={description} />

      <nav aria-label="Ansicht" className="mb-4">
        <ul className="inline-flex max-w-full flex-wrap rounded-full bg-papier p-1 ring-1 ring-rheinblau-tief/20 ring-inset">
          {VIEWS.map((v) => {
            const active = ansicht === v;
            return (
              <li key={v}>
                <Link
                  href={viewHref(v)}
                  replace
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-medium",
                    active ? "bg-rheinblau text-papier" : "text-ink hover:text-rheinblau",
                  )}
                >
                  {VIEW_LABEL[v]}
                  <span className={cn("tabular-nums", active ? "text-papier/80" : "text-ink-soft")}>{counts[v]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <FilterBar resetHref={filtered ? resetHref : undefined}>
        <FilterChips label="Art" param="art" options={kindOptions} selected={kinds} pathname="/probleme" searchParams={sp} />
        {repoOptions.length > 0 ? (
          <FilterChips label="Repo" param="repo" options={repoOptions} selected={repos} pathname="/probleme" searchParams={sp} />
        ) : null}
      </FilterBar>

      {problems.length > 0 ? (
        <ProblemGroups problems={problems} state={ansicht} pathname="/probleme" searchParams={sp} />
      ) : filtered ? (
        <EmptyState title="Keine Treffer für diese Filter." action={{ href: resetHref, label: "Filter zurücksetzen" }}>
          <p>Mit den gewählten Filtern gibt es in dieser Ansicht kein Problem.</p>
        </EmptyState>
      ) : ansicht === "offen" ? (
        <EmptyState title="Keine offenen Probleme." action={{ href: viewHref("behoben"), label: "Behobene ansehen" }}>
          <p>Alle Repos laufen ohne Beanstandung. Neue Probleme erscheinen hier nach dem nächsten Abgleich.</p>
        </EmptyState>
      ) : (
        <EmptyState title="Keine behobenen Probleme." action={{ href: viewHref("offen"), label: "Offene ansehen" }}>
          <p>In den letzten {RESOLVED_WINDOW_DAYS} Tagen wurde kein Problem behoben.</p>
        </EmptyState>
      )}
    </>
  );
}
