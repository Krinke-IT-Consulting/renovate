# Mergen im Dashboard (Server-Teil)

Stand: Change `dashboard-pr-merge`, Tasks 1.1, 2.1, 2.2, 3.1 bis 3.3 (Server). Die Oberfläche (Tasks 4.x)
folgt und baut gegen den Vertrag `src/merge/types.ts` und die Actions in `src/actions/merge.ts`.

## Bausteine

| Datei | Aufgabe |
|---|---|
| `src/merge/types.ts` | Vertrag: `MergeTarget`, `MergeOutcome`, `MergeSkipReason`, Methoden, `BULK_MERGE_LIMIT` |
| `src/merge/runtime.ts` | `getMergePlatform()`: die eine `GitHubAdapter`-Instanz; im E2E der Plattform-Ersatz, falls er die Merge-Methoden hat |
| `src/platform/types.ts` | `PlatformAdapter.getMergeReadiness`, `mergeChangeRequest`; `MergeReadiness`, `MergeRequest`, `ChangeMergeMethod`; `PlatformRepository.mergeMethods` |
| `src/platform/errors.ts` | `PlatformHeadChangedError` (409: Head-Commit weicht ab) |
| `src/platform/github/adapter.ts` | Umsetzung für GitHub |
| `src/actions/core/merge.ts` | `mergePullRequestCore`, `mergeAllGreenCore`, Abbildung auf `ActionState` |
| `src/actions/merge.ts` | Server Actions `mergePullRequest(target)` und `mergeAllGreen(targets)` (dünne Hüllen) |
| `src/queries/merge.ts` | `listBulkMergeCandidates(db)` für den Sammel-Merge-Knopf |
| `src/sync/github-sync.ts` | füllt `repositories.merge_methods` im Abgleich |

## Quelle der Merge-Methoden (Task 1.1)

**Offen, nicht an der echten Antwort geprüft.** Die lesende Prüfung über die laufende Produktion
(`ssh` + `docker exec`, Installation-Token, Ausgabe nur von Feldnamen) wurde vom Berechtigungssystem
der Sitzung abgelehnt und nicht ausgeführt. Stattdessen gilt eine Annahme, die für beide Fälle
funktioniert:

- Der Abgleich liest `GET /installation/repositories`. Sind `allow_squash_merge`, `allow_merge_commit`
  und `allow_rebase_merge` dort alle drei boolesch vorhanden, werden sie übernommen.
- Fehlen sie (GitHub liefert sie in der Repo-Liste nur mit ausreichendem Recht), liest der Adapter für
  dieses Repo `GET repos/{o}/{r}` mit ETag. Bedingte Anfragen kosten bei 304 kein Kontingent; der erste
  Abgleich zahlt einmal je Repo, danach ist es kostenlos, solange sich die Einstellungen nicht ändern.
  Archivierte Repos werden übersprungen (dort ist Mergen ohnehin unmöglich).
- Scheitert dieser Einzelabruf, bleibt `mergeMethods` unbestimmt (`undefined`); der gespeicherte Stand
  der Spalte bleibt unverändert. Nur eine Kontingent-Pause bricht den Abgleich ab.
- Die Live-Prüfung unmittelbar vor dem Merge liest immer `GET repos/{o}/{r}` ohne Cache.

Nachzuholen: einmal an einer echten Antwort prüfen, ob die Listenantwort die Felder enthält. Falls ja,
entfällt der Einzelabruf im Betrieb von selbst; falls nein, ist der Weg über `repos/{o}/{r}` schon der
im Code vorgesehene.

## PlatformAdapter

- `getMergeReadiness(conn, repo, number)` liefert `{ state, headSha, mergeable, ci, methods }`.
  - `GET pulls/{n}` ohne Cache. Ist `mergeable` `null`, wird einmal nach 2 s (Option `mergeableRetryMs`,
    Wartefunktion `sleep` für Tests) neu gelesen; bleibt es `null`, kommt `null` zurück.
  - Nur bei offenem PR zusätzlich CI am Head-Commit (gleiche Ableitung wie `getChangeStatus`, Methode
    `readCi`) und `GET repos/{o}/{r}` ohne Cache. Sonst `ci: "none"`, `methods: []`.
  - `methods` in der Reihenfolge Squash, Merge-Commit, Rebase; leer, wenn die Felder fehlen.
- `mergeChangeRequest(conn, repo, number, { sha, method })`: `PUT pulls/{n}/merge` über `write()`
  (Kontingent-Pause, sekundäres Rate-Limit). Fehlerabbildung über die Option `mapError` von `write()`:

| Antwort | Fehler |
|---|---|
| 405 | `PlatformRejectedError` („Die Plattform lehnt den Merge ab …“) |
| 409 | `PlatformHeadChangedError` |
| 422 | `PlatformRejectedError` („… als ungültig abgelehnt …“) |
| 403 mit Branch-Schutz-Text | `PlatformRejectedError` wie 405 |
| 403 sonst | `PlatformPermissionError` (Standard von `write()`) |
| 403/429 mit Limit | `RateLimitPause` |

  Der Text der Plattform wird nur ausgewertet, nie weitergegeben.

## Merge-Kern (`core/merge.ts`)

`mergePullRequestCore(deps, { pullRequestId, expectedSha, expectedMethod, actor })` mit
`deps = { db, platform, now?, sleep? }` liefert ein `MergeOutcome`.

Reihenfolge der Prüfungen:

1. PR unbekannt: `failed` („Unbekannter Pull Request.“), kein AuditLog.
2. Repo entfernt, archiviert oder Owner ohne Installation: `failed` + `pr.merge.failed`.
3. In der DB nicht offen: `skipped` `not_open`, ohne Plattformabruf.
4. Live (`getMergeReadiness`; Fehler: `failed`): nicht offen (`not_open`), Head-SHA weicht ab (`changed`),
   CI nicht grün (`ci`, Meldung nennt den Status), `mergeable === false` (`conflict`), `null` (`pending`),
   keine Methode (`no_method`), erste erlaubte Methode weicht von der angezeigten ab (`method_changed`,
   Meldung nennt die neue).
5. Merge mit der Head-SHA. `PlatformHeadChangedError` wird `changed`, `PlatformRejectedError` wird
   `rejected` (Meldung der Plattformschicht), alles andere `failed` mit fester Meldung.
6. Bei Erfolg in einer Transaktion `pull_requests.state = 'merged'`, `merged_at` und `pr.merge`. Scheitert
   das Speichern, bleibt das Ergebnis `merged` (der PR ist gemergt); der Abgleich zieht nach.

AuditLog-Ziele: `pr.merge` und `pr.merge.failed` mit `<repo> #<n>`, `pr.merge.skipped` mit
`<repo> #<n> (<grund>)`. Ein Fehler beim Schreiben von `skipped`/`failed` wird geloggt (ohne Werte)
und ändert das Ergebnis nicht.

## Sammel-Merge

`mergeAllGreenCore(deps, { targets, actor })` gibt `{ outcomes, ignored }` zurück.

- Doppelte IDs zählen einmal; höchstens `BULK_MERGE_LIMIT` (20) Ziele, der Rest zählt als `ignored` und
  steht in der Meldung.
- `pr.merge_bulk` (Ziel „n PRs in m Repos“) wird vor dem Start geschrieben; scheitert es, wird nichts gemergt.
- Je Ziel serverseitig: offen (sonst `not_open`), Typ `patch`/`minor` (sonst `rejected`, „Nur Patch- und
  Minor-Updates …“), `ci_status = 'success'` (sonst `ci`); danach dieselbe Live-Prüfung wie beim Einzel-Merge.
- Nacheinander. Vor einem Ziel im selben Repo wie der zuletzt gemergte PR 1 s Pause (`BULK_PAUSE_MS`,
  über `deps.sleep` ersetzbar).
- `bulkResultToState`: „n PRs gemergt, m übersprungen.“ plus je übersprungenem PR „<repo> #<n>: <Grund>“;
  Ton `warnung` bei Auslassungen, `erfolg` sonst; nur Fehler: Fehlermeldung; leer: neutral.

`listBulkMergeCandidates(db)` (`queries/merge.ts`) gibt `{ targets, repoCount, total }`: offene
Patch-/Minor-PRs mit grüner CI, Head-SHA, Repo weder archiviert noch entfernt, Installation vorhanden,
mindestens eine Methode; sortiert nach Repo und Alter, `targets` auf 20 begrenzt (`total` = vor der Grenze).
Die Oberfläche übergibt `targets` unverändert an `mergeAllGreen`.

## Server Actions

Dünne Hüllen wie die übrigen Actions: `requireActor`, zod-Prüfung (`pullRequestId` uuid, `expectedSha` hex 7
bis 64, `expectedMethod` aus `MERGE_METHODS`), `runAction`, `revalidatePath("/", "layout")`. Einzel-Merge:
bei Erfolg Meldung mit externem Link zum PR. Plattform: `getMergePlatform()`; im E2E (`E2E_FAKE_PLATFORM=1`,
nicht in Produktion) der Ersatz aus `rollout/e2e-fake-adapter.ts`, sofern er `getMergeReadiness` und
`mergeChangeRequest` anbietet, sonst feste Fehlermeldung.

## Rechte und Kontingent

- Keine neuen App-Rechte. Mergen braucht Contents und Pull requests mit Schreibrecht; PRs, die
  Workflow-Dateien ändern, zusätzlich Workflows mit Schreibrecht. Alle drei sind vorhanden.
- Einzel-Merge: 4 Abrufe (PR, Check-Runs, Commit-Status, Repo) plus Merge; bei `mergeable: null` 1 weiterer PR-Abruf.
- Abgleich: je Repo ohne Methodenfelder in der Listenantwort ein bedingter Abruf (304 kostenlos).
