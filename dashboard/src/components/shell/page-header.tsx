export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      {description ? <p className="mt-2 max-w-prose text-ink-soft">{description}</p> : null}
    </header>
  );
}
