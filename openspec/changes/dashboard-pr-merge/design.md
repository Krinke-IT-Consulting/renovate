# Design

## Context

Siehe proposal.md, Abschnitt Why. Der Stand im Code (Archiv des Changes `dashboard`, Specs
`dashboard-actions` und `dashboard-views`):

- **Aktionen:** Sie laufen als Server Actions mit dünner Hülle (`src/actions/*.ts`). Die Logik steckt
  testbar in `src/actions/core/`. Gemeinsam sind `runAction`, `requireActor`, `writeAudit` und
  `ConfirmAction` mit `resultKey`, damit die Meldung nach `revalidatePath` sichtbar bleibt.
- **Plattformzugriff:**
  - Er läuft nur über den `PlatformAdapter`.
  - Schreibaufrufe gehen über `write()` mit Kontingent-Pause, sekundärem Rate-Limit und
    `PlatformRejectedError`/`PlatformPermissionError` für verständliche Meldungen.
  - Es gibt genau eine `GitHubAdapter`-Instanz je Prozess.
  - `getChangeStatus` leitet den CI-Status aus Check-Runs und Commit-Status ab. Diese Ableitung gilt
    auch für die Live-Prüfung.
- **Datenstand:** `pull_requests` hält `state`, `head_sha` und `ci_status` aus dem Abgleich (alle
  5 Minuten).
- **Lagebericht:** Schritte haben `action.kind` `link` oder `onboarding` (`src/domain/report.ts`).

## Goals / Non-Goals

**Goals:**
- Merge mit derselben Sicherheit wie auf der Plattform: Live-Prüfung, Head-SHA-Bindung,
  Branch-Schutz bleibt wirksam.
- Ein gemeinsamer Merge-Kern für Einzel- und Sammel-Merge.

**Non-Goals:**
- Freigaben oder Reviews im Namen des Betreibers abgeben, Branch-Schutz umgehen, Admin-Merge.
- PRs außerhalb von Renovate. Das Dashboard kennt nur die Update-PRs des Bots.
- Automatisches Mergen ohne Klick. Das bleibt Sache von Renovates Automerge.

## Decisions

### 1. Zwei neue Adapter-Methoden, plattformneutral
- **`getMergeReadiness(conn, repo, number)`:**
  - Liefert `{ state, headSha, mergeable: true | false | null, ci, methods }`.
  - `methods` sind die erlaubten Methoden des Repos in der Reihenfolge Squash, Merge-Commit, Rebase.
  - Bei GitHub sind das drei Abrufe: `GET pulls/{n}`, CI über die vorhandene `getChangeStatus`-Logik
    am `head.sha` und `GET repos/{o}/{r}` mit den Feldern `allow_squash_merge` bzw.
    `allow_merge_commit` bzw. `allow_rebase_merge`.
  - PR und Repo werden **ohne ETag-Cache** gelesen (`noCache`), weil die Prüfung frisch sein muss.
- **`mergeChangeRequest(conn, repo, number, { sha, method })`:**
  - `PUT pulls/{n}/merge` mit `sha`. GitHub lehnt mit 409 ab, wenn der Head nicht mehr passt. Das ist
    eine zweite Sicherung neben der Live-Prüfung.
  - Abbildung der Antworten:
    - 405 (nicht mergebar, z. B. Branch-Schutz) → `PlatformRejectedError`
    - 409 → „PR hat sich geändert“
    - 422 → abgelehnt mit festem Text
- **Alternative verworfen:** Den GraphQL-Mutation `mergePullRequest` verwenden. Er hat keinen Vorteil
  und ist ein zweiter Client-Pfad.

### 2. `mergeable: null` einmal abwarten
GitHub berechnet die Mergebarkeit asynchron. Liefert der erste Abruf `null`, wartet die Prüfung
einmal 2 Sekunden und liest neu. Bleibt es bei `null`, wird nicht gemergt, mit der Meldung „Die
Plattform prüft noch, ob der PR konfliktfrei ist. Bitte gleich erneut versuchen.“ Ein Polling mit
Schleife ist verworfen, weil die Server Action sonst unvorhersehbar lang läuft.

### 3. Merge-Methode
- **Abgleich:** Der GitHub-Abgleich speichert die erlaubten Methoden in
  `repositories.merge_methods text[]`.
  - Sie stehen in der Antwort von `GET /installation/repositories`, sofern das Token Schreibrecht
    hat. Das prüft Task 1.1 an der echten Antwort.
  - Fehlen die Felder dort, liest der Abgleich sie mit dem Head-SHA-Gating aus `GET repos/{o}/{r}`.
- **Dialog:** Er zeigt die erste erlaubte Methode aus diesem Feld.
- **Live-Prüfung:** Sie liest die Methoden neu. Der Merge nutzt die aktuelle erste erlaubte Methode.
- **Abweichung:** Weicht sie von der im Dialog gezeigten ab, wird **nicht** gemergt. Die Meldung nennt
  die neue Methode, und ein zweiter Klick ist nötig. So mergt das Dashboard nie anders als bestätigt.
- **Leere Liste:** keine Merge-Aktion in der Oberfläche.

### 4. Merge-Kern und Ergebnis
`mergePullRequestCore(deps, { pullRequestId, expectedSha, expectedMethod, actor })` liefert eines
dieser Ergebnisse:
- `merged` mit URL
- `skipped` mit Grundcode und deutschem Text: `changed`, `not_open`, `ci`, `conflict`, `pending`,
  `method_changed`, `no_method`, `rejected`
- `failed` mit festem Text

Danach in einer Transaktion:
- `pull_requests.state = 'merged'` und `merged_at` setzen, sofern gemergt.
- AuditLog-Eintrag:
  - `pr.merge` bei Erfolg
  - `pr.merge.skipped` mit Grundcode im Ziel
  - `pr.merge.failed` bei Fehler

Probleme wie `stale_pr` und `ci_red` löst der nächste Abgleich auf, weil der PR nicht mehr offen ist.
Dafür wird kein Sonderweg gebaut.

### 5. Sammel-Merge
- **Kandidaten:** Server-seitig aus der DB, also offene PRs mit `update_type in ('patch','minor')`,
  `ci_status = 'success'`, Repo nicht archiviert und nicht entfernt, nicht leere `merge_methods`.
  Sortiert nach Repo, dann Alter.
- **Begrenzung:** höchstens 20 je Auslösung.
- **Bindung an die Anzeige:** Der Dialog nennt die Anzahl. Die Action bekommt die IDs mit erwarteter
  SHA und Methode als Liste, die beim Rendern feststand, und mergt nur diese.
- **Ablauf:**
  - Die PRs werden **nacheinander** gemergt. Nach einem Merge im selben Repo können folgende PRs
    Konflikte bekommen (etwa Lockfiles). Die Live-Prüfung erkennt das und überspringt sie.
  - Zwischen zwei Merges im selben Repo gibt es 1 Sekunde Pause, damit `mergeable` neu berechnet ist
    und kein sekundäres Rate-Limit greift.
- **AuditLog:**
  - Vor dem Start der Eintrag `pr.merge_bulk` mit der Anzahl, wie bei `job.trigger_all`.
  - Danach je PR ein Eintrag aus dem Kern.
- **Laufzeit:** bei 20 PRs etwa 20 × 1 bis 2 s, also unter einer Minute. Das liegt im Rahmen einer
  Server Action. Eine Hintergrundverarbeitung ist verworfen, weil das Ergebnis direkt als Meldung
  erscheinen soll.

### 6. Oberfläche
- **Lagebericht:** `StepAction` bekommt `kind: "merge"` mit `pullRequestId`, `expectedSha`,
  `method`. Sicherheits- und Major-Schritte bekommen sie bei `ci_status = 'success'` und nicht leeren
  Methoden, sonst bleibt der Link.
- **PR-Tabelle:** Sie erhält eine Spalte bzw. auf Mobil einen Kartenknopf „Mergen“, nur bei grüner
  CI. Das Repo-Detail nutzt dieselbe Tabelle.
- **Sammel-Merge:** Der Knopf „Alle grünen Patch- und Minor-PRs mergen (n)“ sitzt im Seitenkopf von
  `/pull-requests` und erscheint nur bei n > 0.
- **Dialog-Texte:**
  - Einzel-Merge: „{Repo} #{n} wird per {Methode} gemergt. Vorher prüft das Dashboard, ob CI und
    Commit noch stimmen.“
  - Sammel-Merge: „{n} PRs in {m} Repos werden nacheinander gemergt …“
- **Hauptaktion:** Olive nach der Ein-Signal-Regel in `DESIGN.md`. In der Tabelle ist „Mergen“ ein
  ruhiger Knopf, damit nicht jede Zeile olive leuchtet. Im Lagebericht ist es die Hauptaktion.

### 7. Tests
- **Adapter mit msw:**
  - Lesen der Voraussetzungen
  - Merge 200, 405, 409 und 422
  - `mergeable: null` gefolgt von `true`
- **Kern gegen Postgres mit Fake-Adapter:** jedes Scenario der Specs.
- **E2E:**
  - Der Plattform-Ersatz `e2e-fake-adapter.ts` bekommt beide Methoden.
  - Abgedeckt werden Einzel-Merge im Lagebericht und in der PR-Liste, Sammel-Merge mit einem
    übersprungenen PR sowie „rote CI → kein Knopf“.

## Risks / Trade-offs

- **[Risiko] CI-Ableitung weicht von den Required Checks ab.**
  - **Mitigation:** Mergen kann nur, wer auch auf der Plattform mergen dürfte; Branch-Schutz greift
    serverseitig (405 → Meldung). Die eigene CI-Prüfung ist zusätzlich strenger (alle Checks grün,
    nicht nur die erforderlichen).
- **[Risiko] Ein PR ohne CI (z. B. Repo ohne Workflows) lässt sich nie im Dashboard mergen.**
  - **Mitigation:** gewollt (Spec: „ohne CI nicht grün“). Der Link zur Plattform bleibt.
- **[Risiko] Sammel-Merge in einem Repo erzeugt Konflikte für Folge-PRs.**
  - **Mitigation:** Die Live-Prüfung je PR überspringt sie mit Grund. Renovate baut sie beim nächsten
    Lauf neu.
- **[Risiko] Eine lange Server Action bricht beim Deploy ab.**
  - **Mitigation:** Der AuditLog-Eintrag steht vorher, jeder einzelne Merge wird sofort protokolliert.
    Abgebrochene Merges sind ungefährlich, denn ein gemergter PR bleibt gemergt.
- **[Trade-off] Methode im Dialog stammt aus dem Abgleich.**
  - Ändert jemand die Repo-Einstellung, bricht der Merge einmal ab. Das ist bewusst sicherer als ein
    stiller Methodenwechsel.

## Migration Plan

1. **Migration:** `0003_repositories_merge_methods` (Spalte nullable, Standard leeres Array). Läuft
   beim Containerstart wie bisher.
2. **Erster Abgleich:** Er füllt die Spalte. Bis dahin zeigt die Oberfläche keine Merge-Knöpfe, denn
   die Methodenliste ist leer.
3. **Deployment:** nur nach Freigabe.
4. **Rückweg:** Der Code ist zurücknehmbar. Die Spalte darf bleiben, sie stört nichts.
