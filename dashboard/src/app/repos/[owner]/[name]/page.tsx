import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "@/components/data/external-link";
import { JobTable } from "@/components/jobs/job-table";
import { ProblemGroups } from "@/components/problems/problem-groups";
import { PullRequestTable } from "@/components/pull-requests/pull-request-table";
import { RepoSteps } from "@/components/repos/repo-steps";
import { RolloutTable } from "@/components/repos/rollout-table";
import { StatusBadge, StatusIcon, StatusText } from "@/components/status/status";
import { getDb } from "@/db/client";
import {
  BUILD_CHECK_LABEL,
  BUILD_CHECK_TONE,
  ONBOARDING_LABEL,
  ONBOARDING_TONE,
  type StatusTone,
} from "@/domain/status-tone";
import { formatDate, formatRelative } from "@/lib/format";
import { repoDetailHref } from "@/lib/repo-detail-href";
import type { RawSearchParams } from "@/lib/search-params";
import { RESOLVED_WINDOW_DAYS } from "@/queries/problems";
import { loadRepoDetail, REPO_DETAIL_JOBS, type RepoDetail } from "@/queries/repo-detail";

export const dynamic = "force-dynamic";

type Params = { owner: string; name: string };

/** Segmente der Adresse sind kodiert (`%40` usw.); ein kaputter Wert gilt als unbekanntes Repo. */
function fullNameOf({ owner, name }: Params): string | null {
  try {
    return `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const fullName = fullNameOf(await params);
  return { title: `${fullName ?? "Repo"} - Krinke-IT - Update Zentrale` };
}

const RESULT_TONE: Record<RepoDetail["lastJobResult"], StatusTone> = {
  success: "erfolg",
  failed: "fehler",
  skipped: "neutral",
  unknown: "neutral",
};

const RESULT_LABEL: Record<RepoDetail["lastJobResult"], string> = {
  success: "Erfolgreich",
  failed: "Fehlgeschlagen",
  skipped: "Übersprungen",
  unknown: "Ergebnis unbekannt",
};

function Section({
  id,
  title,
  count,
  action,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4">
        <h2 id={id} className="flex items-center gap-2 text-lg font-semibold">
          {title}
          {count !== undefined ? (
            <span className="font-sans text-base font-medium text-ink-soft tabular-nums">
              <span className="sr-only">Anzahl: </span>
              {count}
            </span>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const TEXT_LINK =
  "inline-flex min-h-11 items-center font-medium text-olive underline underline-offset-4 hover:text-rheinblau";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <dt className="flex min-h-5 items-center text-ink-soft">{label}</dt>
      <dd className="flex min-h-5 items-center">{children}</dd>
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawSearchParams>;
}) {
  const fullName = fullNameOf(await params);
  const sp = await searchParams;
  if (!fullName) notFound();

  const now = new Date();
  const repo = await loadRepoDetail(getDb(), fullName, now);
  if (!repo) notFound();

  const here = repoDetailHref(repo.fullName);
  const allRunsHref = `/jobs?${new URLSearchParams({ repo: repo.fullName }).toString()}`;
  const resolvedHref = `/probleme?${new URLSearchParams({ ansicht: "behoben", repo: repo.fullName }).toString()}`;

  return (
    <>
      <header>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-bold [overflow-wrap:anywhere] sm:text-3xl">
            <span className="font-medium text-ink-soft">{repo.owner}/</span>
            {repo.name}
          </h1>
          <StatusBadge tone={repo.health.tone}>{repo.health.label}</StatusBadge>
        </div>

        {repo.removedAt ? (
          <p className="mt-3 max-w-prose text-sm text-ink-soft">
            <StatusText tone="neutral">Entfernt</StatusText> Dieses Repo war seit dem {formatDate(repo.removedAt)} nicht
            mehr auf der Plattform erreichbar. Die letzten Daten bleiben zur Ansicht stehen.
          </p>
        ) : repo.archived ? (
          <p className="mt-3 max-w-prose text-sm text-ink-soft">
            <StatusText tone="neutral">Archiviert</StatusText> Dieses Repo ist auf der Plattform archiviert. Renovate
            erzeugt dort keine Updates.
          </p>
        ) : null}

        <p className="mt-3 flex flex-wrap items-center gap-x-6 text-sm">
          <ExternalLink href={`https://github.com/${repo.fullName}`} className="min-h-11">
            Auf GitHub öffnen
          </ExternalLink>
          {repo.dependencyDashboardUrl ? (
            <ExternalLink href={repo.dependencyDashboardUrl} className="min-h-11">
              Dependency Dashboard
            </ExternalLink>
          ) : null}
        </p>

        <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Fact label="Onboarding">
            <StatusText tone={ONBOARDING_TONE[repo.onboarding]}>{ONBOARDING_LABEL[repo.onboarding]}</StatusText>
          </Fact>
          <Fact label="Build-Check">
            <StatusText tone={BUILD_CHECK_TONE[repo.buildCheck]}>
              {repo.buildCheck === "own_ci" ? "Eigene CI" : BUILD_CHECK_LABEL[repo.buildCheck]}
            </StatusText>
          </Fact>
          <Fact label="Konfiguration">
            {repo.configPath ? (
              <span className="font-mono text-xs [overflow-wrap:anywhere]">{repo.configPath}</span>
            ) : (
              <span className="text-ink-soft">Keine gefunden</span>
            )}
          </Fact>
          <Fact label="Letzter Lauf">
            {repo.lastJobAt ? (
              <span className="inline-flex items-center gap-1.5">
                <StatusIcon tone={RESULT_TONE[repo.lastJobResult]} />
                <span className="sr-only">{RESULT_LABEL[repo.lastJobResult]}, </span>
                <time dateTime={repo.lastJobAt.toISOString()}>{formatRelative(repo.lastJobAt, now)}</time>
              </span>
            ) : (
              <span className="text-ink-soft">Kein Lauf bisher</span>
            )}
          </Fact>
        </dl>
      </header>

      <Section id="zu-tun" title="Was hier zu tun ist" count={repo.steps.length || undefined}>
        {repo.steps.length > 0 ? <RepoSteps steps={repo.steps} /> : <p className="text-ink-soft">Nichts zu tun.</p>}
      </Section>

      <Section id="prs" title="Offene PRs" count={repo.openPrs.length}>
        {repo.openPrs.length > 0 ? (
          <PullRequestTable rows={repo.openPrs} showRepo={false} now={now} />
        ) : (
          <p className="text-ink-soft">Keine offenen Renovate-PRs. Der nächste Lauf ist stündlich.</p>
        )}
      </Section>

      <Section
        id="jobs"
        title="Letzte Jobs"
        action={
          repo.jobs.length > 0 ? (
            <Link href={allRunsHref} className={TEXT_LINK}>
              Alle Läufe
            </Link>
          ) : undefined
        }
      >
        {repo.jobs.length > 0 ? (
          <>
            <JobTable rows={repo.jobs} showRepo={false} />
            {repo.jobs.length >= REPO_DETAIL_JOBS ? (
              <p className="mt-2 text-sm text-ink-soft">Gezeigt sind die letzten {REPO_DETAIL_JOBS} Läufe.</p>
            ) : null}
          </>
        ) : (
          <p className="text-ink-soft">Noch kein Lauf.</p>
        )}
      </Section>

      <Section
        id="probleme"
        title="Probleme"
        count={repo.openProblems.length}
        action={
          repo.resolvedProblems > 0 ? (
            <Link href={resolvedHref} className={TEXT_LINK}>
              {repo.resolvedProblems === 1
                ? `1 behobenes Problem der letzten ${RESOLVED_WINDOW_DAYS} Tage`
                : `${repo.resolvedProblems} behobene Probleme der letzten ${RESOLVED_WINDOW_DAYS} Tage`}
            </Link>
          ) : undefined
        }
      >
        {repo.openProblems.length > 0 ? (
          <ProblemGroups problems={repo.openProblems} state="offen" pathname={here} searchParams={sp} showRepo={false} />
        ) : (
          <p className="text-ink-soft">Keine offenen Probleme.</p>
        )}
      </Section>

      <Section id="rollouts" title="Rollout-Aktionen" count={repo.rollouts.length}>
        {repo.rollouts.length > 0 ? (
          <RolloutTable rows={repo.rollouts} />
        ) : (
          <p className="text-ink-soft">Für dieses Repo gab es noch keine Onboarding- oder Build-Check-Aktion.</p>
        )}
      </Section>
    </>
  );
}
