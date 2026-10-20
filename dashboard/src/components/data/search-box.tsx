"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { withParams } from "@/lib/search-params";

/** Freitextsuche; schreibt nach kurzer Pause `q` in die Adresse (gefiltert wird auf dem Server). */
export function SearchBox({ label, placeholder }: { label: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("q") ?? "";
  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Adresse geändert (etwa "Filter zurücksetzen"): Feld nachziehen.
  const [lastCurrent, setLastCurrent] = useState(current);
  if (current !== lastCurrent) {
    setLastCurrent(current);
    setValue(current);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      router.replace(
        withParams(pathname, new URLSearchParams(searchParams.toString()), { q: next.trim() || undefined }),
        { scroll: false },
      );
    }, 300);
  }

  return (
    <label className="relative flex min-w-56 shrink-0 items-center">
      <span className="sr-only">{label}</span>
      <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-ink-soft" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-full bg-papier pr-4 pl-9 text-sm ring-1 ring-rheinblau-tief/20 ring-inset placeholder:text-ink-soft focus-visible:ring-rheinblau lg:h-9"
      />
    </label>
  );
}
