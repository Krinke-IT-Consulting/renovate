/** Ladezustand in Form der Liste: Zeilen statt Ladekreisel (Spec dashboard-views). */
export function TableSkeleton({ rows = 8, label = "Liste wird geladen" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex gap-2">
        {[64, 88, 72, 96].map((w, i) => (
          <div key={i} className="h-8 animate-pulse rounded-full bg-rheinblau-tief/8" style={{ width: w }} />
        ))}
      </div>
      <div aria-hidden="true" className="overflow-hidden rounded-xl bg-papier shadow-karte-flach">
        <div className="h-10 border-b border-border" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex h-10 items-center gap-6 border-b border-border/70 px-3 last:border-b-0">
            <div className="h-3 w-40 animate-pulse rounded bg-rheinblau-tief/8" />
            <div className="h-3 w-24 animate-pulse rounded bg-rheinblau-tief/6" />
            <div className="hidden h-3 w-32 animate-pulse rounded bg-rheinblau-tief/6 md:block" />
            <div className="ml-auto h-3 w-12 animate-pulse rounded bg-rheinblau-tief/6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Platzhalter für den Seitenkopf (Titel und Zusammenfassung). */
export function HeaderSkeleton() {
  return (
    <div aria-hidden="true" className="mb-6 space-y-3">
      <div className="h-8 w-48 animate-pulse rounded bg-rheinblau-tief/10" />
      <div className="h-4 w-72 animate-pulse rounded bg-rheinblau-tief/6" />
    </div>
  );
}
