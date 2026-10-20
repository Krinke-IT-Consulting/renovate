import { CheckIcon, CircleXIcon, ContrastIcon, MinusIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/domain/status-tone";

/**
 * Status nie nur über Farbe: jede Tonlage hat ein Symbol mit eigener Form (Kreuz im Kreis, Dreieck,
 * Haken, halber Kreis, Strich) und wird immer mit Text gezeigt (ansichten-entwurf.md, Abschnitt 3).
 */
const ICONS = {
  fehler: CircleXIcon,
  warnung: TriangleAlertIcon,
  erfolg: CheckIcon,
  laeuft: ContrastIcon,
  neutral: MinusIcon,
} as const;

/** Textfarbe je Ton. Erfolg nutzt für Text Tinte, nur das Symbol ist grün (Kontrast). */
const TEXT = {
  fehler: "text-status-fehler",
  warnung: "text-status-warnung",
  erfolg: "text-ink",
  laeuft: "text-status-laeuft",
  neutral: "text-status-neutral",
} as const;

const ICON_COLOR = {
  fehler: "text-status-fehler",
  warnung: "text-status-warnung",
  erfolg: "text-status-erfolg",
  laeuft: "text-status-laeuft",
  neutral: "text-status-neutral",
} as const;

export function StatusIcon({ tone, className }: { tone: StatusTone; className?: string }) {
  const Icon = ICONS[tone];
  return <Icon aria-hidden="true" strokeWidth={2.25} className={cn("size-4 shrink-0", ICON_COLOR[tone], className)} />;
}

/** Symbol plus Text, ohne Fläche: für Tabellenzellen und Detailzeilen. */
export function StatusText({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", TEXT[tone], className)}>
      <StatusIcon tone={tone} />
      <span>{children}</span>
    </span>
  );
}

const BADGE_BG = {
  fehler: "bg-status-fehler/8 ring-status-fehler/25",
  warnung: "bg-status-warnung/8 ring-status-warnung/25",
  erfolg: "bg-status-erfolg/8 ring-status-erfolg/30",
  laeuft: "bg-status-laeuft/8 ring-status-laeuft/25",
  neutral: "bg-rheinblau-tief/5 ring-rheinblau-tief/15",
} as const;

/** Badge mit leichter Fläche: für den dringendsten Zustand eines Repos oder Update-Typen. */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        BADGE_BG[tone],
        TEXT[tone],
        className,
      )}
    >
      <StatusIcon tone={tone} className="size-3.5" />
      {children}
    </span>
  );
}
