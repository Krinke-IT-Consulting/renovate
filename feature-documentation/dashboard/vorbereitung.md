# Dashboard: Vorbereitung (Tasks 1.1 bis 1.3)

Stand: 2026-10-15. Grundlage für die Umsetzung des OpenSpec-Changes `dashboard`.

## Versionen (Task 1.1)

Ermittelt mit `npm view <paket> version` bzw. `docker buildx imagetools inspect`. Die Umsetzung
pinnt diese Stände, außer ein Paket ist mit den anderen nicht verträglich. Abweichungen stehen in
der Feature-Doku.

| Paket | Version |
|---|---|
| next, eslint-config-next | 16.4.1 (Node `>=20.9.0`) |
| react, react-dom | 19.3.1 |
| typescript | 7.0.2 |
| tailwindcss, @tailwindcss/postcss | 4.3.3 |
| shadcn (CLI) | 4.21.5 |
| @tanstack/react-table | 9.3.1 |
| drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 |
| pg, @types/pg | 8.23.1 |
| @octokit/app / @octokit/rest | 16.1.4 / 22.0.1 |
| zod | 4.6.7 |
| vitest | 5.0.4 |
| msw | 3.0.3 |
| @playwright/test | 1.64.1 |
| @fontsource/montserrat, @fontsource/inter | 5.3.0 |
| eslint | 10.12.0 |
| Node-LTS | 24.22.0 |
| Basisimage | `node:24.22.0-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f` |

## CE-API gegen die laufende Instanz (Task 1.2)

Geprüft am 2026-10-15 im Container `renovate-ce` (Renovate 44.134.1). Das Secret kam aus der
Container-Umgebung und wurde nicht ausgegeben.

| Endpunkt | Ergebnis |
|---|---|
| `GET /system/v1/status` | 200. Felder wie dokumentiert. `jobs.history.lastFinished` enthält zusätzlich `repository`, `organizationName`, `installationId`, `finishedAt`. `scheduler.allJobs.cron` ist `0 * * * *`. |
| `GET /system/v1/jobs/queue` | 200, `{running: [], pending: []}` |
| `GET /api/v1/repos/{org}/{repo}/-/jobs?limit=n` | 200, Array mit `jobId`, `reason`, `addedAt`, `startedAt`, `completedAt`, `logLocation`, `queueName`, `status`. Bei Erfolg fehlen `error` und `artifactErrors`. |
| `GET /system/v1/jobs/logs/{jobId}` | 200, JSON Lines im Bunyan-Format (`level` numerisch: 20 debug, 30 info, 40 warn, 50 error), etwa 136 KB je Lauf |
| `GET /api/v1/repos/{org}/{repo}/-/jobs/{jobId}` und `/-/jobs/latest` | 200, gleiches Log |
| `GET /system/v1/jobs/logs/latest` | 404. `latest` gilt nur im Repo-Pfad. |
| `GET /api/v1/orgs`, `/api/v1/orgs/{org}/-/repos` | 404, solange die Reporting-API aus ist. Wird nach Task 4.6 erneut geprüft. |

Aufgezeichnete Antworten ohne Lizenz und Secrets dienen als Test-Fixtures (Task 5.1).

## GitHub App (Task 1.3)

Gelesen per JWT über `GET /app` und `GET /app/installations`.

- **Slug:** `krinke-it-renovate`. Der Bot heißt also `krinke-it-renovate[bot]`.
- **Rechte:**
  - Lesen: administration, members, metadata, vulnerability_alerts
  - Schreiben: checks, contents, issues, pull_requests, statuses, workflows

  Das deckt alle Anforderungen des Dashboards ab. Es fehlt nichts.
- **Events:** check_run, check_suite, issues, pull_request, push, repository, status.
- **Installationen:** nur `Krinke-IT-Consulting` (ausgewählte Repos). **In `Hiwamashi` ist die App
  nicht installiert.** Bis der Betreiber das nachholt, sieht das Dashboard nur Repos von
  Krinke-IT-Consulting.
