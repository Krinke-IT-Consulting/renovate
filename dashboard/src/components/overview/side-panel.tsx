import Link from "next/link";
import { StatusIcon, StatusText } from "@/components/status/status";
import { shortName } from "@/domain/report";
import type { StatusTone } from "@/domain/status-tone";
import { withParams } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { TOUCH_TARGET } from "@/lib/touch-target";
import type { OverviewMetrics, RepoTile } from "@/queries/overview";

/** Kennzahlen als ruhige Liste, keine Kachelwand (uebersicht-entwurf.md, Abschnitt 4). */
export function Metrics({ m }: { m: OverviewMetrics }) {
  const rows: { label: string; value: React.ReactNode; href: string }[] = [
    { label: "Repos", value: `${m.onboarded} von ${m.repos} onboardet`, href: "/repos" },
    {
      label: "Offene PRs",
      value: m.automergePrs > 0 ? `${m.openPrs}, davon ${m.automergePrs} Automerge` : String(m.openPrs),
      href: "/pull-requests",
    },
    {
      label: "Läufe, 7 Tage",
      value:
        m.failedJobs7d > 0 ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-x-1.5">
            {m.jobs7d},<StatusText tone="fehler">{m.failedJobs7d} fehlgeschlagen</StatusText>
          </span>
        ) : (
          String(m.jobs7d)
        ),
      href: m.failedJobs7d > 0 ? "/jobs?status=failed" : "/jobs",
    },
    { label: "Offene Probleme", value: String(m.openProblems), href: "/probleme" },
  ];
  return (
    <section aria-labelledby="kennzahlen">
      <h2 id="kennzahlen" className="mb-2 text-base font-semibold">
        Kennzahlen
      </h2>
      <dl className="divide-y divide-border rounded-xl bg-papier px-4 shadow-karte">
        {rows.map((r) => (
          <div key={r.label} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
            <dt className="text-ink-soft">
              <Link
                href={r.href}
                className={cn(TOUCH_TARGET, "underline decoration-transparent underline-offset-4 hover:text-rheinblau hover:decoration-rheinblau")}
              >
                {r.label}
              </Link>
            </dt>
            <dd className="min-w-0 text-right font-semibold text-ink tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const TILE_BG: Record<StatusTone, string> = {
  // Deckende Mischungen: Die Rasterlinien (Hintergrund der Liste) dürfen nicht durchscheinen.
  fehler: "bg-[color-mix(in_srgb,var(--status-fehler)_9%,var(--papier))] hover:bg-[color-mix(in_srgb,var(--status-fehler)_16%,var(--papier))]",
  warnung: "bg-[color-mix(in_srgb,var(--status-warnung)_10%,var(--papier))] hover:bg-[color-mix(in_srgb,var(--status-warnung)_17%,var(--papier))]",
  laeuft: "bg-[color-mix(in_srgb,var(--status-laeuft)_9%,var(--papier))] hover:bg-[color-mix(in_srgb,var(--status-laeuft)_16%,var(--papier))]",
  erfolg: "bg-papier hover:bg-[color-mix(in_srgb,var(--status-erfolg)_9%,var(--papier))]",
  neutral: "bg-surface hover:bg-[color-mix(in_srgb,var(--rheinblau-tief)_6%,var(--papier))]",
};

const LEGEND: { tone: StatusTone; label: string }[] = [
  { tone: "fehler", label: "Fehler" },
  { tone: "warnung", label: "Entscheidung" },
  { tone: "laeuft", label: "Läuft" },
  { tone: "erfolg", label: "Aktuell" },
];

/**
 * Raster mit einer Kachel pro Repo auf einem sichtbaren Zellenraster. Die Kachel zeigt den
 * dringendsten Zustand mit Symbol (Form) und Fläche; ein Klick filtert die Schritte (?repo=).
 */
export function RepoGrid({
  tiles,
  selected,
  searchParams,
}: {
  tiles: RepoTile[];
  selected: string | undefined;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return (
    <section aria-labelledby="repo-raster">
      <h2 id="repo-raster" className="mb-2 text-base font-semibold">
        Repos <span className="font-sans text-sm font-medium text-ink-soft tabular-nums">{tiles.length}</span>
      </h2>
      <ul className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-rheinblau-tief/12 ring-1 ring-rheinblau-tief/12 sm:grid-cols-4">
        {tiles.map((t) => {
          const isSelected = selected === t.fullName;
          return (
            <li key={t.fullName} className="contents">
              <Link
                href={withParams("/", searchParams, { repo: isSelected ? undefined : t.fullName })}
                scroll={false}
                aria-current={isSelected ? "true" : undefined}
                aria-label={`${shortName(t.fullName)}: ${t.health.label}${isSelected ? " (Filter aktiv)" : ""}`}
                title={`${t.fullName}: ${t.health.label}`}
                className={cn(
                  "flex min-h-16 min-w-0 flex-col justify-between gap-1 p-2 text-xs transition-colors",
                  TILE_BG[t.health.tone],
                  isSelected && "relative z-10 ring-2 ring-rheinblau ring-inset",
                )}
              >
                <StatusIcon tone={t.health.tone} className="size-4" />
                <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">{shortName(t.fullName)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <ul aria-label="Legende" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {LEGEND.map((l) => (
          <li key={l.tone} className="inline-flex items-center gap-1">
            <StatusIcon tone={l.tone} className="size-3.5" />
            {l.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
