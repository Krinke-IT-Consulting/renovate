"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { withParams } from "@/lib/search-params";

/** Spalten-Metadaten: Ausrichtung und ob die Spalte auf schmalen Desktops ausgeblendet wird. */
export type ColumnMeta = { align?: "left" | "right"; className?: string };

/**
 * Tabelle für alle Listen: echte <table> mit (visuell versteckter) <caption>, Sortierung per Klick
 * und Tastatur auf den Spaltenkopf mit aria-sort, Sortierung in der Adresse (`sort`, `dir`).
 * Unter 768 px rendert sie stattdessen Karten über `renderCard`.
 *
 * Gefiltert wird auf dem Server (Adresse -> Abfrage); `rows` ist bereits gefiltert. Ohne
 * `sort` in der Adresse bleibt die Reihenfolge des Servers (Standardsortierung der Ansicht).
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  renderCard,
  rowClassName,
}: {
  caption: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  rows: T[];
  rowKey: (row: T) => string;
  renderCard: (row: T) => React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sorting: SortingState = useMemo(() => {
    const key = searchParams.get("sort");
    if (!key || !columns.some((c) => c.id === key)) return [];
    return [{ id: key, desc: searchParams.get("dir") !== "asc" }];
  }, [searchParams, columns]);

  // TanStack liefert nicht memoisierbare Funktionen; der React Compiler überspringt die Komponente.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    getRowId: (row) => rowKey(row),
    manualFiltering: true,
    enableSortingRemoval: true,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      router.replace(
        withParams(pathname, new URLSearchParams(searchParams.toString()), {
          sort: s?.id,
          dir: s ? (s.desc ? "desc" : "asc") : undefined,
          seite: searchParams.get("seite") ?? undefined,
        }),
        { scroll: false },
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const sortedRows = table.getRowModel().rows;

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl bg-papier shadow-[0_1px_2px_rgb(26_39_68/0.06),0_4px_16px_-8px_rgb(26_39_68/0.12)] md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const label = flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={cn(
                        "h-10 px-3 font-heading text-xs font-semibold tracking-wide text-ink-soft",
                        meta?.align === "right" ? "text-right" : "text-left",
                        meta?.className,
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "relative inline-flex items-center gap-1 rounded-sm hover:text-rheinblau",
                            "after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']",
                            sorted && "text-rheinblau",
                            meta?.align === "right" && "flex-row-reverse",
                          )}
                        >
                          {label}
                          {sorted === "asc" ? (
                            <ChevronUpIcon aria-hidden="true" className="size-3.5" />
                          ) : sorted === "desc" ? (
                            <ChevronDownIcon aria-hidden="true" className="size-3.5" />
                          ) : (
                            <ChevronsUpDownIcon aria-hidden="true" className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "h-10 border-b border-border/70 last:border-b-0 hover:bg-surface/70",
                  rowClassName?.(row.original),
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 py-1.5 align-middle",
                        meta?.align === "right" && "text-right",
                        meta?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="space-y-3 md:hidden">
        {sortedRows.map((row) => (
          <li key={row.id} className="rounded-xl bg-papier p-4 shadow-[0_1px_2px_rgb(26_39_68/0.06),0_4px_16px_-8px_rgb(26_39_68/0.12)]">
            {renderCard(row.original)}
          </li>
        ))}
      </ul>
    </>
  );
}
