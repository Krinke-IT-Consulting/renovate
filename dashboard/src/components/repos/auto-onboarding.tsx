import { setAutoOnboarding } from "@/actions/settings";
import { ConfirmAction } from "@/components/actions/confirm-action";
import { StatusText } from "@/components/status/status";
import { formatDate } from "@/lib/format";
import type { OwnerSetting } from "@/queries/connections";

/**
 * Schalter "Automatisches Onboarding" je Owner. Standard ist aus. Der Schalter ist ein Knopf mit
 * `aria-pressed`, sichtbar beschriftet mit "An" bzw. "Aus"; geändert wird erst nach Bestätigung.
 */
export function AutoOnboarding({ owners }: { owners: OwnerSetting[] }) {
  if (owners.length === 0) return null;
  return (
    <section aria-labelledby="auto-onboarding" className="mt-10">
      <h2 id="auto-onboarding" className="text-lg font-semibold">
        Automatisches Onboarding
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        Neu hinzukommende Repos dieses Owners bekommen beim nächsten Abgleich automatisch einen Onboarding-PR.
        Bestehende Repos sind ausgenommen.
      </p>
      <ul className="mt-3 space-y-2">
        {owners.map((o) => (
          <li
            key={o.connectionId}
            className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 rounded-xl bg-papier px-4 py-3 shadow-karte"
          >
            <div className="min-w-0">
              <p className="font-semibold [overflow-wrap:anywhere]">{o.owner}</p>
              <p className="mt-0.5 text-sm text-ink-soft">
                <StatusText tone={o.autoOnboarding ? "erfolg" : "neutral"}>{o.autoOnboarding ? "An" : "Aus"}</StatusText>
                {o.autoOnboarding && o.autoOnboardingEnabledAt ? (
                  <span> seit {formatDate(o.autoOnboardingEnabledAt)}</span>
                ) : null}
              </p>
            </div>
            <ConfirmAction
              action={setAutoOnboarding.bind(null, o.connectionId, !o.autoOnboarding)}
              pressed={o.autoOnboarding}
              label={
                <>
                  <span className="sr-only">Automatisches Onboarding für {o.owner}: </span>
                  {o.autoOnboarding ? "An" : "Aus"}
                </>
              }
              title={o.autoOnboarding ? "Automatisches Onboarding ausschalten?" : "Automatisches Onboarding einschalten?"}
              effect={
                o.autoOnboarding
                  ? `Neu hinzukommende Repos von ${o.owner} bekommen keinen automatischen Onboarding-PR mehr.`
                  : `Neu hinzukommende Repos von ${o.owner} bekommen beim nächsten Abgleich automatisch einen Onboarding-PR. Bestehende Repos sind ausgenommen.`
              }
              confirmLabel={o.autoOnboarding ? "Ausschalten" : "Einschalten"}
              variant="quiet"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
