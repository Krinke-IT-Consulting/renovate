import Link from "next/link";
import { LogOutIcon } from "lucide-react";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { APP_NAME, LOGOUT_URL } from "./nav-items";
import { SyncStamp, type SyncSourceState } from "./sync-stamp";

export function SiteHeader({
  account,
  sync,
}: {
  account: string | null;
  sync: SyncSourceState[] | null;
}) {
  return (
    <header className="border-b bg-papier">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 lg:gap-x-8">
        <Link
          href="/"
          aria-label={`${APP_NAME}, zur Übersicht`}
          className="flex min-h-11 shrink-0 items-center rounded-md"
        >
          {/*
            Logos unverändert. Ein <picture> lädt nur das passende Bild (breit ab lg = 64rem, sonst kompakt);
            Breite und Höhe stehen im <img>, damit nichts springt. Der Link trägt den Namen, das Bild ist
            Schmuck (alt leer). Bewusst kein next/image: Die Dateien bleiben unoptimiert und unangetastet.
          */}
          <picture>
            <source media="(min-width: 64rem)" srcSet="/images/logo-wide.png" width={850} height={250} />
            <img
              src="/images/logo-compact.png"
              alt=""
              width={400}
              height={118}
              fetchPriority="high"
              className="h-8 w-auto lg:h-10"
            />
          </picture>
        </Link>

        <nav aria-label="Hauptnavigation" className="hidden min-w-0 lg:block">
          <NavLinks orientation="horizontal" />
        </nav>

        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <div className="hidden lg:block">
            <SyncStamp sources={sync} />
          </div>
          {account ? (
            <span className="hidden max-w-48 truncate text-sm text-ink-soft lg:inline" title={account}>
              {account}
            </span>
          ) : null}
          <a
            href={LOGOUT_URL}
            className="hidden min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-olive underline-offset-4 hover:underline lg:inline-flex"
          >
            <LogOutIcon className="size-4 text-logo-gruen" aria-hidden="true" />
            Abmelden
          </a>
          <MobileNav account={account} />
        </div>
      </div>
      <div className="border-t bg-surface px-4 py-1.5 lg:hidden">
        <SyncStamp sources={sync} />
      </div>
    </header>
  );
}
