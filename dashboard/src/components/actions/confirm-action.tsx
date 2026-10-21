"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ExternalLink } from "@/components/data/external-link";
import { StatusText } from "@/components/status/status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { IDLE, type ActionState } from "@/actions/result";
import { cn } from "@/lib/utils";

/** Server Action als Formularaktion; `bind` belegt die Argumente vor (Repo, Owner usw.). */
export type ConfirmableAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type ConfirmActionProps = {
  action: ConfirmableAction;
  /** Beschriftung des Knopfs, der den Dialog öffnet. */
  label: React.ReactNode;
  /** Titel des Dialogs. */
  title: string;
  /** Die Wirkung in einem Satz, etwa "Renovate CE reiht für a/b einen Lauf ein.". */
  effect: string;
  /** Beschriftung des Bestätigen-Knopfs: benannt mit der Aktion. */
  confirmLabel: string;
  /** primary: Hauptaktion in Olive; quiet: Nebenaktion ohne Fläche. */
  variant?: "primary" | "quiet";
  /** Knopf füllt die Breite (mobile Karten). */
  wide?: boolean;
  /**
   * stack: Meldung unter dem Knopf. row: für eine umbrechende Knopfreihe als Elternelement
   * (flex-wrap, ohne Zeilenabstand); ab sm steht die Meldung unter der ganzen Reihe, davor unter
   * dem Knopf.
   */
  layout?: "stack" | "row";
  /** Zustand des Schalters für Screenreader (aria-pressed), nur bei Schaltern. */
  pressed?: boolean;
  /**
   * Ergebnis unter diesem Schlüssel in den Ergebnisspeicher schreiben, statt es unter dem Knopf zu
   * zeigen. Gedacht für Aktionen, nach denen der Knopf verschwindet (Seite wird neu gerendert,
   * `ConfirmAction` hängt aus, der `useActionState`-Zustand ginge verloren). Die Meldung zeigt dann
   * ein dauerhaft eingehängtes `ActionResult` mit demselben Schlüssel.
   */
  resultKey?: string;
  className?: string;
};

// Ergebnisspeicher im Modul: überlebt das Aushängen der Komponente. Geschrieben wird in der
// Aktion selbst (nicht in einem Effekt), sonst käme die Meldung nach dem Neurendern zu spät.
const results = new Map<string, ActionState>();
const listeners = new Set<() => void>();

function setResult(key: string, state: ActionState | null) {
  if (state) results.set(key, state);
  else results.delete(key);
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const VARIANT = {
  primary: "bg-olive text-papier hover:bg-rheinblau aria-disabled:hover:bg-olive",
  quiet: "text-ink ring-1 ring-rheinblau-tief/55 ring-inset hover:text-rheinblau hover:ring-rheinblau",
} as const;

function Message({ state, layout }: { state: ActionState; layout: "stack" | "row" }) {
  const margin = layout === "row" ? "mt-2 sm:mt-0 sm:mb-3" : "mt-2";
  if (state.status === "error") {
    return (
      <p role="alert" className={cn(margin, "max-w-prose")}>
        <StatusText tone="fehler" className="items-start">
          <span>{state.message}</span>
        </StatusText>
      </p>
    );
  }
  if (state.status !== "done") return null;
  const link = state.link;
  return (
    <p className={cn(margin, "flex max-w-prose flex-wrap items-center gap-x-3 gap-y-1")}>
      <StatusText tone={state.tone} className="items-start">
        <span>{state.message}</span>
      </StatusText>
      {link ? (
        link.external ? (
          <ExternalLink href={link.href} className="min-h-11 text-sm">
            {link.label}
          </ExternalLink>
        ) : (
          <Link
            href={link.href}
            className="inline-flex min-h-11 items-center text-sm font-medium text-rheinblau underline decoration-rheinblau/30 underline-offset-4 hover:decoration-rheinblau"
          >
            {link.label}
          </Link>
        )
      ) : null}
    </p>
  );
}

/**
 * Zeigt das Ergebnis der Aktionen mit `resultKey`. Bleibt eingehängt, auch wenn der Knopf nach dem
 * Erfolg verschwindet. Die Region (`role="status"`) existiert immer, damit Screenreader die
 * Meldung ansagen; beim Verlassen der Seite wird das Ergebnis verworfen.
 */
export function ActionResult({ resultKey, layout = "stack" }: { resultKey: string; layout?: "stack" | "row" }) {
  const state = useSyncExternalStore(
    subscribe,
    () => results.get(resultKey) ?? IDLE,
    () => IDLE,
  );
  useEffect(() => () => setResult(resultKey, null), [resultKey]);
  const wide = layout === "row" ? "w-full" : undefined;
  return (
    <>
      <div role="status" className={cn("text-sm", wide)}>
        {state.status === "done" ? <Message state={state} layout={layout} /> : null}
      </div>
      {state.status === "error" ? (
        <div className={cn("text-sm", wide)}>
          <Message state={state} layout={layout} />
        </div>
      ) : null}
    </>
  );
}

/**
 * Aktion mit Folgen (uebersicht-entwurf.md, Abschnitt 6): Knopf, Bestätigungsdialog mit Wirkung,
 * erst danach wird die Server Action aufgerufen. Abbrechen ruft nichts auf. Das Ergebnis steht
 * inline unter dem Knopf: `role="status"` bei Erfolg, `role="alert"` bei Fehlern.
 *
 * Der Knopf bleibt während der Ausführung fokussierbar (aria-disabled statt disabled), damit der
 * Fokus nach dem Schließen des Dialogs nicht verloren geht.
 */
export function ConfirmAction({
  action,
  label,
  title,
  effect,
  confirmLabel,
  variant = "primary",
  wide = false,
  pressed,
  layout = "stack",
  resultKey,
  className,
}: ConfirmActionProps) {
  const [state, formAction, pending] = useActionState(
    resultKey
      ? async (prev: ActionState, formData: FormData) => {
          setResult(resultKey, null);
          const next = await action(prev, formData);
          setResult(resultKey, next);
          return next;
        }
      : action,
    IDLE,
  );
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className={cn("flex min-w-0 flex-col items-start", wide && "w-full", layout === "row" && "mb-3 sm:contents", className)}>
      {/* Das Formular liegt außerhalb des Dialogs (der in ein Portal rendert); der Bestätigen-Knopf sendet es ab. */}
      <form ref={formRef} action={formAction} className="hidden" />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            aria-disabled={pending}
            aria-pressed={pressed}
            onClick={(e) => {
              if (pending) e.preventDefault();
            }}
            className={cn(BASE, VARIANT[variant], wide && "w-full", layout === "row" && "sm:mb-3")}
          >
            {pending ? "Wird ausgeführt …" : label}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{effect}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={cn(BASE, VARIANT.quiet)}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className={cn(BASE, VARIANT.primary)}
              onClick={() => formRef.current?.requestSubmit()}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {resultKey ? null : (
        <>
          <div role="status" className={cn("text-sm", layout === "row" && "sm:order-last sm:basis-full")}>
            {state.status === "done" ? <Message state={state} layout={layout} /> : null}
          </div>
          {state.status === "error" ? (
            <div className={cn("text-sm", layout === "row" && "sm:order-last sm:basis-full")}>
              <Message state={state} layout={layout} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
