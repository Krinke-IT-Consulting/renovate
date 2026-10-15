"use client";

import { useState } from "react";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";
import { LOGOUT_URL } from "./nav-items";

export function MobileNav({ account }: { account: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="size-11 lg:hidden" aria-label="Menü öffnen">
          <MenuIcon aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-4/5 max-w-sm gap-6 p-4">
        <SheetHeader className="p-0">
          <SheetTitle className="font-heading text-rheinblau">Menü</SheetTitle>
          <SheetDescription className="sr-only">Navigation der Update Zentrale</SheetDescription>
        </SheetHeader>
        <nav aria-label="Hauptnavigation (Menü)">
          <NavLinks orientation="vertical" onNavigate={() => setOpen(false)} />
        </nav>
        <div className="mt-auto border-t pt-4 text-sm">
          {account ? <p className="text-ink-soft">Angemeldet als {account}</p> : null}
          <a
            href={LOGOUT_URL}
            className="mt-1 inline-flex min-h-11 items-center font-medium text-olive underline underline-offset-4"
          >
            Abmelden
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
