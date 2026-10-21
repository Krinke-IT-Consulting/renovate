import { redirect } from "next/navigation";
import { triggerAllRuns } from "@/actions/jobs";
import { ConfirmAction } from "@/components/actions/confirm-action";
import { FilterBar, FilterChips, type ChipOption } from "@/components/data/filter-chips";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { JobTable } from "@/components/jobs/job-table";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { getDb } from "@/db/client";
import { JOB_STATUS_LABEL, type JobStatus } from "@/domain/status-tone";
import { plural } from "@/lib/format";
import { parseList, parsePage, parseSort, parseText, withParams, type RawSearchParams } from "@/lib/search-params";
import { countRunnableRepos } from "@/queries/runnable-repos";
import { JOBS_PAGE_SIZE, JOB_SORT_KEYS, listJobRepos, listJobs, summarizeJobs } from "@/queries/jobs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Jobs - Krinke-IT - Update Zentrale" };

/** "Fehlgeschlagen" steht vorn als schneller Einstieg. */
const STATUS_ORDER: readonly JobStatus[] = ["failed", "running", "queued", "success"];

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const db = getDb();

  // Ist ein Repo in der Adresse genannt, gelten auch entfernte Repos als bekannt (kein stilles Verwerfen).
  const knownRepos = await listJobRepos(db, { includeRemoved: true });
  const repos = parseList(
    sp,
    "repo",
    knownRepos.map((r) => r.fullName),
  );
  const status = parseList(sp, "status", STATUS_ORDER);
  const q = parseText(sp, "q");
  const page = parsePage(sp);
  const sort = parseSort(sp, JOB_SORT_KEYS);
  // Genau ein Repo: der ganze Verlauf, wie im Repo-Detail ("Log ansehen" darf nicht ins Leere laufen).
  const singleRepo = repos.length === 1;

  const [{ rows, total }, summary, runnable] = await Promise.all([
    listJobs(db, { repos, status, q, page, sort: sort ?? undefined, includeRemoved: repos.length > 0, allTime: singleRepo }),
    summarizeJobs(db),
    countRunnableRepos(db),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / JOBS_PAGE_SIZE));
  if (page > pageCount) redirect(withParams("/jobs", sp, { seite: pageCount > 1 ? String(pageCount) : undefined }));

  const filtered = repos.length > 0 || status.length > 0 || q !== undefined;
  const resetHref = withParams("/jobs", sp, { repo: undefined, status: undefined, q: undefined });

  const statusOptions: ChipOption<JobStatus>[] = STATUS_ORDER.map((value) => ({
    value,
    label: JOB_STATUS_LABEL[value],
  }));
  const repoOptions: ChipOption<string>[] = repos.map((value) => ({ value, label: value }));

  const description = singleRepo
    ? total === 0
      ? "Für dieses Repo liegt kein Lauf vor."
      : `${plural(total, "Lauf", "Läufe")} für ${repos[0]}.`
    : summary.total === 0
      ? "In den letzten 7 Tagen gab es noch keinen Lauf."
      : `${plural(summary.total, "Lauf", "Läufe")} in den letzten 7 Tagen, davon ${summary.failed} fehlgeschlagen.`;

  return (
    <>
      <PageHeader
        title="Jobs"
        description={description}
        action={
          runnable > 0 ? (
            <ConfirmAction
              action={triggerAllRuns}
              label="Alle Repos laufen lassen"
              title="Alle Repos laufen lassen?"
              effect={`Renovate CE reiht für ${plural(runnable, "onboardetes Repo", "onboardete Repos")} je einen Lauf ein. Wartet oder läuft für ein Repo schon einer, entsteht dort kein zweiter.`}
              confirmLabel="Alle Läufe einreihen"
            />
          ) : undefined
        }
      />

      <FilterBar resetHref={filtered ? resetHref : undefined}>
        <FilterChips label="Status" param="status" options={statusOptions} selected={status} pathname="/jobs" searchParams={sp} />
        {repoOptions.length > 0 ? (
          <FilterChips label="Repo" param="repo" options={repoOptions} selected={repos} pathname="/jobs" searchParams={sp} />
        ) : null}
        <SearchBox label="Nach Repo suchen" placeholder="Repo suchen" />
      </FilterBar>

      {rows.length > 0 ? (
        <>
          <JobTable rows={rows} manualSorting />
          <Pagination page={page} pageCount={pageCount} pathname="/jobs" searchParams={sp} />
        </>
      ) : filtered && !(repos.length === 1 && status.length === 0 && q === undefined) ? (
        <EmptyState title="Keine Treffer für diese Filter." action={{ href: resetHref, label: "Filter zurücksetzen" }}>
          <p>Mit den gewählten Filtern liegt {singleRepo ? "" : "in den letzten 7 Tagen "}kein Lauf vor.</p>
        </EmptyState>
      ) : repos.length === 1 ? (
        <EmptyState title="Noch kein Lauf." action={{ href: resetHref, label: "Alle Läufe ansehen" }}>
          <p>
            Für dieses Repo liegt noch kein Lauf vor. Renovate läuft stündlich, der erste Lauf erscheint hier nach
            dem nächsten Abgleich.
          </p>
        </EmptyState>
      ) : (
        <EmptyState title="Noch kein Lauf.">
          <p>
            Renovate läuft stündlich. Sobald der erste Lauf abgeglichen ist, erscheinen hier die Läufe aller Repos.
          </p>
        </EmptyState>
      )}
    </>
  );
}
