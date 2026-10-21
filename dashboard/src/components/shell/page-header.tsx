export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  /** Aktion des Seitenkopfs, etwa "Alle Repos laufen lassen". */
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-prose text-ink-soft">{description}</p> : null}
      </div>
      {action ? <div className="min-w-0 max-w-full">{action}</div> : null}
    </header>
  );
}
