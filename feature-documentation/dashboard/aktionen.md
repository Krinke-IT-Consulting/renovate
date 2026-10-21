# Dashboard: Aktionen in der Oberfläche (Phase 7, Tasks 7.1, 7.2, 7.4 Markierung, 7.5 Schalter)

Status: umgesetzt auf dem Branch `feat/dashboard-aktionen`. Spec: `openspec/changes/dashboard/specs/dashboard-actions/spec.md`,
Entscheidung 10 in `design.md`. Die Rollout-Logik (Onboarding- und Build-Check-PRs, automatisches Onboarding im Abgleich)
baut ein paralleler Strang gegen den Vertrag `dashboard/src/rollout/types.ts`.

## 1. Ablauf einer Aktion

1. Der Knopf (`ConfirmAction`, `dashboard/src/components/actions/confirm-action.tsx`) öffnet einen `AlertDialog`
   (`components/ui/alert-dialog.tsx`, shadcn auf `radix-ui`). Der Dialog nennt Titel und Wirkung in einem Satz.
2. „Abbrechen“ (oder Escape) schließt den Dialog und ruft nichts auf. Es entsteht kein AuditLog-Eintrag.
3. „Bestätigen“ (benannt mit der Aktion) sendet ein Formular, dessen Action die Server Action ist (`useActionState`).
   Das Formular liegt außerhalb des Dialogs; der Bestätigen-Knopf löst `requestSubmit()` aus.
4. Während der Ausführung trägt der Knopf „Wird ausgeführt …“ und ist `aria-disabled` (bewusst nicht `disabled`,
   damit der Fokus nach dem Schließen des Dialogs nicht verloren geht).
5. Das Ergebnis steht inline unter dem Knopf: `role="status"` bei Erfolg (mit Link auf den PR oder die Job-Ansicht),
   `role="alert"` bei Fehlern. Status ist nie nur Farbe (`StatusText` mit Symbol).

Next prüft bei Server Actions selbst die Herkunft (Origin gegen Host); es gibt dafür keine eigene Konfiguration.
Der Nutzer kommt ausschließlich aus dem Header `x-dashboard-user` (`src/actions/context.ts`, `requireActor`). Ohne
Nutzer wird die Aktion abgelehnt.

## 2. Dateien

| Datei | Aufgabe |
|---|---|
| `src/actions/result.ts` | `ActionState` (idle, done mit Ton und Link, error), `ActionError`, `runAction`. Nur `ActionError`-Texte erreichen die Oberfläche; alles andere ergibt die feste Meldung `FALLBACK_ERROR`, im Log steht nur der Fehlername. |
| `src/actions/context.ts` | `requireActor()` aus `x-dashboard-user`. |
| `src/actions/audit.ts` | `writeAudit(dbOrTx, { actor, action, target })`. |
| `src/actions/deps.ts` | `getCeClientFromEnv()`: baut den CE-Client aus dem Env-Schema, unabhängig vom Scheduler. Fehlermeldung nennt nur Variablennamen. |
| `src/actions/core/*.ts` | Reine Logik mit eingespritzter Datenbank und Client (`jobs`, `repos`, `settings`, `rollout`). Hier wird getestet. |
| `src/actions/{jobs,repos,settings,rollout}.ts` | Server Actions (`"use server"`), dünne Hüllen: Nutzer lesen, Kern aufrufen, `revalidatePath("/", "layout")`. |
| `src/rollout/registry.ts` | `getRolloutServiceForActions()`; die einzige Stelle, die entscheidet, welche Rollout-Implementierung dahinter steckt. |
| `src/rollout/service.ts` | **Platzhalter**, liefert `failed` mit „Noch nicht verfügbar.“. Beim Merge gewinnt die echte `service.ts` des Rollout-Strangs. |
| `src/queries/runnable-repos.ts` | Onboardete, nicht archivierte, nicht entfernte Repos (Anzahl für den Dialog, Liste für den Sammellauf). |
| `src/queries/connections.ts` | Owner mit Schalter für automatisches Onboarding. |

Die Server Actions nehmen ihr Ziel per `bind` vor: `triggerRepoRun.bind(null, repositoryId)` ist eine Formularaktion
für `useActionState`; der bisherige Zustand und die Formulardaten, die React danach übergibt, braucht keine Action.

## 3. Server Actions

| Signatur | Wirkung | AuditLog |
|---|---|---|
| `triggerRepoRun(repositoryId)` | CE `addJob(full_name)`. `inserted`: „Lauf eingereiht.“ mit Link auf `/jobs?repo=<full_name>`. `unchanged`: „Für dieses Repo wartet oder läuft bereits ein Lauf.“ Nur für onboardete, nicht archivierte, nicht entfernte Repos. | `job.trigger`, Ziel: Repo (auch bei `unchanged`: die Aktion wurde ausgeführt, es entsteht aber kein zweiter Job) |
| `triggerAllRuns()` | `addJob` je Repo, vier gleichzeitig. Meldung nennt eingereihte, unveränderte und fehlgeschlagene Repos. Fehlschlag bei allen: Fehlermeldung. | `job.trigger_all`, Ziel: `<n> Repos` |
| `setOwnCi(repositoryId, value)` | Setzt `repositories.own_ci`, leitet `build_check_status` mit `deriveBuildCheckStatus` neu ab (`active` = Aufrufdatei liegt im Repo, offener Rollout = Zeile in `rollout_actions` oder Status `pr_open`). Beim Setzen: offenes `missing_build_check` bekommt `resolved_at`. Eine Transaktion. | `repo.own_ci`, Ziel: `<Repo>: eigene CI an` bzw. `aus` |
| `setAutoOnboarding(connectionId, enabled)` | Setzt das Flag; beim Einschalten `auto_onboarding_enabled_at = now`, beim Ausschalten bleibt der Zeitpunkt. Gleicher Zustand: Hinweis, kein Eintrag. Nur Flag und Zeitpunkt, die Wirkung liegt im Abgleich (Rollout-Strang). | `settings.auto_onboarding`, Ziel: `<Owner>: an` bzw. `aus` |
| `createOnboardingPr(repositoryId)`, `createBuildCheckPr(repositoryId)` | Rufen `getRolloutServiceForActions().run({ repositoryId, kind, actor })` und bilden das `RolloutOutcome` ab: `created` und `existing` mit PR-Link (extern, nur https), `not_needed` mit `message`, `failed` mit `message`. | legt die Rollout-Logik selbst an (zusammen mit der RolloutAction) |

Alle Eingaben (UUIDs) prüft zod. Fehlermeldungen nennen nie Werte aus Tokens oder Rohantworten: CE-Fehler erscheinen als
„Renovate CE hat die Anfrage abgelehnt (Status 401).“ bzw. „Renovate CE ist nicht erreichbar.“.

### eigene CI und `missing_build_check`

`domain/problems.ts` meldet `missing_build_check` nur bei `onboarding = onboarded` und `build_check = missing`. Mit
Markierung ist der Status `own_ci`, der Abgleich (`sync/problems-sync.ts`) öffnet das Problem also nicht wieder. Beim
Aufheben gilt der Build-Check wieder als `missing`; das Problem entsteht beim nächsten Abgleich neu (Test dazu in
`src/actions/core/core.test.ts`).

## 4. Wo die Knöpfe stehen

- **Repo-Detail**, Leiste unter dem Kopf (`components/repos/repo-actions.tsx`): „Lauf starten“ (onboardet), „Onboarding-PR
  anlegen“ (Onboarding `none`), „Build-Check ausrollen“ (onboardet und Build-Check `missing`), „Als eigene CI markieren“
  bzw. „Markierung ‚eigene CI‘ aufheben“. Archivierte Repos zeigen keinen Lauf- und Rollout-Knopf, entfernte keine Leiste.
  Ab `sm` steht die Meldung unter der ganzen Knopfreihe, mobil unter dem jeweiligen Knopf (`layout="row"`).
- **Lagebericht und Repo-Detail, Abschnitt „Was hier zu tun ist“:** Der Onboarding-Schritt hat die Aktion
  `{ kind: "onboarding", repositoryId, repoFullName }` (`domain/report.ts`, `StepAction`) und rendert `OnboardingAction`
  statt „Zum Repo“. Ohne `id` im `ReportRepo` fällt der Schritt auf den Link zurück.
- **Jobs**, Seitenkopf: „Alle Repos laufen lassen“ (`PageHeader` hat dafür den Slot `action`). Der Dialog nennt die Anzahl.
- **Repos**, Abschnitt „Automatisches Onboarding“ (`components/repos/auto-onboarding.tsx`): je Owner ein Knopf mit
  `aria-pressed`, sichtbar „An“ oder „Aus“, mit Bestätigung.

## 5. Tests

- `src/actions/core/core.test.ts` (Postgres, ohne `DATABASE_URL` übersprungen): Einzel- und Sammellauf gegen einen
  Fake-CE-Client, `unchanged` erzeugt keinen zweiten Job, Fehlerfälle ohne AuditLog, eigene CI inklusive Abgleich,
  Schalter, Abbildung von `RolloutOutcome`.
- `src/actions/actions.test.ts`: `requireActor`, `runAction` (keine Fehlertexte nach außen).
- `src/domain/report.test.ts`: Aktionsart des Onboarding-Schritts.
- Playwright `e2e/aktionen.spec.ts` gegen `e2e/fake-ce.mjs` (beantwortet `POST /system/v1/jobs/add` mit `inserted`, danach
  `unchanged`; prüft das Bearer-Secret; `/__reset` und `/__calls` für die Tests). Port über `E2E_CE_PORT` (Standard 9291).
  Das Secret `e2e-secret` ist erfunden und steht nur in `playwright.config.ts`. Der Abgleich startet im E2E nicht, weil
  die GitHub-Variablen leer sind. Der Rollout ist im E2E der Platzhalter: getestet wird, dass dessen Meldung erscheint.
