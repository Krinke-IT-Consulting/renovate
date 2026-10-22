# Mergen im Dashboard

Stand: 2026-10-22, Commit `8d52d74` (Review-Befunde des Mergens) auf `feat/dashboard-pr-merge`. Change
`dashboard-pr-merge`, Tasks 1.1 bis 4.4 umgesetzt (Server und Oberfläche). Offen sind Review und Deployment
(Task 5.2). Grundlage sind `openspec/changes/dashboard-pr-merge/` (`proposal.md`, `design.md`, `specs/`) und der Code
unter `dashboard/`. Die Entscheidungsnummern (1 bis 7) stammen aus `design.md`.

## 1. Überblick

Das Dashboard kann offene Renovate-PRs direkt auf GitHub mergen. Zwei Wege:

- **Einzel-Merge**: ein PR, Bestätigungsdialog, Server Action `mergePullRequest`.
- **Sammel-Merge**: alle grünen Patch- und Minor-PRs (höchstens 20), nacheinander, Server Action `mergeAllGreen`.

Vor jedem Merge steht eine **Live-Prüfung** gegen die Plattform. Der Merge läuft nur, wenn Head-Commit, Entwurfs- und
Schutzstatus, CI, Mergebarkeit und erste erlaubte Methode zu dem passen, was die Oberfläche beim Rendern angezeigt hat.
Sonst unterbleibt der Merge, der PR bleibt unverändert, und die Meldung nennt den Grund.

Die Logik liegt in `dashboard/src/actions/core/merge.ts` (ohne Next.js, mit eingespritzter Datenbank und Plattform).
Die Server Actions in `dashboard/src/actions/merge.ts` sind dünne Hüllen.

## 2. Bausteine

| Datei | Aufgabe |
|---|---|
| `dashboard/src/merge/types.ts` | Vertrag zwischen Logik und Oberfläche: `MERGE_METHODS` (Vorzugsreihenfolge), `MergeTarget`, `MergeOutcome`, `MergeSkipReason`, `BULK_MERGE_LIMIT` (20), `BULK_MERGE_TYPES` (`patch`, `minor`), `preferredMergeMethod`. |
| `dashboard/src/merge/target.ts` | `mergeTargetOf(pr)`: macht aus einem PR ein Merge-Ziel oder `null` (dann kein Knopf). |
| `dashboard/src/merge/runtime.ts` | `getMergePlatform()`: die eine `GitHubAdapter`-Instanz je Prozess; im E2E der Plattform-Ersatz, falls er die Merge-Methoden hat. |
| `dashboard/src/platform/types.ts` | `PlatformAdapter.getMergeReadiness` und `mergeChangeRequest`; `MergeReadiness` (mit `methods` und `blockedReason`), `MergeRequest`, `ChangeMergeMethod`; `PlatformRepository.mergeMethods`; `ListRepositoriesOptions`. |
| `dashboard/src/platform/errors.ts` | `PlatformHeadChangedError` (Plattform meldet 409 wegen des Head-Commits). |
| `dashboard/src/platform/github/adapter.ts` | GitHub-Umsetzung: Live-Lesen, Merge mit `sha`-Bindung, Klassifizierung der Ablehnungen, Methoden aus dem Repo. |
| `dashboard/src/actions/core/merge.ts` | `mergePullRequestCore`, `mergeAllGreenCore`, `mergeOutcomeToState`, `bulkResultToState`. |
| `dashboard/src/actions/merge.ts` | Server Actions `mergePullRequest(target)` und `mergeAllGreen(targets)`. |
| `dashboard/src/queries/merge.ts` | `listBulkMergeCandidates(db)`: Kandidaten für den Sammel-Merge-Knopf. |
| `dashboard/src/sync/github-sync.ts` | Füllt `repositories.merge_methods` im Abgleich, gedrosselt (Abschnitt 14). |
| `dashboard/src/domain/report.ts` | Lagebericht: Sicherheits- und Major-Schritte bekommen `action.kind = "merge"`, wenn `mergeTargetOf` ein Ziel liefert. |
| `dashboard/src/components/actions/merge-action.tsx` | `MergeAction` (Einzel, Bestätigungsdialog) und `BulkMergeAction` (Sammel-Merge), `MERGE_RESULT_KEY`. |
| `dashboard/src/components/pull-requests/pull-request-table.tsx` | PR-Tabelle (Liste und Repo-Detail) mit `MergeCell`. |

## 3. Wo die Knöpfe stehen

| Ort | Knopf | Bedingung |
|---|---|---|
| PR-Liste `/pull-requests` (Tabelle, mobil Karten) | „Mergen“ je PR, ruhiger Knopf (`variant="quiet"`) | `mergeTargetOf(row)` ist nicht `null`. Sonst bleibt der Titel-Link zum PR die Aktion. |
| Repo-Detail `/repos/[owner]/[name]` (PR-Tabelle) | wie PR-Liste | dieselbe Bedingung; `showRepo={false}` |
| Repo-Detail, Abschnitt „Was hier zu tun ist“ (`components/repos/repo-steps.tsx`) | „Mergen“ als Hauptaktion des Schritts | Schritt mit `action.kind = "merge"` |
| Lagebericht `/` (`components/overview/step-list.tsx`) | „Mergen“ als Hauptaktion (`variant="primary"`) | Sicherheits- oder Major-Schritt mit Merge-Ziel. Ist der Schritt erledigt (`done`), entfällt der Knopf. |
| Kopf der PR-Liste `/pull-requests` | „Alle grünen Patch- und Minor-PRs mergen (n)“ | nur wenn `listBulkMergeCandidates` mindestens ein Ziel liefert (`n > 0`) |

Die Erfolgs- und Fehlermeldungen stehen über `ActionResult` mit dem Schlüssel `MERGE_RESULT_KEY` (`"merge"`) auf der
PR-Liste, im Repo-Detail und im Lagebericht. Sie bleiben stehen, wenn der PR nach dem Merge aus der Liste verschwindet
(siehe `aktionen.md`, Abschnitt 1).

Einzel-Knopf: sichtbare Beschriftung „Mergen“, zugänglicher Name „Mergen <Repo> #<Nummer>“. Der Dialog nennt Titel
„<Repo> #<Nummer> mergen?“, die Wirkung „… wird per <Methode> gemergt. Vorher prüft das Dashboard, ob CI und Commit
noch stimmen.“ und bestätigt mit „Mergen“. Abbrechen ruft nichts auf.

Sammel-Knopf: Beschriftung „Alle grünen Patch- und Minor-PRs mergen (n)“, Dialog „Alle grünen Patch- und Minor-PRs
mergen?“, Bestätigung „Alle mergen“. Der Dialog nennt die Zahl, die Repos und die Ausnahmen (Sicherheits- und
Major-Updates). Die Zahl ist `targets.length`, also höchstens 20. Die Gesamtzahl `total` aus der Abfrage wird nicht
angezeigt.

## 4. Ablauf

### 4.1 Einzel-Merge

1. Klick auf „Mergen“ öffnet den Bestätigungsdialog. Die Oberfläche hat `pullRequestId`, `expectedSha` (Head-SHA
   zum Renderzeitpunkt) und `expectedMethod` (erste erlaubte Methode zum Renderzeitpunkt) per `bind` übergeben.
2. `mergePullRequest(target)` (`actions/merge.ts`): `requireActor()` liest den Nutzer aus `x-dashboard-user`. zod prüft
   `pullRequestId` (uuid), `expectedSha` (hex, 7 bis 64 Zeichen) und `expectedMethod` (aus `MERGE_METHODS`). Bei
   Fehler: Meldung „Ungültige Angaben zum Pull Request.“, kein Plattformaufruf.
3. `mergePullRequestCore` lädt den PR mit Repo, Installation und Owner aus der Datenbank und führt die Prüfungen aus
   (Abschnitte 5 und 6).
4. Das Ergebnis (`MergeOutcome`) wird über `mergeOutcomeToState` in den Zustand der Aktion abgebildet (Abschnitt 11).
5. `revalidatePath("/", "layout")`, damit Lagebericht, Liste und Repo-Detail neu lesen.

### 4.2 Sammel-Merge

1. Die Oberfläche übergibt bei Rendern genau die `targets` aus `listBulkMergeCandidates` (Ziele mit Head-SHA und
   Methode).
2. `mergeAllGreen(targets)`: `requireActor()`, zod-Prüfung als Liste mit höchstens `BULK_MERGE_LIMIT * 5` (100)
   Einträgen. Bei Fehler: „Ungültige Angaben zu den Pull Requests.“
3. `mergeAllGreenCore`: doppelte IDs zählen einmal; über 20 Ziele werden nur die ersten 20 bearbeitet, der Rest zählt
   als `ignored`. Leere Liste: keine Protokollierung, neutrale Meldung.
4. Lädt alle Ziele in einer Abfrage. **AuditLog `pr.merge_bulk` wird vor dem Start geschrieben.** Scheitert das, wird
   kein PR gemergt; der Fehler geht über `runAction` als allgemeine Fehlermeldung nach außen.
5. Je Ziel, nacheinander, mit Zeitgrenze und Abbruch bei Kontingent-Pause (Abschnitt 9).
6. `bulkResultToState` bildet das Gesamtergebnis ab (Abschnitt 11).

## 5. Vorprüfung in der Datenbank (Einzel-Merge)

In dieser Reihenfolge; der erste Treffer endet die Prüfung:

| # | Bedingung | Ergebnis | AuditLog |
|---|---|---|---|
| 1 | PR-ID unbekannt | `failed`: „Unbekannter Pull Request.“ | keiner |
| 2 | Repo auf der Plattform entfernt (`removed_at`) | `failed`: „Das Repo ist auf der Plattform nicht mehr vorhanden.“ | `pr.merge.failed` |
| 3 | Repo archiviert | `failed`: „Das Repo ist archiviert; dort lässt sich nichts mergen.“ | `pr.merge.failed` |
| 4 | Keine Installation für den Owner | `failed`: „Für diesen Owner ist keine Installation der App hinterlegt.“ | `pr.merge.failed` |
| 5 | PR in der Datenbank nicht offen | `skipped` `not_open`, ohne Plattformabruf | `pr.merge.skipped` |

## 6. Live-Prüfung und Gründe

Danach liest `getMergeReadiness` den Stand direkt von der Plattform (Abschnitt 13). Ein Lesefehler ergibt `failed` mit
der Meldung aus Abschnitt 8 bzw. 5. Eine Kontingent-Pause beim Lesen ergibt beim Einzel-Merge `failed` mit der
Pause-Meldung (Abschnitt 10). Sonst gilt diese Reihenfolge; der erste Treffer endet die Prüfung:

| Nr. | Grund (`MergeSkipReason`) | Auslöser | Meldung |
|---|---|---|---|
| 1 | `not_open` | Plattform meldet keinen offenen PR (gemergt oder geschlossen) | „Der PR ist nicht mehr offen.“ |
| 2 | `changed` | Head-SHA der Plattform weicht von `expectedSha` ab | „Der PR hat sich seit der Anzeige geändert (neuer Commit). Bitte die Ansicht neu laden und erneut prüfen.“ |
| 3 | `rejected` | `blockedReason === "draft"` | „Der PR ist ein Entwurf.“ |
| 4 | `ci` | CI des aktuellen Head-Commits ist nicht `success` | „Die CI des aktuellen Commits ist nicht grün (<Status>).“ Status: `fehlgeschlagen` (failure), `läuft noch` (pending), `keine CI` (none) |
| 5 | `conflict` | `mergeable === false` | „Der PR hat Konflikte mit dem Ziel-Branch.“ |
| 6 | `pending` | `mergeable === null` auch nach dem zweiten Lesen | „Die Plattform prüft noch, ob der PR konfliktfrei ist. Bitte gleich erneut versuchen.“ |
| 7 | `rejected` | `blockedReason === "protection"` | „Branch-Schutz oder fehlende Freigaben verhindern den Merge.“ |
| 8 | `no_method` | `methods === null` (Methoden nicht lesbar) | „Die erlaubten Merge-Methoden sind nicht lesbar (Rechte der App prüfen).“ |
| 9 | `no_method` | `methods` leer (Repo erlaubt keine Methode) | „Das Repo erlaubt keine Merge-Methode (Squash, Merge-Commit oder Rebase).“ |
| 10 | `method_changed` | erste erlaubte Methode ≠ `expectedMethod` | „Das Repo erlaubt jetzt <neue Methode> statt <angezeigte Methode>. Bitte erneut bestätigen.“ |

Danach folgt der Merge (Abschnitt 8). Die Methodennamen im Text sind `Squash`, `Merge-Commit` und `Rebase`
(`MERGE_METHOD_LABEL`).

`blockedReason` ist ein Feld aus demselben PR-Abruf (Abschnitt 13). `"behind"` (Branch veraltet) ist kein Grund: Der
Merge wird dann versucht, und GitHub entscheidet selbst.

Die CI-Ableitung ist dieselbe wie im Abgleich (`deriveCiStatus` aus Check-Runs und Commit-Status des Head-Commits).

## 7. Merge-Methode

- Vorzugsreihenfolge (`MERGE_METHODS`): `squash`, `merge` (Merge-Commit), `rebase`. Die erste erlaubte Methode wird
  verwendet (`preferredMergeMethod`).
- Die Oberfläche zeigt nur PRs mit einer Methode in `repositories.merge_methods`. Die Methode, die beim Rendern
  angezeigt wird, wird als `expectedMethod` an die Action gebunden.
- Der Merge verwendet die Methode aus der **Live-Prüfung**. Weicht sie von `expectedMethod` ab (etwa weil das Repo die
  Squash-Option inzwischen ausgeschaltet hat), unterbleibt der Merge mit `method_changed` (Abschnitt 6). Die Meldung
  nennt die neue Methode, der Nutzer muss erneut bestätigen.
- Erlaubt das Repo keine Methode mehr, greift `no_method` (Nr. 9). Sind die Methoden nicht lesbar, greift `no_method`
  mit der Meldung zu Nr. 8.

Spalte `repositories.merge_methods` (Typ `text[]`, Standard leeres Array, nicht null; Migration `0003`):

- Der Abgleich (`github-sync.ts`) schreibt die Spalte nur, wenn die Plattform die Methoden geliefert hat. Liefert
  der Adapter „unbekannt“ (`undefined`), bleibt der gespeicherte Stand unverändert. Das gilt auch, wenn die App die
  Methoden nicht lesen darf.
- Eine leere Liste bedeutet „keine erlaubte Methode“ und blendet den Knopf aus.
- Ändern sich die erlaubten Methoden im Repo, erkennt der Abgleich das beim nächsten Durchlauf, sofern er die Methoden
  liest (Abschnitt 14). Bis dahin zeigt die Oberfläche den alten Stand. Der Klick prüft dennoch live, daher führt eine
  Änderung zu `method_changed` oder `no_method` und nie zu einem Merge mit anderer Methode.
- Die Live-Prüfung liest die Methoden nie aus der Datenbank, sondern immer von der Plattform (`GET repos/{o}/{r}`).

## 8. Merge-Aufruf und Plattform-Antworten

`mergeChangeRequest` sendet `PUT repos/{o}/{r}/pulls/{n}/merge` mit `sha` und `merge_method`. Die Klassifizierung
erfolgt in `mapError` des Adapters. Der Plattformtext wird nur zum Einordnen gelesen und nie weitergegeben.

Reihenfolge der Klassifizierung nach einer Antwort mit Fehlerstatus:

1. Kontingent-Hinweis bei 403 oder 429 (Prüfung in `throwIfRateLimited`): `RateLimitPause`.
2. Fehlendes Workflow-Recht: Ein Text mit „refusing to allow … workflow“ oder „workflow permission“ bei einem 4xx gilt
   zuerst. Das Muster ist bewusst enger als „workflow“ allein: Ein Check namens „workflow / build“ in einer 405-Meldung
   ist kein Rechtefehler. Ergebnis `PlatformPermissionError` (Workflow-Text, siehe unten).
3. Bei 405, 409 und 422 nach dem Text:

| Text (Auszug) | Abbildung | Ergebnis |
|---|---|---|
| „base branch was modified“ | `PlatformRejectedError`: „Der Ziel-Branch hat sich gerade geändert; bitte erneut versuchen.“ | `skipped` `rejected` |
| „not up to date“ oder „behind“ | `PlatformRejectedError`: „Der Branch muss erst aktualisiert werden (Branch-Regel).“ | `skipped` `rejected` |
| „draft“ | `PlatformRejectedError`: „Der PR ist ein Entwurf.“ | `skipped` `rejected` |
| „merge … not allowed“ oder „method … not allowed“ | `PlatformRejectedError`: „Diese Merge-Methode ist im Repo nicht erlaubt.“ | `skipped` `rejected` |

4. Ohne Texttreffer nach Status:

| Status | Abbildung | Ergebnis |
|---|---|---|
| 405 | `PlatformRejectedError`: „Die Plattform lehnt den Merge ab (zum Beispiel wegen Branch-Schutz oder fehlender Freigaben).“ | `skipped` `rejected` |
| 409 | `PlatformHeadChangedError` | `skipped` `changed` |
| 422 | `PlatformRejectedError`: „Die Plattform hat den Merge als ungültig abgelehnt (etwa weil die Methode nicht erlaubt ist).“ | `skipped` `rejected` |
| 403 mit Text zu Regeln oder Branch-Schutz (`rule violation`, `ruleset`, `branch protection`, `protected branch`) | `PlatformRejectedError` wie bei 405 | `skipped` `rejected` |
| 403 mit Workflow-Text (Punkt 2) | `PlatformPermissionError`: „Der GitHub App fehlt in diesem Repo das Schreibrecht auf Workflows. Bitte in den App-Einstellungen ergänzen.“ | `failed` mit dieser Meldung |
| 403 sonst | `PlatformPermissionError`: „Der GitHub App fehlen in diesem Repo Schreibrechte (Inhalte, Pull Requests oder Workflows). Bitte in den App-Einstellungen ergänzen.“ | `failed` mit dieser Meldung |
| 404 | `PlatformRejectedError`: „Repo nicht gefunden oder nicht in der Installation.“ | `skipped` `rejected` |
| anderer Status (auch 0 bei Netzfehler) | `PlatformApiError` | `failed`: „Die Plattform war nicht erreichbar …“ (Status 0) bzw. „Die Plattform hat die Anfrage abgelehnt (Status <n>).“ |
| 200 mit `merged: false` | `PlatformRejectedError` wie bei 405 | `skipped` `rejected` |

**Ablehnung nach dem PUT.** Gibt die Plattform eine Ablehnung zurück (`PlatformRejectedError`), liest der Kern den
PR einmal neu. Ist er inzwischen gemergt (etwa durch einen zweiten Tab), wird `state = merged` gespeichert und das
Ergebnis ist `skipped` `not_open` mit „Der PR ist bereits gemergt.“. Ist er geschlossen, ist es `not_open` ohne
Zusatztext. Scheitert das Neulesen, bleibt es bei `rejected`.

**Entwurf und Schutz vor dem PUT.** Ein PR mit `blockedReason` `draft` oder `protection` wird schon vor dem PUT als
`rejected` abgelehnt (Abschnitt 6, Nr. 3 und 7). Der PUT entfällt dann.

**Fehler.** Alles andere (`PlatformPermissionError`, `PlatformApiError`, unerwartete Fehler) ist `failed`. Eine
Kontingent-Pause beim PUT ist beim Einzel-Merge `failed` mit der Pause-Meldung; im Sammel-Merge bricht sie den Lauf ab
(Abschnitt 9).

Ein Lesefehler bei der Live-Prüfung ergibt `failed` (eine Kontingent-Pause ausgenommen, Abschnitt 9). `PlatformPermissionError` und `PlatformRejectedError`
führen dort mit ihrem `userMessage` zu `failed`, `PlatformApiError` zu den Meldungen oben, alles andere zu
„Unerwarteter Fehler beim Mergen.“.

## 9. Sammel-Merge: Ablauf je Ziel

`mergeAllGreenCore` arbeitet die Ziele nacheinander ab. Vor jedem Ziel prüft die Zeitgrenze (Abschnitt 10):

1. Nicht offen (Datenbank): `skipped` `not_open`.
2. Typ nicht `patch` oder `minor`: `skipped` `rejected` mit „Nur Patch- und Minor-Updates gehören zum Sammel-Merge.“
3. CI in der Datenbank nicht `success`: `skipped` `ci` mit Status (siehe Abschnitt 6, Nr. 4).
4. Sonst: Pause zum vorherigen Merge (Abschnitt 10), dann Vorprüfung aus Abschnitt 5 und Live-Prüfung und Merge aus den
   Abschnitten 6 bis 8, mit derselben Protokollierung wie beim Einzel-Merge.
5. Meldet der Versuch eine **Kontingent-Pause**, endet der Lauf. Dieses Ziel und alle folgenden gelten als **nicht
   versucht**. Für sie entsteht kein `pr.merge.failed`. Die Pause wird einmal gemeldet, mit Uhrzeit, sobald das
   Reset-Datum bekannt ist.

Schritte 1 bis 3 rufen die Plattform nicht auf. Die Vorprüfung in der Datenbank steht also vor der Vorprüfung aus
Abschnitt 5. Ein Ziel, dessen PR-ID nicht geladen werden konnte, wird als `failed` „Unbekannter Pull Request.“ gezählt
(ohne AuditLog).

## 10. Grenzen und Pausen

| Grenze | Wert | Ort |
|---|---|---|
| Ziele je Sammel-Merge | 20 (`BULK_MERGE_LIMIT`); doppelte IDs zählen einmal; der Rest wird als `ignored` gemeldet | `mergeAllGreenCore`, `listBulkMergeCandidates` (`targets` begrenzt, `total` vor der Grenze) |
| Zod-Obergrenze der Liste | 100 Einträge (`BULK_MERGE_LIMIT * 5`) | `mergeAllGreen` |
| Zeitgrenze des Sammel-Merges | 45 s (`BULK_TIME_LIMIT_MS`), geprüft vor jedem Ziel. Danach werden die übrigen Ziele nicht mehr versucht (`nicht versucht`, kein AuditLog je Ziel). Injizierbar über `timeLimitMs` und `clockMs`. | `mergeAllGreenCore` |
| Pause zwischen Merges | 1 s (`BULK_PAUSE_MS`) vor einem Ziel, wenn der zuletzt **gemergte** PR im selben Repo liegt; über `deps.sleep` ersetzbar | `mergeAllGreenCore` |
| Kontingent-Pause | Lauf endet (Sammel-Merge); Einzel-Merge `failed` mit „Kontingent knapp, wieder möglich ab HH:MM.“ (Europe/Berlin), ohne Zeitpunkt: „Das Kontingent der Plattform ist knapp. Bitte später erneut versuchen.“ | `pauseMessage`, `attemptSingle`, `mergeAllGreenCore` |
| Zweites Lesen von `mergeable` | einmal nach 2 s (`MERGEABLE_RETRY_MS`), nur wenn der PR offen ist und `mergeable` `null` oder fehlt | `GitHubAdapter.getMergeReadiness` |
| `mergeable` bleibt `null` | Ergebnis `null`, im Merge-Kern `pending` | `getMergeReadiness`, `attempt` |

Der Sammel-Merge umfasst nur Patch- und Minor-Updates. Sicherheits-, Major-, Digest- und Lockfile-PRs werden nie
gemergt, auch wenn sie übergeben werden. Die Liste der Kandidaten (`listBulkMergeCandidates`) verlangt: offen, Typ
`patch` oder `minor`, `ci_status = 'success'`, Head-SHA vorhanden, Repo nicht archiviert und nicht entfernt, Installation
vorhanden, mindestens eine Methode. Sortiert nach Repo-Name, dann Alter des PRs, dann Nummer.

## 11. Ergebnis und Meldungen

Einzel-Merge (`mergeOutcomeToState`):

- `merged`: Erfolg mit „<Repo> #<n> ist gemergt (<Methode>).“ und externem Link „PR #<n> auf GitHub ansehen“.
- `skipped`: Warnung „<Repo> #<n> wurde nicht gemergt: <Grund-Meldung>“.
- `failed`: Fehler mit der Meldung aus Abschnitt 8 bzw. 5.

Sammel-Merge (`bulkResultToState`):

- Keine Ergebnisse und nichts nicht versucht: neutral „Es gab keine PRs zum Mergen.“
- Kopf: „<n> PR(s) gemergt, <m> übersprungen.“ Zu „übersprungen“ zählen auch die `failed`-Ergebnisse. Die Einzahl
  und Mehrzahl folgen dem Zählwert (`plural`, etwa „1 PR gemergt“).
- Danach je nicht gemergtem PR „<Repo> #<n>: <Meldung>“.
- Bei Kontingent-Pause: „Kontingent knapp, wieder möglich ab HH:MM.“ oder der Text ohne Uhrzeit.
- Bei nicht versuchten Zielen: „1 PR wurde nicht versucht“ bzw. „2 PRs wurden nicht versucht“, dann „(Zeitgrenze
  erreicht)“ nur bei Abbruch durch die Zeitgrenze, dann „bitte erneut auslösen.“.
- Bei Auslassungen durch die Obergrenze: „1 weiterer PR blieb wegen der Obergrenze von 20 unberührt.“ bzw.
  „2 weitere PRs blieben …“.
- Ton: `warnung`, wenn etwas übersprungen oder nicht versucht wurde, sonst `erfolg`. Nur Fehler (kein Merge, alle
  `failed`, nichts nicht versucht): Fehler mit derselben Meldung.

## 12. AuditLog

Alle Einträge stehen in `audit_log` (Spalte `actor` = Nutzer aus `x-dashboard-user`):

| `action` | `target` | Wann |
|---|---|---|
| `pr.merge` | `<Repo> #<n>` | Erfolgreicher Merge. Wird in derselben Transaktion wie `pull_requests.state = 'merged'` geschrieben. Scheitert die Transaktion nach erfolgtem Merge, schreibt der Kern `pr.merge` ersatzweise separat (best effort). Scheitert auch das, bleibt das Ergebnis `merged`; in der Konsole steht nur eine Meldung ohne Werte, der nächste Abgleich zieht den Stand nach. |
| `pr.merge.skipped` | `<Repo> #<n> (<Grund>)`, Grund ist ein `MergeSkipReason` (z. B. `changed`, `ci`, `rejected`, `not_open`) | Jeder Grund aus den Abschnitten 5, 6, 8 und 9. |
| `pr.merge.failed` | `<Repo> #<n>` | Vorprüfung, Lesefehler, Fehler beim Merge, Kontingent-Pause beim Einzel-Merge. Nicht bei „Unbekannter Pull Request.“, nicht bei Zielen, die im Sammel-Merge nicht versucht wurden. |
| `pr.merge_bulk` | `<n> PRs in <m> Repos` | Einmal je Sammel-Merge, vor dem ersten Ziel. Scheitert er, wird nichts gemergt. |

`pr.merge.skipped` und `pr.merge.failed` werden über `auditQuietly` geschrieben: Ein Fehler dabei wird geloggt
(ohne Werte) und ändert das Ergebnis nicht. Ein Abbruch oder ein Klick auf „Abbrechen“ im Dialog erzeugt keinen Eintrag.

## 13. PlatformAdapter (GitHub)

`getMergeReadiness(conn, repo, number)` liefert `{ state, headSha, mergeable, ci, methods, blockedReason }`:

- `GET repos/{o}/{r}/pulls/{n}` ohne Cache. Ist `mergeable` `null` oder fehlt es bei offenem PR, wird nach 2 s einmal
  neu gelesen. Bleibt es `null`, kommt `null` zurück.
- `blockedReason` aus demselben Abruf: `draft`, wenn `draft === true` oder `mergeable_state === "draft"`;
  `protection`, wenn `mergeable_state === "blocked"`; sonst `null`. `"behind"` ergibt keinen Grund.
- Nur bei offenem PR zusätzlich CI am Head-Commit (`readCi`: `GET …/commits/{ref}/check-runs` und
  `GET …/commits/{ref}/status`) und `GET repos/{o}/{r}` ohne Cache. Die CI-Abrufe laufen über den ETag-Cache (bedingt,
  ein 304 ist unverändert). Sonst `ci: "none"`, `methods: []`, `blockedReason: null`.
- `methods` in der Reihenfolge Squash, Merge-Commit, Rebase, abgeleitet aus `allow_squash_merge`, `allow_merge_commit`,
  `allow_rebase_merge`. Leer, wenn alle drei `false` sind. **`null`**, wenn die Felder in der Antwort fehlen (etwa
  weil die App das Recht nicht hat): „unbekannt“, nicht „keine Methode“.

`mergeChangeRequest(conn, repo, number, { sha, method })`: `PUT …/pulls/{n}/merge` über `write()` (Kontingent-Pause,
sekundäres Rate-Limit). Klassifizierung: Abschnitt 8.

Für den Abgleich (`listRepositories(conn, options?)`): Die Repo-Liste (`GET /installation/repositories`) enthält die drei
`allow_*`-Felder nur mit Schreibrecht. Fehlen sie, liest der Adapter `GET repos/{o}/{r}` bedingt, aber nur, wenn
`options.readMergeMethods` für dieses Repo `true` liefert (ohne Angabe: für jedes nicht archivierte Repo). Archivierte
Repos werden dabei übersprungen. Scheitert der Einzelabruf oder unterbleibt er, bleibt `mergeMethods` unbestimmt
(gespeicherter Stand gilt). Nur eine Kontingent-Pause bricht den Abgleich ab.

Quelle der Merge-Methoden (Task 1.1, Entscheidung 3): **Nicht an der echten Antwort geprüft; auf Entscheidung des
Betreibers entfallen (2026-10-22).** Die lesende Prüfung über die laufende Produktion wurde nicht ausgeführt. Der Code
funktioniert für beide möglichen Antworten.

## 14. Rechte und API-Verbrauch

- Keine neuen App-Rechte. Mergen braucht Schreibrecht auf Contents und Pull requests; PRs, die Workflow-Dateien
  ändern, zusätzlich Workflows. Alle drei sind gesetzt (`vorbereitung.md`, Task 1.3) und im Betrieb belegt: Der
  Onboarding-PR `Hiwamashi/lector#1` (2026-10-21) hat `.github/workflows/build-check.yml` über die App angelegt.
- Einzel-Merge: `GET pulls/{n}`, Check-Runs, Commit-Status, `GET repos/{o}/{r}` (je ein Abruf, die beiden CI-Abrufe
  parallel), dann `PUT …/merge`. Bei `mergeable: null` einmal mehr `GET pulls/{n}`. Ist eine Ablehnung nach dem PUT
  aufgetreten, folgt ein weiterer Readiness-Abruf (`getMergeReadiness`, also dieselben Abrufe wie oben). Ein Sammel-Merge macht das je Ziel.
- Abgleich, Merge-Methoden (`github-sync.ts`): Ein Einzelabruf `GET repos/{o}/{r}` je Repo ist teuer (der ETag ändert
  sich bei jedem Push). Er findet deshalb nur statt für Repos, die **offene Update-PRs** haben oder **keine gespeicherten
  Methoden** (leere Spalte). Repos mit gespeicherten Methoden ohne offenen PR werden übersprungen. Je Repo höchstens
  einmal je Stunde (`MERGE_METHODS_READ_INTERVAL_MS` = 3 600 000 ms, im Speicher je Prozess). Ein 304 kostet kein
  Kontingent.

## 15. Tests

Vitest (`dashboard/`):

- `src/actions/core/merge.test.ts`: Merge-Kern gegen Postgres (`DATABASE_URL`; ohne Variable übersprungen) mit einem
  Fake-Adapter. Deckt Einzel-Merge (Erfolg, `changed`, 409, `conflict`/`pending`, `not_open`, Methoden, `no_method`,
  `method_changed`, `rejected`, `failed`, nicht gespeichertes `merged`), die Ablehnung nach dem PUT (paralleler Merge
  mit `not_open`, weiter offen mit `rejected`), `blockedReason` (Entwurf und Branch-Schutz vor dem PUT, `behind` nie),
  unbekannte Methoden (`null`), die Kontingent-Pause im Einzel- und Sammel-Merge, die Zeitgrenze, den Sammel-Merge
  (gemischte Lage, Pause, ausgenommene Typen, serverseitige Prüfung, Limit, leere Liste, Audit vor dem Start, Einzahl
  der Zählsätze) und `listBulkMergeCandidates`.
- `src/actions/merge.test.ts`: Server-Action-Hüllen (Sitzung, Ungültige Angaben, Ziele, Obergrenze an der Prüfung
  `5 x Limit`).
- `src/platform/github/adapter.test.ts`, Block „Merge: Voraussetzungen, Merge, Methoden“ (msw): `getMergeReadiness`
  (Wartezeit bei `null`, Repo ohne Auskunft zu Methoden als `null`, `draft` aus `draft` oder `mergeable_state`),
  `mergeChangeRequest` (200, 405, 409, 422, Klassifizierung der Texte, Workflow-Recht vor 405/409/422, Check namens
  „workflow“ kein Rechtefehler, 403 mit und ohne Branch-Schutz, Kontingent-Pause ohne Merge), `allow_*`-Felder aus
  der Listenantwort und `readMergeMethods`.
- `src/sync/sync.test.ts` (Postgres): `merge_methods` nach dem Abgleich (leer, unbekannt, Änderung) und die Drosselung
  (offene PRs oder leere Spalte, höchstens stündlich).
- `src/domain/report.test.ts`: Merge-Aktion im Lagebericht für grüne Sicherheits- und Major-Updates.
- `src/queries/repo-detail.test.ts`: Die Repo-Detailabfrage reicht `headSha` und `mergeMethods` je offenem PR weiter.

Playwright (`dashboard/e2e/merge.spec.ts`, gegen Fake-Authelia und Fake-CE, mit `E2E_FAKE_PLATFORM=1`):

- „Mergen in der PR-Liste“ und „Mergen im Lagebericht“: wo der Knopf erscheint, Dialoginhalt, Abbrechen ohne AuditLog,
  Repo mit nur Merge-Commit, rote CI, Repo ohne Methode, Repo-Detail.
- „Sammel-Merge“: Zahl im Knopf, Dialog, Filter ändern die Zahl nicht, kein Knopf ohne Kandidaten.
- „Handy“: Kartenknöpfe mit mindestens 44 px.
- „Mergen ausführen“: Erfolg in der Liste (Status und AuditLog), neuer Commit seit dem Klick (Meldung nennt den
  Grund), Lagebericht, gemischte Sammel-Lage.

Die Fixtures (`dashboard/src/db/fixtures.ts`): Repo `lager-sync` erlaubt nur `merge`; alle anderen Fixture-Repos
erlauben `squash` und `merge` (Vorgabe). Fixture-PRs bekommen einen erfundenen Head-Commit (`e2e<n>` mit Auffüllung
auf 40 Zeichen).

Plattform-Ersatz für E2E (`dashboard/src/rollout/e2e-fake-adapter.ts`, nur wenn `NODE_ENV !== "production"` und
`E2E_FAKE_PLATFORM=1`): `getMergeReadiness` liest den Stand aus der Datenbank, meldet `mergeable: true` und die Methoden
aus `repositories.merge_methods` in Vorzugsreihenfolge. Die CI und der Zustand kommen aus den Fixtures. `mergeChangeRequest`
ohne Netz prüft nur die SHA-Bindung (bei Abweichung `PlatformHeadChangedError`, also 409). Tests ändern den Stand per SQL,
um Abweichungen zu erzeugen. Ein Konflikt lässt sich im Ersatz nicht darstellen (`mergeable` ist fest `true`). Eine
Änderung der erlaubten Methoden wirkt dagegen, weil der Ersatz sie aus `repositories.merge_methods` liest. Die Fälle
`conflict`, `pending`, `blockedReason` und die Klassifizierung der Plattformtexte prüfen die Vitest-Tests.

## 16. Offene Punkte

- TODO: Task 1.1 (Prüfung, ob `GET /installation/repositories` die Felder `allow_*` in der Produktion liefert) ist auf
  Entscheidung des Betreibers entfallen. Offen bleibt, wie viele Einzelabrufe `repos/{o}/{r}` der Abgleich im Betrieb
  tatsächlich macht. Siehe Abschnitt 13.
- TODO: Die Klassifizierung der Plattformtexte (Abschnitt 8) stützt sich auf Muster im Code und Tests, nicht auf
  beobachtete Live-Antworten der Plattform. Ob die Muster zu den echten GitHub-Meldungen passen, ist nicht geprüft.

## 17. Verwandte Dokumente

- `feature-documentation/dashboard/aktionen.md`: Bestätigungsdialog, `ActionResult`, Server-Action-Grundlagen.
- `feature-documentation/dashboard/datenmodell.md`: Spalte `repositories.merge_methods`, Migration `0003`.
- `feature-documentation/dashboard/abgleich.md`: Abgleich, der `merge_methods` füllt.
- `feature-documentation/dashboard/lagebericht.md`: Schritte und Erledigt-Logik im Lagebericht.
- `openspec/changes/dashboard-pr-merge/`: Anforderungen (Scenarios) und Entscheidungen.
