"use client";

/** Fehlerzustand der Übersicht; nennt keine technischen Details. */
export default function Error({ retry }: { retry: () => void }) {
  return (
    <section className="max-w-prose rounded-xl bg-papier p-6 shadow-karte">
      <h1 className="text-xl font-semibold">Der Lagebericht konnte nicht geladen werden.</h1>
      <p className="mt-2 text-ink-soft">
        Die Datenbank hat nicht geantwortet. Der Abgleich-Stempel oben zeigt, ob das Problem länger besteht.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-olive px-4 text-sm font-semibold text-papier hover:bg-rheinblau"
      >
        Erneut versuchen
      </button>
    </section>
  );
}
