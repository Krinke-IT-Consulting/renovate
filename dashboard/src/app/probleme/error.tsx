"use client";

/** Fehlerzustand der Probleme-Seite: keine technischen Details, nur der Weg zurück. */
export default function Error({ retry }: { retry: () => void }) {
  return (
    <section
      role="alert"
      className="rounded-xl bg-papier p-6 shadow-karte"
    >
      <h1 className="text-lg font-semibold">Die Probleme konnten nicht geladen werden.</h1>
      <p className="mt-2 max-w-prose text-ink-soft">Bitte versuchen Sie es noch einmal. Die Daten selbst sind nicht betroffen.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-olive px-4 text-sm font-medium text-papier hover:bg-olive/90"
      >
        Erneut versuchen
      </button>
    </section>
  );
}
