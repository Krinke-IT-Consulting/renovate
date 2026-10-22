import Link from "next/link";
import { ActionResult } from "@/components/actions/confirm-action";
import { MERGE_RESULT_KEY } from "@/components/actions/merge-action";
import { RepoGrid, Metrics } from "@/components/overview/side-panel";
import { StepList } from "@/components/overview/step-list";
import { buildReport, buildSteps, shortName, type ReportSegment } from "@/domain/report";
import { getDb } from "@/db/client";
import { parseText, withParams, type RawSearchParams } from "@/lib/search-params";
import { loadOverview } from "@/queries/overview";

export const dynamic = "force-dynamic";

function ReportParagraph({ segments }: { segments: ReportSegment[] }) {
  return (
    <p className="max-w-[60ch] text-xl break-words leading-relaxed text-ink text-pretty sm:text-2xl sm:leading-relaxed">
      {segments.map((s, i) =>
        "href" in s ? (
          <Link
            key={i}
            href={s.href}
            className="font-semibold text-rheinblau underline decoration-logo-gruen decoration-2 underline-offset-[6px] hover:decoration-rheinblau"
          >
            {s.text}
          </Link>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const data = await loadOverview(getDb());
  const allSteps = buildSteps(data.report);
  const report = buildReport(data.report, allSteps);

  const repoFilter = parseText(sp, "repo");
  const steps = repoFilter ? allSteps.filter((s) => s.repoFullName === repoFilter) : allSteps;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
      <div className="min-w-0">
        <h1 className="mb-4 text-2xl font-bold sm:text-3xl">Lagebericht</h1>
        <ReportParagraph segments={report.segments} />

        {repoFilter ? (
          <p className="mt-6 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
            <span>
              Schritte für <span className="font-semibold text-ink">{shortName(repoFilter)}</span>
              {steps.length === 0 ? ": nichts offen." : ""}
            </span>
            <Link
              href={withParams("/", sp, { repo: undefined })}
              scroll={false}
              className="inline-flex min-h-11 items-center font-medium text-olive underline underline-offset-4 hover:text-rheinblau"
            >
              Filter aufheben
            </Link>
          </p>
        ) : null}

        <div className="mt-8">
          {/* key: Beim Wechsel des Repo-Filters beginnt die Liste neu (kein "erledigt" durch Filtern). */}
          <ActionResult resultKey={MERGE_RESULT_KEY} />
          <StepList key={repoFilter ?? "alle"} steps={steps} />
        </div>
      </div>

      <aside aria-label="Kennzahlen und Repos" className="space-y-8">
        <Metrics m={data.metrics} />
        {data.tiles.length > 0 ? <RepoGrid tiles={data.tiles} selected={repoFilter} searchParams={sp} /> : null}
      </aside>
    </div>
  );
}
