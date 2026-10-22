# Dashboard: Einstieg und Index

Stand: 2026-10-22. Diese Dateien dokumentieren das Dashboard unter `dashboard/` (Paket `krinke-it-update-zentrale`),
die Oberfläche zur Renovate-CE-Instanz. Grundlage ist der OpenSpec-Change `dashboard` (`openspec/changes/dashboard/`).
Alle Aussagen wurden am Code abgeleitet; Lücken stehen als `TODO` im jeweiligen Dokument.

Für KI-Coding-Agenten: Zuerst diese Seite, dann das Dokument zum jeweiligen Thema. Die Entscheidungen stehen in
`openspec/changes/dashboard/design.md`, die Anforderungen in `openspec/changes/dashboard/specs/`.

## 1. Index

| Datei | Inhalt |
|---|---|
| `README.md` | Dieser Einstieg: Index, Ordnerstruktur von `dashboard/src`, Request-Pfad. |
| `betrieb.md` | Aufbau und Betrieb: ein Container, Startablauf, Dockerfile, Healthcheck, Env-Schema, Vertrauensgrenze, Ressourcen. |
| `datenmodell.md` | Alle Tabellen aus `dashboard/src/db/schema.ts`, Enums, Indizes, Löschverhalten, Migrationen und Ablauf. |
| `abgleich.md` | Abgleich mit GitHub und Renovate CE: Intervalle, Locks, Head-SHA-Gating, ETag-Cache, Kontingent-Pause, Probleme, Stempel. |
| `ansichten.md` | Seiten `/`, `/repos`, `/repos/[owner]/[name]`, `/pull-requests`, `/jobs`, `/probleme` mit Adressparametern (Phase 6). |
| `ansichten-entwurf.md` | Entwurf der Ansichten vor dem Bau (Task 6.1). |
| `lagebericht.md` | Startseite `/` als Lagebericht: Schritte, Erledigt-Logik, Textbausteine, Kennzahlen. |
| `bausteine.md` | Gemeinsame UI-Bausteine: Status-Töne, `DataTable`, Filter, Suche, Abgleich-Stempel, Auto-Refresh. |
| `aktionen.md` | Aktionen in der Oberfläche: Bestätigungsdialog, Server Actions, AuditLog, Schalter (Phase 7). |
| `merge.md` | Mergen im Dashboard (Change `dashboard-pr-merge`): Einzel- und Sammel-Merge, Live-Prüfung, Merge-Methoden, Plattform-Antworten, AuditLog, Grenzen, Tests. |
| `rollout.md` | Rollout-Logik: Onboarding- und Build-Check-PRs über die Git-Data-API, automatisches Onboarding. |
| `tests-und-fixtures.md` | Vitest-Tests, Fixtures in `src/db/fixtures.ts`, Playwright-Smoke, lokale Docker-Postgres, CI. |
| `vorbereitung.md` | Versionen (Task 1.1), geprüfte CE-Endpunkte (Task 1.2), Rechte der GitHub App (Task 1.3). |

Außerhalb dieses Ordners:

| Datei | Inhalt |
|---|---|
| `../betrieb-coolify.md` | Deployment auf Coolify, Routing, Ergebnisse des ersten Deploys (Task 4.6, Abschnitt 8), bekannte Grenzen. |
| `../secrets-register.md` | Register der Geheimnisse und Konfigurationswerte: Name, Herkunft, Zweck, Erneuerung. Keine Werte. |

## 2. Ordnerstruktur von `dashboard/src`

Die Next.js-App nutzt den App Router. Die Datei `src/proxy.ts` ist der Request-Eingang (siehe Abschnitt 3).

| Pfad | Aufgabe |
|---|---|
| `app/` | Routen des App Router: Seiten (`page.tsx`), Lade- und Fehlerzustände, `api/health/route.ts`. Die Seiten sind Server Components und lesen die Daten selbst. |
| `components/` | React-Komponenten, nach Bereichen: `shell/` (Kopf, Navigation, Stempel), `data/` (Tabelle, Filter, Suche, Seitenumbruch), `overview/`, `repos/`, `pull-requests/`, `jobs/`, `problems/`, `actions/` (Bestätigungsdialog), `status/`, `ui/` (shadcn). |
| `queries/` | Lesende Abfragen mit Drizzle, je Ansicht eine Datei (`repos.ts`, `repo-detail.ts`, `pull-requests.ts`, `jobs.ts`, `problems.ts`, `overview.ts`, `sync.ts`, `connections.ts`, `runnable-repos.ts`). Sie bekommen die Datenbank als Parameter. |
| `domain/` | Reine Ableitungen ohne I/O: Update-Typ, CI-Status, Onboarding- und Build-Check-Status, Probleme (`problems.ts`), Lagebericht-Texte (`report.ts`), Töne (`status-tone.ts`). |
| `actions/` | Server Actions (`"use server"`): `repos.ts`, `jobs.ts`, `rollout.ts`, `settings.ts` als dünne Hüllen; die Logik liegt in `actions/core/`. `audit.ts` schreibt den AuditLog, `context.ts` liest den Nutzer. |
| `rollout/` | Onboarding- und Build-Check-PRs (`service.ts`), automatisches Onboarding (`auto-onboarding.ts`), Textbausteine für PRs (`pr-text.ts`), Laufzeit und Registry. |
| `platform/` | Plattformneutrale Schicht: Typen und Fehlerklassen (`types.ts`, `errors.ts`), ETag-Cache (`http-cache.ts`, `http-cache-db.ts`), Head-SHA-Logik (`refresh.ts`), Konventionen (`renovate-files.ts`). `platform/github/` ist die GitHub-Implementierung (`adapter.ts`). |
| `ce/` | Client der Renovate-CE-API (`client.ts`), Fehler, Mapping von Gründen und Status (`mapping.ts`), Log-Auszug (`log-excerpt.ts`), Typen. |
| `sync/` | Abgleich: Scheduler und Intervalle (`scheduler.ts`), Advisory-Locks (`lock.ts`), GitHub- und CE-Durchlauf (`github-sync.ts`, `ce-sync.ts`), Probleme (`problems-sync.ts`), Rollout-Nachzug (`rollouts.ts`), Stempel (`sync-state.ts`). |
| `db/` | Schema (`schema.ts`), Pool und Drizzle-Client (`client.ts`), Migrationen (`migrate.ts`, Einstieg `migrate-cli.ts`), Gesundheitsprüfung (`health.ts`), Testdaten (`fixtures.ts`). |
| `lib/` | Hilfsfunktionen ohne Fachlogik: Sitzungsprüfung bei Authelia (`session-check.ts`), Adressparameter (`search-params.ts`), Formatierung, sichere externe Links, Log-Ansicht. |

Dazu auf oberster Ebene:

| Datei | Aufgabe |
|---|---|
| `src/env.ts` | Env-Schema, lazy gelesen (siehe `betrieb.md`). |
| `src/instrumentation.ts` | Next-Hook, startet den Abgleich einmal je Serverprozess (siehe `abgleich.md`). |
| `src/proxy.ts` | Request-Eingang: Sitzungsprüfung für jede Anfrage (siehe `betrieb.md`). |

Weitere Ordner im Projekt: `drizzle/` (Migrationen), `scripts/build-migrate.mjs` (bündelt `dist/migrate.js`),
`e2e/` (Playwright-Smoke mit Fake-Authelia und Fake-CE), `public/images/` (Logos).

## 3. Request-Pfad

1. Jede Anfrage passiert `src/proxy.ts`. Der Matcher fehlt, also gilt die Prüfung auch für statische Dateien.
2. `proxy.ts` ruft `createSessionChecker` aus `src/lib/session-check.ts` auf. Ohne Cookie wird sofort mit 403 geantwortet.
   Sonst fragt das Dashboard Authelia unter `AUTHELIA_INTERNAL_URL` (`/api/authz/forward-auth`), ob die Sitzung gültig ist.
   Positive Antworten werden 30 Sekunden gecacht.
3. Bei gültiger Sitzung entfernt `proxy.ts` die eingehenden Header `remote-user`, `remote-name`, `remote-email`,
   `remote-groups` und `x-dashboard-user` und setzt `x-dashboard-user` aus der Antwort von Authelia.
   Die Ausnahme ist `GET /api/health`; diese Anfrage geht ohne Sitzung durch.
4. Server Components unter `src/app/` holen die Datenbank über `getDb()` (`src/db/client.ts`) und lesen direkt mit
   Drizzle über `src/queries/`. Die Seiten rufen dafür keine eigene HTTP-Route auf.
5. Abgeleitete Werte (Status, Probleme, Texte) entstehen in `src/domain/` und werden in den Komponenten dargestellt.
6. Schreibende Aktionen laufen als Server Actions unter `src/actions/`. Sie lesen den Nutzer aus `x-dashboard-user`
   (`src/actions/context.ts`) und schreiben den AuditLog in derselben Transaktion.

Die Daten kommen nicht aus dem Request, sondern aus der Datenbank, die der Abgleich (`abgleich.md`) füllt.

## 4. Offene Punkte

- TODO: Ob die Coolify-Variable `DASHBOARD_PROXY_SECRET` nach Task 4.7 entfernt wurde, lässt sich aus dem Repo nicht
  ablesen. Im Code gibt es sie nicht mehr. Siehe `betrieb.md`.
