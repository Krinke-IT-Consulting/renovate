"use client";

// Ab Next 16.3 heißt die Wiederholung `retry` (lädt die Daten neu); `reset` rendert nur neu.
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section role="alert" className="rounded-xl bg-papier p-6 shadow-karte">
      <h1 className="text-lg font-semibold">Die Pull Requests konnten nicht geladen werden.</h1>
      <p className="mt-2 max-w-prose text-ink-soft">Bitte versuchen Sie es erneut.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-3 inline-flex min-h-11 items-center rounded-full bg-rheinblau px-5 text-sm font-medium text-papier hover:bg-rheinblau-hell"
      >
        Erneut versuchen
      </button>
    </section>
  );
}
