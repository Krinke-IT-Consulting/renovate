"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type ColumnMeta } from "@/components/data/data-table";
import { StatusBadge, StatusIcon, StatusText } from "@/components/status/status";
import {
  BUILD_CHECK_LABEL,
  BUILD_CHECK_TONE,
  ONBOARDING_LABEL,
  ONBOARDING_TONE,
  TONE_RANK,
  type StatusTone,
} from "@/domain/status-tone";
import { formatRelative } from "@/lib/format";
import { repoDetailHref } from "@/lib/repo-detail-href";
import { TOUCH_TARGET } from "@/lib/touch-target";
import type { RepoRow } from "@/queries/repos";

const RESULT_TONE: Record<RepoRow["lastJobResult"], StatusTone> = {
  success: "erfolg",
  failed: "fehler",
  skipped: "neutral",
  unknown: "neutral",
};

const RESULT_LABEL: Record<RepoRow["lastJobResult"], string> = {
  success: "Erfolgreich",
  failed: "Fehlgeschlagen",
  skipped: "Übersprungen",
  unknown: "Ergebnis unbekannt",
};

function RepoLink({ row }: { row: RepoRow }) {
  return (
    <Link
      href={repoDetailHref(row.fullName)}
      className={`${TOUCH_TARGET} font-medium text-rheinblau underline decoration-rheinblau/30 underline-offset-4 [overflow-wrap:anywhere] hover:decoration-rheinblau`}
    >
      {row.fullName}
    </Link>
  );
}

/** Hinweis auf einen Teilfehler des Abgleichs, direkt unter dem Repo. */
function PartialError({ message }: { message: string }) {
  return (
    <p className="mt-0.5 text-xs text-status-warnung">
      <StatusText tone="warnung" className="text-xs">
        Abgleich unvollständig: {message}
      </StatusText>
    </p>
  );
}

function LastJob({ row, now }: { row: RepoRow; now: Date }) {
  if (!row.lastJobAt) return <span className="text-sm text-ink-soft">Noch kein Lauf</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-sm md:whitespace-nowrap">
      <StatusIcon tone={RESULT_TONE[row.lastJobResult]} />
      <span className="sr-only">{RESULT_LABEL[row.lastJobResult]}, </span>
      <time dateTime={row.lastJobAt.toISOString()}>{formatRelative(row.lastJobAt, now)}</time>
    </span>
  );
}

function Count({ value, href, tone }: { value: number; href: string; tone?: StatusTone }) {
  if (value === 0) return <span className="text-sm text-ink-soft tabular-nums">0</span>;
  return (
    <Link
      href={href}
      className={`${TOUCH_TARGET} inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 tabular-nums hover:text-rheinblau`}
    >
      {tone ? <StatusIcon tone={tone} /> : null}
      {value}
    </Link>
  );
}

function prsHref(row: RepoRow, security = false): string {
  const qs = new URLSearchParams({ repo: row.fullName });
  if (security) qs.set("typ", "security");
  return `/pull-requests?${qs.toString()}`;
}

function BuildCheck({ row }: { row: RepoRow }) {
  return (
    <StatusText tone={BUILD_CHECK_TONE[row.buildCheck]} className="whitespace-nowrap">
      {BUILD_CHECK_LABEL[row.buildCheck]}
    </StatusText>
  );
}

/**
 * Repo-Liste als Tabelle (Karten unter 768 px). Spalten-IDs stehen in der Adresse
 * (`sort=repo|status|lauf|prs|sicherheit`). Ohne `sort` bleibt die Reihenfolge des Servers
 * (Handlungsbedarf, dann Name). `now` kommt vom Server, damit Server und Browser dieselbe Zeit zeigen.
 */
export function RepoTable({ rows, now }: { rows: RepoRow[]; now?: Date }) {
  const nowMs = (now ?? new Date()).getTime();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<ColumnDef<RepoRow, any>[]>(() => {
    const at = new Date(nowMs);
    return [
      {
        id: "repo",
        header: "Repo",
        accessorFn: (r) => r.fullName.toLowerCase(),
        sortingFn: "alphanumeric",
        cell: ({ row }) => (
          <div>
            <RepoLink row={row.original} />
            {row.original.partialError ? <PartialError message={row.original.partialError} /> : null}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => TONE_RANK[r.health.tone],
        // Absteigend (Vorgabe in der Adresse) heißt "dringendster zuerst": kleiner Rang oben.
        sortingFn: (a, b) => TONE_RANK[b.original.health.tone] - TONE_RANK[a.original.health.tone],
        cell: ({ row }) => <StatusBadge tone={row.original.health.tone}>{row.original.health.label}</StatusBadge>,
      },
      {
        id: "onboarding",
        header: "Onboarding",
        enableSorting: false,
        meta: { className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <StatusText tone={ONBOARDING_TONE[row.original.onboarding]} className="whitespace-nowrap">
            {ONBOARDING_LABEL[row.original.onboarding]}
          </StatusText>
        ),
      },
      {
        id: "build-check",
        header: "Build-Check",
        enableSorting: false,
        meta: { className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => <BuildCheck row={row.original} />,
      },
      {
        id: "lauf",
        header: "Letzter Lauf",
        accessorFn: (r) => r.lastJobAt?.getTime() ?? 0,
        cell: ({ row }) => <LastJob row={row.original} now={at} />,
      },
      {
        id: "prs",
        header: "Offene PRs",
        accessorFn: (r) => r.openPrs,
        meta: { align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => <Count value={row.original.openPrs} href={prsHref(row.original)} />,
      },
      {
        id: "sicherheit",
        header: "Sicherheit",
        accessorFn: (r) => r.securityPrs,
        meta: { align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => <Count value={row.original.securityPrs} href={prsHref(row.original, true)} tone="fehler" />,
      },
    ];
  }, [nowMs]);

  return (
    <DataTable
      caption="Repos"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      renderCard={(r) => {
        const at = new Date(nowMs);
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={r.health.tone}>{r.health.label}</StatusBadge>
            </div>
            <div className="text-sm">
              <RepoLink row={r} />
              {r.partialError ? <PartialError message={r.partialError} /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <StatusText tone={ONBOARDING_TONE[r.onboarding]}>{ONBOARDING_LABEL[r.onboarding]}</StatusText>
              <BuildCheck row={r} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
              <LastJob row={r} now={at} />
              <span className="inline-flex items-center gap-1.5">
                {r.openPrs === 0 ? (
                  <span>0 offene PRs</span>
                ) : (
                  <Link href={prsHref(r)} className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-rheinblau">
                    {r.openPrs === 1 ? "1 offener PR" : `${r.openPrs} offene PRs`}
                  </Link>
                )}
              </span>
              {r.securityPrs > 0 ? (
                <StatusText tone="fehler">{r.securityPrs} Sicherheit</StatusText>
              ) : null}
            </div>
          </div>
        );
      }}
    />
  );
}
