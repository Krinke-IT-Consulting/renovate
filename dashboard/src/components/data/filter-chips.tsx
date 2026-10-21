import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toggle, withParams, type RawSearchParams } from "@/lib/search-params";

export type ChipOption<T extends string> = { value: T; label: string; count?: number };

/**
 * Filter als Pill-Chips. Jeder Chip ist ein Link auf die Adresse mit umgeschaltetem Wert, damit
 * Filter ohne JavaScript funktionieren und in der Adresse stehen. Aktive Chips sind gefüllt und
 * tragen einen Haken (nicht nur Farbe).
 */
export function FilterChips<T extends string>({
  label,
  param,
  options,
  selected,
  pathname,
  searchParams,
  single = false,
}: {
  label: string;
  param: string;
  options: readonly ChipOption<T>[];
  selected: readonly T[];
  pathname: string;
  searchParams: RawSearchParams;
  /** Nur ein Wert zugleich (z. B. Owner). */
  single?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-1.5 lg:min-w-0 lg:shrink lg:flex-wrap lg:gap-y-3">
      <span className="mr-1 hidden text-xs font-medium text-ink-soft sm:inline">{label}</span>
      {options.map((o) => {
        const active = selected.includes(o.value);
        const next = single ? (active ? [] : [o.value]) : toggle(selected, o.value);
        return (
          <Link
            key={o.value}
            href={withParams(pathname, searchParams, { [param]: next })}
            scroll={false}
            replace
            aria-current={active ? "true" : undefined}
            className={cn(
              "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium whitespace-nowrap ring-1 transition-colors ring-inset",
              "after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']",
              active
                ? "bg-rheinblau text-papier ring-rheinblau hover:bg-rheinblau-hell"
                : "bg-papier text-ink ring-rheinblau-tief/55 hover:text-rheinblau hover:ring-rheinblau",
            )}
          >
            {active ? <CheckIcon aria-hidden="true" className="size-3.5" /> : null}
            {o.label}
            {o.count !== undefined ? (
              <span className={cn("tabular-nums", active ? "text-papier/80" : "text-ink-soft")}>{o.count}</span>
            ) : null}
            {active ? <span className="sr-only"> (aktiv)</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

/** Leiste für Chips und Suche; auf dem Handy waagerecht scrollbar, die Seite selbst nie. */
export function FilterBar({
  children,
  resetHref,
}: {
  children: React.ReactNode;
  /** Gesetzt, wenn mindestens ein Filter aktiv ist. */
  resetHref?: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
      {/* Vertikaler Innenabstand: Das Pseudo-Element der Chips (44 px) wird vom Scrollcontainer sonst abgeschnitten. */}
      <div className="-mx-4 flex items-center gap-4 overflow-x-auto px-4 py-1.5 [scrollbar-width:thin] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:py-0">
        {children}
      </div>
      {resetHref ? (
        <Link
          href={resetHref}
          scroll={false}
          replace
          className="inline-flex min-h-11 items-center self-start text-sm font-medium text-olive underline underline-offset-4 hover:text-rheinblau lg:ml-auto lg:self-auto"
        >
          Filter zurücksetzen
        </Link>
      ) : null}
    </div>
  );
}
