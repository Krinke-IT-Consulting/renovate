"use client";

import { Fragment, useMemo } from "react";
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
 * Sortiert wird clientseitig über die Zeilen, die die Tabelle bekommt; bei paginierten Listen
 * würde das nur die aktuelle Seite ordnen, dort setzt die Seite `manualSorting` und sortiert vor
 * dem Schneiden selbst.
 *
 * Optional `renderExpanded`: liefert Zusatzinhalt (z. B. Log-Auszug) oder null. Der Inhalt steht
 * in einer eigenen Zeile direkt unter der Zeile (über alle Spalten) bzw. unter der Karte. Der
 * zweite Parameter nennt das Layout, damit IDs je Layout eindeutig bleiben (beide Layouts stehen
 * im DOM, eines davon ist per CSS ausgeblendet). Ohne den Prop ändert sich nichts.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  renderCard,
  rowClassName,
  renderExpanded,
  manualSorting = false,
}: {
  caption: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  rows: T[];
  rowKey: (row: T) => string;
  renderCard: (row: T) => React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
  renderExpanded?: (row: T, layout: "table" | "card") => React.ReactNode | null;
  /**
   * Die Zeilen sind bereits nach `sort`/`dir` der Adresse sortiert (paginierte Listen, Sortierung
   * auf dem Server). Die Tabelle übernimmt die Reihenfolge; Spaltenköpfe, `aria-sort` und das
   * Schreiben in die Adresse bleiben gleich.
   */
  manualSorting?: boolean;
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
    manualSorting,
    enableSortingRemoval: true,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      router.replace(
        withParams(pathname, new URLSearchParams(searchParams.toString()), {
          sort: s?.id,
          dir: s ? (s.desc ? "desc" : "asc") : undefined,
          // Server sortiert über alle Seiten: Neue Sortierung beginnt auf Seite 1.
          seite: manualSorting ? undefined : (searchParams.get("seite") ?? undefined),
        }),
        { scroll: false },
      );
    },
    getCoreRowModel: getCoreRowModel(),
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
  });

  const sortedRows = table.getRowModel().rows;

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl bg-papier shadow-karte md:block">
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
            {sortedRows.map((row) => {
              const expanded = renderExpanded?.(row.original, "table") ?? null;
              return (
                <Fragment key={row.id}>
                  <tr
                    className={cn(
                      "h-11 border-b border-border/70 last:border-b-0 hover:bg-surface/70",
                      expanded && "border-b-0",
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
                  {expanded ? (
                    <tr className="border-b border-border/70 last:border-b-0">
                      <td colSpan={row.getVisibleCells().length} className="px-3 pt-0 pb-3">
                        {expanded}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul aria-label={caption} className="space-y-3 md:hidden">
        {sortedRows.map((row) => (
          <li key={row.id} className="rounded-xl bg-papier p-4 shadow-karte">
            {renderCard(row.original)}
            {renderExpanded?.(row.original, "card") ?? null}
          </li>
        ))}
      </ul>
    </>
  );
}
