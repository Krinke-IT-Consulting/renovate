"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data/data-table";
import { ExternalLink } from "@/components/data/external-link";
import { StatusText } from "@/components/status/status";
import type { StatusTone } from "@/domain/status-tone";
import { formatDateTime } from "@/lib/format";
import type { RolloutRow } from "@/queries/repo-detail";

const KIND_LABEL: Record<RolloutRow["kind"], string> = {
  onboarding: "Onboarding",
  build_check: "Build-Check",
};

const STATUS_LABEL: Record<RolloutRow["status"], string> = {
  pending: "Wartet",
  pr_open: "PR offen",
  merged: "Übernommen",
  failed: "Fehlgeschlagen",
  closed: "Geschlossen",
};

const STATUS_TONE: Record<RolloutRow["status"], StatusTone> = {
  pending: "laeuft",
  pr_open: "laeuft",
  merged: "erfolg",
  failed: "fehler",
  closed: "neutral",
};

function PrLink({ row }: { row: RolloutRow }) {
  if (!row.prUrl) return <span className="text-sm text-ink-soft">–</span>;
  return <ExternalLink href={row.prUrl}>{row.prNumber ? `PR #${row.prNumber}` : "PR ansehen"}</ExternalLink>;
}

function When({ row }: { row: RolloutRow }) {
  return (
    <time dateTime={row.createdAt.toISOString()} className="text-sm whitespace-nowrap text-ink-soft tabular-nums">
      {formatDateTime(row.createdAt)}
    </time>
  );
}

/** Rollout-Aktionen eines Repos (Onboarding, Build-Check): Art, Status, PR-Link, Zeitpunkt. Ohne Sortierung. */
export function RolloutTable({ rows }: { rows: RolloutRow[] }) {
  const columns: ColumnDef<RolloutRow, unknown>[] = [
    { id: "art", header: "Art", enableSorting: false, cell: ({ row }) => <span className="text-sm">{KIND_LABEL[row.original.kind]}</span> },
    {
      id: "rollout-status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => (
        <StatusText tone={STATUS_TONE[row.original.status]} className="whitespace-nowrap">
          {STATUS_LABEL[row.original.status]}
        </StatusText>
      ),
    },
    { id: "pr", header: "Pull Request", enableSorting: false, cell: ({ row }) => <PrLink row={row.original} /> },
    { id: "zeitpunkt", header: "Zeitpunkt", enableSorting: false, cell: ({ row }) => <When row={row.original} /> },
  ];

  return (
    <DataTable
      caption="Rollout-Aktionen"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      renderCard={(r) => (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-medium">{KIND_LABEL[r.kind]}</span>
            <StatusText tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusText>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <PrLink row={r} />
            <When row={r} />
          </div>
        </div>
      )}
    />
  );
}
