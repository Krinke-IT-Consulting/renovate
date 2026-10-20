import Image from "next/image";
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
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2 lg:gap-8">
        <Link
          href="/"
          aria-label={`${APP_NAME}, zur Übersicht`}
          className="flex min-h-11 shrink-0 items-center rounded-md"
        >
          {/* Logos unverändert; unoptimized, damit das Image ohne Bildoptimierung (sharp) auskommt. */}
          <Image
            src="/images/logo-wide.png"
            alt=""
            width={850}
            height={250}
            unoptimized
            priority
            className="hidden h-10 w-auto lg:block"
          />
          <Image
            src="/images/logo-compact.png"
            alt=""
            width={400}
            height={118}
            unoptimized
            priority
            className="h-8 w-auto lg:hidden"
          />
        </Link>

        <nav aria-label="Hauptnavigation" className="hidden lg:block">
          <NavLinks orientation="horizontal" />
        </nav>

        <div className="ml-auto flex items-center gap-4">
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
