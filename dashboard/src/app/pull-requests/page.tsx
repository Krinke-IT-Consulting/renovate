import { FilterBar, FilterChips, type ChipOption } from "@/components/data/filter-chips";
import { Pagination } from "@/components/data/pagination";
import { SearchBox } from "@/components/data/search-box";
import { PR_SORT_KEYS, sortPullRequests } from "@/components/pull-requests/pull-request-format";
import { PullRequestTable } from "@/components/pull-requests/pull-request-table";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { getDb } from "@/db/client";
import { ciStatusEnum, updateTypeEnum } from "@/db/schema";
import { CI_STATUS_LABEL, UPDATE_TYPE_LABEL } from "@/domain/status-tone";
import { plural } from "@/lib/format";
import { parseFlag, parseList, parsePage, parseSort, parseText, type RawSearchParams } from "@/lib/search-params";
import { listOpenPullRequests, listPullRequestRepos } from "@/queries/pull-requests";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pull Requests - Krinke-IT - Update Zentrale" };

const PAGE_SIZE = 50;
const PATHNAME = "/pull-requests";

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const db = getDb();

  const allRepos = await listPullRequestRepos(db);
  const repos = parseList(sp, "repo", allRepos);
  const types = parseList(sp, "typ", updateTypeEnum.enumValues);
  const ci = parseList(sp, "ci", ciStatusEnum.enumValues);
  const automerge = parseFlag(sp, "automerge");
  const q = parseText(sp, "q");
  const filtered = repos.length > 0 || types.length > 0 || ci.length > 0 || automerge || q !== undefined;

  const now = new Date();
  const found = await listOpenPullRequests(db, { repos, types, ci, automerge: automerge || undefined, q });
  // Sortierung wirkt auf alle Zeilen, nicht nur auf die Seite: erst sortieren, dann schneiden.
  const sort = parseSort(sp, PR_SORT_KEYS);
  const rows = sort ? sortPullRequests(found, sort, now) : found;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(parsePage(sp), pageCount);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const security = rows.filter((r) => r.updateType === "security").length;

  const summary =
    allRepos.length === 0
      ? "Keine offenen PRs."
      : rows.length === 0
        ? "Die Filter schließen alle offenen PRs aus."
        : `${plural(rows.length, "offener PR", "offene PRs")}${filtered ? " (gefiltert)" : ""}, davon ${security} Sicherheit`;

  const repoOptions: ChipOption<string>[] = allRepos.map((name) => ({ value: name, label: name }));
  const typeOptions: ChipOption<(typeof updateTypeEnum.enumValues)[number]>[] = updateTypeEnum.enumValues.map((v) => ({
    value: v,
    label: UPDATE_TYPE_LABEL[v],
  }));
  const ciOptions: ChipOption<(typeof ciStatusEnum.enumValues)[number]>[] = ciStatusEnum.enumValues.map((v) => ({
    value: v,
    label: CI_STATUS_LABEL[v],
  }));

  return (
    <>
      <PageHeader title="Pull Requests" description={summary} />

      {allRepos.length === 0 ? (
        <EmptyState title="Keine offenen Renovate-PRs">
          <p>Der nächste Lauf ist stündlich.</p>
        </EmptyState>
      ) : (
        <>
          <FilterBar resetHref={filtered ? PATHNAME : undefined}>
            <FilterChips label="Typ" param="typ" options={typeOptions} selected={types} pathname={PATHNAME} searchParams={sp} />
            <FilterChips label="CI" param="ci" options={ciOptions} selected={ci} pathname={PATHNAME} searchParams={sp} />
            <FilterChips
              label="Automerge"
              param="automerge"
              options={[{ value: "1", label: "Automerge" }]}
              selected={automerge ? ["1"] : []}
              pathname={PATHNAME}
              searchParams={sp}
            />
            <FilterChips label="Repo" param="repo" options={repoOptions} selected={repos} pathname={PATHNAME} searchParams={sp} />
            <SearchBox label="PRs durchsuchen" placeholder="Titel, Repo oder Paket" />
          </FilterBar>

          {rows.length === 0 ? (
            <EmptyState title="Keine Treffer für diese Filter." action={{ href: PATHNAME, label: "Filter zurücksetzen" }}>
              <p>Mit den gewählten Filtern ist kein offener Renovate-PR dabei.</p>
            </EmptyState>
          ) : (
            <>
              <PullRequestTable rows={pageRows} now={now} manualSorting />
              <Pagination page={page} pageCount={pageCount} pathname={PATHNAME} searchParams={sp} />
            </>
          )}
        </>
      )}
    </>
  );
}
