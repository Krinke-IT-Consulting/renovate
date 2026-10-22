# Tasks

## 1. Vorbereitung

- [x] 1.1 An einer echten Antwort prüfen (lesend, ohne Werte auszugeben), ob
  `GET /installation/repositories` die Felder `allow_squash_merge`, `allow_merge_commit` und
  `allow_rebase_merge` enthält. Sonst bleibt `GET repos/{o}/{r}` als Quelle (design.md, Entscheidung 3).
  Fertig, wenn das Ergebnis in `feature-documentation/dashboard/merge.md` steht.
  Entfallen auf Entscheidung des Betreibers (2026-10-22): Die Prüfung an der Produktion wurde nicht
  ausgeführt. Der Code deckt beide Fälle ab (Felder der Listenantwort, sonst bedingter Abruf
  `GET repos/{o}/{r}`); `merge.md` dokumentiert das.
- [x] 1.2 Migration `repositories.merge_methods` (`text[]`, Standard leeres Array) mit drizzle-kit.
  Prüfung durch den Agenten `drizzle-migrations`. Fertig, wenn der Migrationstest gegen Postgres
  grün ist.

## 2. Plattform

- [x] 2.1 `PlatformAdapter`: `getMergeReadiness` und `mergeChangeRequest` (design.md, Entscheidungen
  1 und 2), umgesetzt im `GitHubAdapter`.
  - Frische Lesezugriffe ohne Cache.
  - `sha`-Bindung beim Merge.
  - Abbildung von 405, 409 und 422 auf feste deutsche Meldungen.
  - `mergeable: null` einmal abwarten.

  Fertig, wenn msw-Tests diese Fälle abdecken: 200, 405, 409, 422, `null` → `true` und `null` →
  `null`.
- [x] 2.2 Der GitHub-Abgleich füllt `merge_methods` (Quelle laut 1.1). Fertig, wenn ein
  Integrationstest die Spalte nach dem Abgleich zeigt und ein Repo ohne erlaubte Methode eine
  leere Liste hat.

## 3. Merge-Kern und Actions

- [x] 3.1 `mergePullRequestCore` (design.md, Entscheidung 4) mit Live-Prüfung, Ergebnis-Codes,
  `state = merged` und AuditLog (`pr.merge`, `pr.merge.skipped`, `pr.merge.failed`) in einer
  Transaktion. Fertig, wenn Tests gegen Postgres mit Fake-Adapter alle Scenarios der Requirements
  „PR im Dashboard mergen“ und „Merge-Methode wie im Repo erlaubt“ abdecken.
- [x] 3.2 Sammel-Merge (design.md, Entscheidung 5):
  - Kandidaten aus der DB, höchstens 20.
  - Gebunden an die beim Rendern übergebenen IDs, SHAs und Methoden.
  - Nacheinander, 1 s Pause im selben Repo.
  - AuditLog `pr.merge_bulk` vor dem Start.

  Fertig, wenn Tests die Scenarios „Gemischte Lage“ und „Ausgenommene Typen“ abdecken.
- [x] 3.3 Server Actions `mergePullRequest` und `mergeAllGreen` als dünne Hüllen (`requireActor`,
  zod, `revalidatePath`). Fertig, wenn `tsc` und `eslint` sauber sind.

## 4. Oberfläche

- [x] 4.1 PR-Tabelle (Liste und Repo-Detail): Knopf „Mergen“ als ruhiger Knopf, nur bei grüner CI und
  nicht leeren Methoden. Dialog mit Methode, Meldung mit PR-Link. Mobil als Kartenknopf. Fertig,
  wenn der Playwright-Smoke „Grüner PR“ und „Rote CI → kein Knopf“ besteht.
- [x] 4.2 Lagebericht: Sicherheits- und Major-Schritte mit `action.kind = "merge"` bei grüner CI
  (`src/domain/report.ts`, `step-list.tsx`, `repo-steps.tsx`). Fertig, wenn Vitest das Scenario
  „Grünes Sicherheitsupdate im Lagebericht“ und Playwright den Merge im Lagebericht abdecken.
- [x] 4.3 Sammel-Merge-Knopf im Kopf von `/pull-requests`, nur bei n > 0. Die Meldung nennt gemergte
  und übersprungene PRs mit Grund. Fertig, wenn der Playwright-Smoke „Gemischte Lage“ und „Nichts
  für den Sammel-Merge“ besteht.
- [x] 4.4 Der Plattform-Ersatz für E2E (`src/rollout/e2e-fake-adapter.ts`) bekommt beide neuen
  Methoden. Fertig, wenn `npx playwright test` vollständig grün ist und `impeccable detect` keine
  Treffer meldet.

## 5. Abschluss

- [x] 5.1 Doku: `feature-documentation/dashboard/merge.md` neu, `aktionen.md` und `PROGRESS.md`
  nachziehen. Fertig, wenn `openspec validate dashboard-pr-merge --strict` grün ist.
- [x] 5.2 Review durch `reviewer` und `github-app-integration`, Befunde beheben, dann PR, Merge und
  Deployment nach Freigabe. Fertig, wenn der Betreiber einen echten grünen PR aus dem Dashboard
  gemergt hat und Merge, AuditLog und Status im Dashboard stimmen.
