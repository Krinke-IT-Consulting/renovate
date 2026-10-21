"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon, CopyIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data/data-table";
import { StatusText } from "@/components/status/status";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE, JOB_TRIGGER_LABEL } from "@/domain/status-tone";
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { limitLogLines } from "@/lib/log-view";
import { repoDetailHref } from "@/lib/repo-detail-href";
import { TOUCH_TARGET } from "@/lib/touch-target";
import type { JobRow } from "@/queries/jobs";

type Layout = "table" | "card";

function jobTime(job: JobRow): Date {
  return job.startedAt ?? job.createdAt;
}

function logPanelId(job: JobRow, layout: Layout) {
  return `job-log-${job.id}-${layout}`;
}

/** Relative Zeit mit Datum im title; die Sekunde kann zwischen Server und Browser kippen. */
function JobTime({ job }: { job: JobRow }) {
  const at = jobTime(job);
  return (
    <time dateTime={at.toISOString()} title={formatDateTime(at)} suppressHydrationWarning className="md:whitespace-nowrap">
      {formatRelative(at)}
    </time>
  );
}

/**
 * Offen-Zustand der Log-Zeilen. Er läuft über einen Kontext statt über die Spaltendefinition: Hinge
 * `columns` von `open` ab, würde die Tabelle die Zelle beim Aufklappen neu mounten und der Fokus
 * fiele auf `body`.
 */
const OpenLogsContext = createContext<{ open: ReadonlySet<string>; toggle: (id: string) => void }>({
  open: new Set(),
  toggle: () => {},
});

function LogCell({ job, layout }: { job: JobRow; layout: Layout }) {
  const { open, toggle } = useContext(OpenLogsContext);
  return hasLog(job) ? (
    <LogToggle
      job={job}
      layout={layout}
      expanded={open.has(job.id)}
      onToggle={toggle}
      className={layout === "card" ? "min-h-11 after:hidden" : undefined}
    />
  ) : (
    <NoLog job={job} />
  );
}

function RepoLink({ fullName }: { fullName: string }) {
  return (
    <Link
      href={repoDetailHref(fullName)}
      className={cn(TOUCH_TARGET, "font-medium text-rheinblau underline-offset-4 hover:underline")}
    >
      {fullName}
    </Link>
  );
}

function ArtifactHint({ job }: { job: JobRow }) {
  if (job.artifactErrorCount <= 0) return null;
  return <StatusText tone="warnung">Lockfile-Fehler</StatusText>;
}

/** Knopf zum Auf- und Zuklappen des Log-Auszugs; nennt das Repo für Screenreader. */
function LogToggle({
  job,
  layout,
  expanded,
  onToggle,
  className,
}: {
  job: JobRow;
  layout: Layout;
  expanded: boolean;
  onToggle: (id: string) => void;
  className?: string;
}) {
  const Icon = expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={logPanelId(job, layout)}
      onClick={() => onToggle(job.id)}
      className={cn(
        "relative inline-flex items-center gap-1 rounded-sm text-sm font-medium whitespace-nowrap text-rheinblau hover:underline",
        "after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {expanded ? "Log ausblenden" : "Log anzeigen"}
      <span className="sr-only"> für {job.repoFullName}</span>
    </button>
  );
}

/** Ersatz für den Knopf bei Jobs ohne Auszug: ein fehlgeschlagener Job nach dem Bereinigen. */
function NoLog({ job }: { job: JobRow }) {
  if (job.status !== "failed") return null;
  return <span className="text-sm whitespace-nowrap text-ink-soft">Log nicht mehr verfügbar</span>;
}

function hasLog(job: JobRow): job is JobRow & { logExcerpt: string } {
  return job.logExcerpt != null && job.logExcerpt.trim() !== "";
}

/**
 * Log-Auszug: Monospace auf Surface-Grund, zeilenweise umbrechend (kein waagerechtes Scrollen),
 * zunächst 30 Zeilen, "Kopieren" bestätigt sich in einer aria-live-Region.
 */
function LogPanel({ job, layout }: { job: JobRow & { logExcerpt: string }; layout: Layout }) {
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const preview = useMemo(() => limitLogLines(job.logExcerpt), [job.logExcerpt]);

  async function copy() {
    let message: string;
    try {
      await navigator.clipboard.writeText(job.logExcerpt);
      message = "Kopiert";
    } catch {
      message = "Kopieren nicht möglich";
    }
    setNotice(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(""), 3000);
  }

  return (
    <div
      id={logPanelId(job, layout)}
      role="region"
      aria-label={`Log-Auszug ${job.repoFullName}`}
      className={cn("rounded-lg bg-surface p-3", layout === "card" && "mt-3")}
    >
      <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {showAll ? job.logExcerpt.replace(/\n+$/, "") : preview.text}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-rheinblau hover:underline"
        >
          <CopyIcon aria-hidden="true" className="size-4" />
          Kopieren
        </button>
        {preview.hiddenLines > 0 ? (
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-rheinblau hover:underline"
          >
            {showAll ? "Nur den Anfang zeigen" : `Ganzen Auszug zeigen (${preview.totalLines} Zeilen)`}
          </button>
        ) : null}
        <span aria-live="polite" className="text-sm font-medium text-ink">
          {notice}
        </span>
      </div>
    </div>
  );
}

/**
 * Jobs als Tabelle (Karten auf Mobil). Auch für das Repo-Detail gedacht (`showRepo={false}`).
 * Jobs mit Log-Auszug lassen sich unter ihrer Zeile aufklappen.
 */
export function JobTable({
  rows,
  showRepo = true,
  caption = "Renovate-Läufe",
  manualSorting = false,
}: {
  rows: JobRow[];
  showRepo?: boolean;
  caption?: string;
  /** Die Zeilen kommen bereits nach `sort`/`dir` der Adresse sortiert vom Server (paginierte Liste). */
  manualSorting?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const columns = useMemo<ColumnDef<JobRow, unknown>[]>(() => {
    const cols: ColumnDef<JobRow, unknown>[] = [
      {
        id: "zeit",
        header: "Zeit",
        accessorFn: (j) => jobTime(j).getTime(),
        cell: ({ row }) => <JobTime job={row.original} />,
      },
    ];
    if (showRepo) {
      cols.push({
        id: "repo",
        header: "Repo",
        accessorFn: (j) => j.repoFullName,
        cell: ({ row }) => <RepoLink fullName={row.original.repoFullName} />,
      });
    }
    cols.push(
      {
        id: "ausloeser",
        header: "Auslöser",
        accessorFn: (j) => JOB_TRIGGER_LABEL[j.trigger],
        cell: ({ getValue }) => <span>{getValue<string>()}</span>,
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (j) => JOB_STATUS_LABEL[j.status],
        cell: ({ row }) => (
          <StatusText tone={JOB_STATUS_TONE[row.original.status]}>{JOB_STATUS_LABEL[row.original.status]}</StatusText>
        ),
      },
      {
        id: "dauer",
        header: "Dauer",
        accessorFn: (j) => j.durationMs ?? -1,
        meta: { align: "right" },
        cell: ({ row }) => <span className="tabular-nums">{formatDuration(row.original.durationMs)}</span>,
      },
      {
        id: "hinweis",
        header: "Hinweis",
        enableSorting: false,
        cell: ({ row }) => <ArtifactHint job={row.original} />,
      },
      {
        id: "log",
        header: "Log",
        enableSorting: false,
        cell: ({ row }) => <LogCell job={row.original} layout="table" />,
      },
    );
    return cols;
  }, [showRepo]);

  const openLogs = useMemo(() => ({ open, toggle }), [open, toggle]);

  return (
    <OpenLogsContext.Provider value={openLogs}>
      <DataTable
        caption={caption}
        columns={columns}
        rows={rows}
        rowKey={(j) => j.id}
        manualSorting={manualSorting}
        renderExpanded={(job, layout) =>
          open.has(job.id) && hasLog(job) ? <LogPanel job={job} layout={layout} /> : null
        }
        renderCard={(job) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <StatusText tone={JOB_STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</StatusText>
              <span className="text-sm text-ink-soft">
                <JobTime job={job} />
              </span>
            </div>
            {showRepo ? (
              <p className="text-sm break-words">
                <RepoLink fullName={job.repoFullName} />
              </p>
            ) : null}
            <p className="text-sm text-ink-soft">
              {JOB_TRIGGER_LABEL[job.trigger]}, Dauer <span className="tabular-nums">{formatDuration(job.durationMs)}</span>
            </p>
            <ArtifactHint job={job} />
            <LogCell job={job} layout="card" />
          </div>
        )}
      />
    </OpenLogsContext.Provider>
  );
}
