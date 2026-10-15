/**
 * Abgleich-Stempel: zeigt je Quelle, wann zuletzt abgeglichen wurde. Der Abgleich entsteht erst in
 * Phase 5; bis dahin gibt es keine Quellen und der Stempel nennt das offen.
 */
export type SyncSourceState = {
  label: string;
  lastSuccessAt: Date | null;
  lastError: { at: Date; message: string } | null;
};

export function SyncStamp({ sources = [] }: { sources?: SyncSourceState[] }) {
  return (
    <p className="text-xs text-ink-soft">
      <span className="font-medium text-fassholz">Abgleich:</span>{" "}
      {sources.length === 0 ? "Noch kein Abgleich" : sources.map((s) => s.label).join(", ")}
    </p>
  );
}
