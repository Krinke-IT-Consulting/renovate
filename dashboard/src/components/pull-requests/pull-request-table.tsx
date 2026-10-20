"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { GitMergeIcon, TriangleAlertIcon } from "lucide-react";
import { DataTable, type ColumnMeta } from "@/components/data/data-table";
import { ExternalLink } from "@/components/data/external-link";
import { StatusBadge, StatusText } from "@/components/status/status";
import {
  CI_STATUS_LABEL,
  CI_STATUS_TONE,
  UPDATE_TYPE_LABEL,
  UPDATE_TYPE_TONE,
} from "@/domain/status-tone";
import { ageInDays } from "@/lib/format";
import type { PullRequestRow } from "@/queries/pull-requests";
import { PR_COMPARE, UPDATE_TYPE_RANK, ageLabel, isStale, versionJump } from "./pull-request-format";

function Title({ row }: { row: PullRequestRow }) {
  const jump = versionJump(row.title);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <ExternalLink href={row.url}>
        <span className="min-w-0 break-words">{row.title}</span>
      </ExternalLink>
      {jump ? <span className="font-mono text-xs text-ink-soft">{jump}</span> : null}
    </span>
  );
}

function Automerge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
      <GitMergeIcon aria-hidden="true" className="size-4 shrink-0" />
      Automerge
    </span>
  );
}

function Age({ row, now }: { row: PullRequestRow; now: Date }) {
  const days = ageInDays(row.createdAt, now);
  const label = ageLabel(days);
  if (isStale(row.updateType, days)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-status-warnung">
        <TriangleAlertIcon aria-hidden="true" strokeWidth={2.25} className="size-4 shrink-0" />
        {label}, hängt
      </span>
    );
  }
  return <span className="text-sm whitespace-nowrap text-ink-soft">{label}</span>;
}

/**
 * Offene Renovate-PRs als Tabelle (Karten unter 768 px). Spalten-IDs stehen in der Adresse
 * (`sort=alter|repo|typ`). `now` kommt vom Server, damit Server und Browser dasselbe Alter zeigen.
 */
export function PullRequestTable({
  rows,
  showRepo = true,
  caption = "Offene Pull Requests",
  now,
  manualSorting = false,
}: {
  rows: PullRequestRow[];
  showRepo?: boolean;
  caption?: string;
  now?: Date;
  /** Die Zeilen kommen bereits nach `sort`/`dir` der Adresse sortiert vom Server (paginierte Liste). */
  manualSorting?: boolean;
}) {
  const nowMs = (now ?? new Date()).getTime();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns = useMemo<ColumnDef<PullRequestRow, any>[]>(() => {
    const at = new Date(nowMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cols: ColumnDef<PullRequestRow, any>[] = [
      {
        id: "titel",
        header: "Pull Request",
        enableSorting: false,
        cell: ({ row }) => <Title row={row.original} />,
      },
    ];
    if (showRepo) {
      cols.push({
        id: "repo",
        header: "Repo",
        accessorFn: (r) => r.repoFullName.toLowerCase(),
        sortingFn: (a, b) => PR_COMPARE.repo(a.original, b.original, at),
        cell: ({ row }) => <span className="text-sm whitespace-nowrap">{row.original.repoFullName}</span>,
      });
    }
    cols.push(
      {
        id: "typ",
        header: "Typ",
        accessorFn: (r) => UPDATE_TYPE_RANK[r.updateType],
        // Absteigend (Vorgabe in der Adresse) heißt "dringendster zuerst": kleiner Rang oben.
        sortingFn: (a, b) => PR_COMPARE.typ(a.original, b.original, at),
        cell: ({ row }) => (
          <StatusBadge tone={UPDATE_TYPE_TONE[row.original.updateType]}>
            {UPDATE_TYPE_LABEL[row.original.updateType]}
          </StatusBadge>
        ),
      },
      {
        id: "ci",
        header: "CI",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusText tone={CI_STATUS_TONE[row.original.ciStatus]} className="whitespace-nowrap">
            {CI_STATUS_LABEL[row.original.ciStatus]}
          </StatusText>
        ),
      },
      {
        id: "automerge",
        header: "Automerge",
        enableSorting: false,
        meta: { className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (row.original.automerge ? <Automerge /> : null),
      },
      {
        id: "alter",
        header: "Alter",
        accessorFn: (r) => ageInDays(r.createdAt, at),
        sortingFn: (a, b) => PR_COMPARE.alter(a.original, b.original, at),
        meta: { align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => <Age row={row.original} now={at} />,
      },
    );
    return cols;
  }, [showRepo, nowMs]);

  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      manualSorting={manualSorting}
      renderCard={(r) => {
        const at = new Date(nowMs);
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={UPDATE_TYPE_TONE[r.updateType]}>{UPDATE_TYPE_LABEL[r.updateType]}</StatusBadge>
              <StatusText tone={CI_STATUS_TONE[r.ciStatus]}>{CI_STATUS_LABEL[r.ciStatus]}</StatusText>
              {r.automerge ? <Automerge /> : null}
            </div>
            <div className="text-sm">
              <Title row={r} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {showRepo ? <span className="text-sm break-all text-ink-soft">{r.repoFullName}</span> : <span />}
              <Age row={r} now={at} />
            </div>
          </div>
        );
      }}
    />
  );
}
