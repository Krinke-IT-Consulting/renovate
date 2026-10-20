import Link from "next/link";
import { ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import { StatusText } from "@/components/status/status";
import { STEP_GROUPS, type Step, type StepGroup } from "@/domain/report";
import type { StatusTone } from "@/domain/status-tone";

const GROUP_TONE: Record<StepGroup, StatusTone> = {
  security: "fehler",
  failure: "fehler",
  major: "warnung",
  onboarding: "warnung",
  stale: "warnung",
};

const ACTION =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-olive px-4 text-sm font-semibold text-papier transition-colors hover:bg-rheinblau";

/**
 * "Was hier zu tun ist" für ein Repo: dieselben Schritte wie im Lagebericht, auf einer Leiterbahn
 * wie im Logo. Ein Schritt, dessen Ziel die Seite selbst wäre (Onboarding), zeigt keinen Knopf; die
 * Aktion dafür kommt mit Phase 7.
 */
export function RepoSteps({ steps }: { steps: Step[] }) {
  const ordered = STEP_GROUPS.flatMap((g) => steps.filter((s) => s.group === g));
  return (
    <ol className="relative space-y-2">
      <span aria-hidden="true" className="absolute top-4 bottom-4 left-[15px] w-0.5 rounded-full bg-rheinblau/25" />
      {ordered.map((s, i) => {
        const { action } = s;
        // Interne Ziele unter /repos/ wären diese Seite selbst.
        const showAction = action.external || !action.href.startsWith("/repos/");
        return (
          <li key={s.id} className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="relative z-10 mt-3 grid size-8 shrink-0 place-items-center rounded-full bg-rheinblau font-heading text-sm font-semibold text-papier tabular-nums ring-4 ring-surface"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl bg-papier px-4 py-3 shadow-[0_1px_2px_rgb(26_39_68/0.06),0_4px_16px_-8px_rgb(26_39_68/0.12)] sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-ink">
                  <span className="sr-only">Schritt {i + 1}: </span>
                  <span className="break-words">{s.title}</span>
                  {s.version ? (
                    <span className="ml-2 font-mono text-sm font-medium whitespace-nowrap text-rheinblau">{s.version}</span>
                  ) : null}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
                  <StatusText tone={GROUP_TONE[s.group]}>{s.typeLabel}</StatusText>
                  {s.detail.map((d) => (
                    <span key={d} className="contents">
                      <span aria-hidden="true">·</span>
                      <span>{d}</span>
                    </span>
                  ))}
                </p>
              </div>
              {showAction ? (
                action.external ? (
                  <a href={action.href} target="_blank" rel="noopener noreferrer" className={ACTION}>
                    {action.label}
                    <ExternalLinkIcon aria-hidden="true" className="size-4" />
                    <span className="sr-only"> (öffnet in neuem Tab)</span>
                  </a>
                ) : (
                  <Link href={action.href} className={ACTION}>
                    {action.label}
                    <ArrowRightIcon aria-hidden="true" className="size-4" />
                  </Link>
                )
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
