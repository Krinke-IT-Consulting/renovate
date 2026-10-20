/** Ladezustand der Übersicht: Platzhalter in Form des Absatzes und der Schritte, kein Ladekreisel. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
      <span className="sr-only">Lagebericht wird geladen</span>
      <div aria-hidden="true" className="space-y-3">
        <div className="mb-6 h-8 w-40 animate-pulse rounded bg-rheinblau-tief/10" />
        <div className="h-6 w-full max-w-[60ch] animate-pulse rounded bg-rheinblau-tief/8" />
        <div className="h-6 w-11/12 max-w-[56ch] animate-pulse rounded bg-rheinblau-tief/8" />
        <div className="h-6 w-2/3 max-w-[40ch] animate-pulse rounded bg-rheinblau-tief/8" />
        <div className="space-y-2 pt-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="size-8 rounded-full bg-rheinblau-tief/10" />
              <div className="h-16 flex-1 animate-pulse rounded-xl bg-papier" />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="space-y-8">
        <div className="h-48 animate-pulse rounded-xl bg-papier" />
        <div className="h-64 animate-pulse rounded-xl bg-papier" />
      </div>
    </div>
  );
}
