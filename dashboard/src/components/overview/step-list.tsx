"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon } from "lucide-react";
import { StatusText } from "@/components/status/status";
import { cn } from "@/lib/utils";
import { STEP_GROUP_TITLE, STEP_GROUPS, shortName, type Step, type StepGroup } from "@/domain/report";
import type { StatusTone } from "@/domain/status-tone";

const GROUP_TONE: Record<StepGroup, StatusTone> = {
  security: "fehler",
  failure: "fehler",
  major: "warnung",
  onboarding: "warnung",
  stale: "warnung",
};

/** Je Gruppe sichtbar, bevor "weitere X anzeigen" erscheint. */
const VISIBLE_PER_GROUP = 5;

type ShownStep = Step & { done: boolean; no: number };

/**
 * Erledigte Schritte bleiben als Ring abgehakt stehen, bis die Seite neu geladen wird (Spec
 * dashboard-views). Erledigt heißt: Der Schritt war beim Laden der Seite da und fehlt nach einem
 * Abgleich (Auto-Refresh). Die Reihenfolge der ersten Anzeige bleibt fest, damit nichts springt.
 */
function useStepsWithDone(steps: Step[]): ShownStep[] {
  const [seen, setSeen] = useState<Step[]>(steps);
  const [lastSteps, setLastSteps] = useState(steps);
  if (steps !== lastSteps) {
    setLastSteps(steps);
    const known = new Set(seen.map((s) => s.id));
    const added = steps.filter((s) => !known.has(s.id));
    if (added.length > 0) setSeen([...seen, ...added]);
  }
  const current = new Set(steps.map((s) => s.id));
  const ordered = STEP_GROUPS.flatMap((g) => seen.filter((s) => s.group === g));
  return ordered.map((s, i) => ({ ...s, done: !current.has(s.id), no: i + 1 }));
}

function Node({ step }: { step: ShownStep }) {
  return step.done ? (
    <span
      aria-hidden="true"
      className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-papier text-olive ring-2 ring-olive ring-inset transition-colors duration-300"
    >
      <CheckIcon className="size-4" strokeWidth={2.5} />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-rheinblau font-heading text-sm font-semibold text-papier tabular-nums ring-4 ring-surface transition-colors duration-300"
    >
      {step.no}
    </span>
  );
}

function ActionLink({ step, wide = false }: { step: ShownStep; wide?: boolean }) {
  const { action } = step;
  const cls = cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors",
    step.done
      ? "text-ink-soft ring-1 ring-rheinblau-tief/15 ring-inset hover:text-rheinblau"
      : "bg-olive text-papier hover:bg-rheinblau",
    wide && "w-full",
  );
  const label = (
    <>
      {action.label}
      {action.external ? (
        <ExternalLinkIcon aria-hidden="true" className="size-4" />
      ) : (
        <ArrowRightIcon aria-hidden="true" className="size-4" />
      )}
    </>
  );
  return action.external ? (
    <a href={action.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {label}
      <span className="sr-only"> (öffnet in neuem Tab)</span>
    </a>
  ) : (
    <Link href={action.href} className={cls}>
      {label}
    </Link>
  );
}

function StepBody({ step }: { step: ShownStep }) {
  return (
    <div className={cn("min-w-0", step.done && "opacity-60")}>
      <p className="text-base font-semibold text-ink">
        <span className="break-words">{step.title}</span>
        {step.version ? (
          <span className="ml-2 font-mono text-sm font-medium text-rheinblau whitespace-nowrap">{step.version}</span>
        ) : null}
        {step.done ? <span className="ml-2 text-sm font-medium text-olive">Erledigt</span> : null}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
        <StatusText tone={step.done ? "erfolg" : GROUP_TONE[step.group]}>{step.typeLabel}</StatusText>
        <span aria-hidden="true">·</span>
        <Link
          href={`/repos/${step.repoFullName}`}
          className="font-medium text-ink underline decoration-rheinblau-tief/20 underline-offset-4 hover:text-rheinblau hover:decoration-rheinblau"
        >
          {shortName(step.repoFullName)}
        </Link>
        {step.detail.map((d) => (
          <span key={d} className="contents">
            <span aria-hidden="true">·</span>
            <span>{d}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

/** Desktop: Gruppen untereinander, Schritte auf einer durchgehenden Leiterbahn wie im Logo. */
function GroupedSteps({ shown }: { shown: ShownStep[] }) {
  const [expanded, setExpanded] = useState<Set<StepGroup>>(new Set());
  const groups = STEP_GROUPS.map((g) => ({ g, items: shown.filter((s) => s.group === g) })).filter(
    (x) => x.items.length > 0,
  );

  return (
    <div className="relative">
      {/* Leiterbahn: läuft hinter allen Knoten durch, endet am letzten. */}
      <span aria-hidden="true" className="absolute top-4 bottom-4 left-[15px] w-0.5 rounded-full bg-rheinblau/25" />
      {groups.map(({ g, items }) => {
        const open = expanded.has(g);
        // Nur kürzen, wenn sich das Aufklappen lohnt (nie "weitere 1").
        const visible = open || items.length <= VISIBLE_PER_GROUP + 2 ? items : items.slice(0, VISIBLE_PER_GROUP);
        const hidden = items.length - visible.length;
        return (
          <section key={g} aria-labelledby={`gruppe-${g}`} className="relative pb-6 last:pb-0">
            <h2 id={`gruppe-${g}`} className="flex items-center gap-3 pb-3 text-base font-semibold">
              <span aria-hidden="true" className="relative z-10 grid size-8 place-items-center">
                <span className="size-2.5 rounded-full bg-rheinblau ring-4 ring-surface" />
              </span>
              {STEP_GROUP_TITLE[g]}
              <span className="font-sans text-sm font-medium text-ink-soft tabular-nums">{items.length}</span>
            </h2>
            <ol className="space-y-2">
              {visible.map((s) => (
                <li key={s.id} className="flex items-start gap-4">
                  <span className="pt-3">
                    <Node step={s} />
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-4 rounded-xl bg-papier px-4 py-3 shadow-[0_1px_2px_rgb(26_39_68/0.06),0_4px_16px_-8px_rgb(26_39_68/0.12)]">
                    <div className="min-w-0 flex-1">
                      <span className="sr-only">Schritt {s.no}: </span>
                      <StepBody step={s} />
                    </div>
                    <ActionLink step={s} />
                  </div>
                </li>
              ))}
            </ol>
            {hidden > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(new Set(expanded).add(g))}
                className="mt-2 ml-12 inline-flex min-h-11 items-center text-sm font-medium text-olive underline underline-offset-4 hover:text-rheinblau"
              >
                weitere {hidden} anzeigen
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** Mobil: ein Schritt füllt den Bildschirm, der nächste liegt einen Wisch entfernt. */
function SwipeSteps({ shown }: { shown: ShownStep[] }) {
  return (
    <div>
      <p className="mb-2 text-sm text-ink-soft">
        {shown.length} {shown.length === 1 ? "Schritt" : "Schritte"}, zum nächsten wischen
      </p>
      <ol
        aria-label="Offene Schritte"
        className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-3 [scrollbar-width:none]"
      >
        {shown.map((s) => (
          <li
            key={s.id}
            className="relative flex min-h-72 w-[calc(100vw-3rem)] max-w-md shrink-0 snap-start flex-col rounded-xl bg-papier p-5 shadow-[0_1px_2px_rgb(26_39_68/0.06),0_4px_16px_-8px_rgb(26_39_68/0.12)]"
          >
            <div className="flex items-center gap-3">
              <Node step={s} />
              <span className="text-sm font-medium text-ink-soft">
                Schritt {s.no} von {shown.length} · {STEP_GROUP_TITLE[s.group]}
              </span>
            </div>
            <div className="mt-4 flex-1">
              <StepBody step={s} />
            </div>
            <div className="mt-6">
              <ActionLink step={s} wide />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StepList({ steps }: { steps: Step[] }) {
  const shown = useStepsWithDone(steps);
  if (shown.length === 0) return null;
  return (
    <>
      <div className="hidden md:block">
        <GroupedSteps shown={shown} />
      </div>
      <div className="md:hidden">
        <SwipeSteps shown={shown} />
      </div>
    </>
  );
}
