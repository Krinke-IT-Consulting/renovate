import { HeaderSkeleton, TableSkeleton } from "@/components/data/table-skeleton";

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <TableSkeleton rows={12} label="Repos werden geladen" />
    </>
  );
}
