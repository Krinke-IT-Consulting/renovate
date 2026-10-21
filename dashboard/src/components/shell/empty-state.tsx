import Link from "next/link";

/**
 * Leerzustand: sagt, warum nichts da ist und was als Nächstes passiert (Spec dashboard-views).
 * `action` ist ein optionaler Link, etwa "Filter zurücksetzen".
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <section className="rounded-xl bg-papier p-6 shadow-karte">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <div className="mt-2 max-w-prose space-y-2 text-ink-soft">{children}</div> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-olive underline underline-offset-4 hover:text-rheinblau"
        >
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
