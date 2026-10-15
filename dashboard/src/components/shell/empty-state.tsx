export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="empty-title"
      className="rounded-lg border-l-2 border-l-logo-gruen bg-papier p-6 shadow-sm"
    >
      <h2 id="empty-title" className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-2 max-w-prose space-y-2 text-ink-soft">{children}</div>
    </section>
  );
}
