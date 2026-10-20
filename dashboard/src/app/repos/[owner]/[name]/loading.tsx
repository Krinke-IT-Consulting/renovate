import { HeaderSkeleton, TableSkeleton } from "@/components/data/table-skeleton";

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <TableSkeleton rows={4} label="Repo wird geladen" />
    </>
  );
}
