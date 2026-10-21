import { AutoOnboarding } from "@/components/repos/auto-onboarding";
import { FilterBar, FilterChips, type ChipOption } from "@/components/data/filter-chips";
import { SearchBox } from "@/components/data/search-box";
import { RepoTable } from "@/components/repos/repo-table";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { getDb } from "@/db/client";
import type { OnboardingStatus } from "@/domain/repo-status";
import { ONBOARDING_LABEL, type StatusTone } from "@/domain/status-tone";
import { parseFlag, parseList, parseText, withParams, type RawSearchParams } from "@/lib/search-params";
import { summarizeRepos } from "@/lib/repo-list";
import { listOwnerSettings } from "@/queries/connections";
import { listRepoOwners, listRepos } from "@/queries/repos";

export const dynamic = "force-dynamic";

export const metadata = { title: "Repos - Krinke-IT - Update Zentrale" };

const PATHNAME = "/repos";

/** Töne, nach denen gefiltert werden kann ("neutral" gilt als Entfernt/Archiviert/Deaktiviert und hat keinen Chip). */
const STATUS_TONES = ["fehler", "warnung", "laeuft", "erfolg"] as const satisfies readonly StatusTone[];
const STATUS_LABEL: Record<(typeof STATUS_TONES)[number], string> = {
  fehler: "Fehler",
  warnung: "Warnung",
  laeuft: "Läuft",
  erfolg: "In Ordnung",
};

/** Reihenfolge der Onboarding-Chips: erst die, die Handlung brauchen. */
const ONBOARDING_ORDER: readonly OnboardingStatus[] = ["none", "pr_open", "onboarded", "disabled"];

const FLAG_FILTERS = ["problem", "eigene-ci", "entfernt"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const db = getDb();

  const allOwners = await listRepoOwners(db);
  const owners = parseList(sp, "owner", allOwners);
  const tones = parseList(sp, "status", STATUS_TONES);
  const onboarding = parseList(sp, "onboarding", ONBOARDING_ORDER);
  const problem = parseFlag(sp, "problem");
  const ownCi = parseFlag(sp, "eigene-ci");
  const removed = parseFlag(sp, "entfernt");
  const q = parseText(sp, "q");
  const filtered =
    owners.length > 0 || tones.length > 0 || onboarding.length > 0 || problem || ownCi || removed || q !== undefined;
  const resetHref = withParams(PATHNAME, sp, {
    owner: undefined,
    status: undefined,
    onboarding: undefined,
    ...Object.fromEntries(FLAG_FILTERS.map((k) => [k, undefined])),
    q: undefined,
    sort: undefined,
    dir: undefined,
  });

  const ownerSettings = await listOwnerSettings(db);
  const rows = await listRepos(db, {
    owners,
    tones,
    onboarding,
    problem: problem || undefined,
    ownCi: ownCi || undefined,
    removed: removed || undefined,
    q,
  });

  const ownerOptions: ChipOption<string>[] = allOwners.map((value) => ({ value, label: value }));
  const statusOptions: ChipOption<(typeof STATUS_TONES)[number]>[] = STATUS_TONES.map((value) => ({
    value,
    label: STATUS_LABEL[value],
  }));
  const onboardingOptions: ChipOption<OnboardingStatus>[] = ONBOARDING_ORDER.map((value) => ({
    value,
    label: ONBOARDING_LABEL[value],
  }));
  const flag = (label: string) => [{ value: "1", label }];

  return (
    <>
      <PageHeader title="Repos" description={summarizeRepos(rows, filtered)} />

      {!filtered && rows.length === 0 ? (
        <EmptyState title="Noch keine Repos">
          <p>
            Der erste Abgleich mit GitHub ist noch nicht gelaufen. Sobald er abgeschlossen ist, erscheinen hier alle
            Repos, in denen die GitHub App installiert ist.
          </p>
        </EmptyState>
      ) : (
        <>
          <FilterBar resetHref={filtered ? resetHref : undefined}>
            {ownerOptions.length > 1 ? (
              <FilterChips label="Owner" param="owner" options={ownerOptions} selected={owners} pathname={PATHNAME} searchParams={sp} />
            ) : null}
            <FilterChips label="Status" param="status" options={statusOptions} selected={tones} pathname={PATHNAME} searchParams={sp} />
            <FilterChips
              label="Onboarding"
              param="onboarding"
              options={onboardingOptions}
              selected={onboarding}
              pathname={PATHNAME}
              searchParams={sp}
            />
            <FilterChips
              label="Problem"
              param="problem"
              options={flag("Problem vorhanden")}
              selected={problem ? ["1"] : []}
              pathname={PATHNAME}
              searchParams={sp}
            />
            <FilterChips
              label="CI"
              param="eigene-ci"
              options={flag("Eigene CI")}
              selected={ownCi ? ["1"] : []}
              pathname={PATHNAME}
              searchParams={sp}
            />
            <FilterChips
              label="Bestand"
              param="entfernt"
              options={flag("Entfernte zeigen")}
              selected={removed ? ["1"] : []}
              pathname={PATHNAME}
              searchParams={sp}
            />
            <SearchBox label="Repos durchsuchen" placeholder="Repo suchen" />
          </FilterBar>

          {rows.length === 0 ? (
            <EmptyState title="Keine Treffer für diese Filter." action={{ href: resetHref, label: "Filter zurücksetzen" }}>
              <p>Mit den gewählten Filtern passt kein Repo.</p>
            </EmptyState>
          ) : (
            <RepoTable rows={rows} now={new Date()} />
          )}
        </>
      )}

      <AutoOnboarding owners={ownerSettings} />
    </>
  );
}
