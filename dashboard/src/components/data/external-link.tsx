import { ExternalLinkIcon } from "lucide-react";
import { safeExternalHref } from "@/lib/safe-external-href";
import { cn } from "@/lib/utils";

/**
 * Link auf die Plattform (PR, Repo, Dependency Dashboard): neuer Tab, Symbol für "extern".
 * Verlinkt wird nur eine `https:`-Adresse; sonst (etwa ein unerwarteter Wert aus der Datenbank)
 * steht der Text ohne Link da.
 */
export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const safe = safeExternalHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 font-medium text-rheinblau underline decoration-rheinblau/30 underline-offset-4 hover:decoration-rheinblau",
        className,
      )}
    >
      {children}
      <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only"> (öffnet in neuem Tab)</span>
    </a>
  );
}
