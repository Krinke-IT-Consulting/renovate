import { HeaderSkeleton, TableSkeleton } from "@/components/data/table-skeleton";

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <TableSkeleton label="Jobs werden geladen" />
    </>
  );
}
