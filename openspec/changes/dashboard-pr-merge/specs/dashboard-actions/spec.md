# Spec Delta

## ADDED Requirements

### Requirement: PR im Dashboard mergen
Der Betreiber MUST einen offenen Renovate-PR mit grüner CI im Dashboard mergen können. Unmittelbar
vor dem Merge MUST das Dashboard live auf der Plattform prüfen:
- Der PR ist offen.
- Der Head-Commit ist derselbe wie beim Klick.
- Die CI dieses Commits ist grün.
- Der PR ist konfliktfrei.

Ist eine dieser Bedingungen nicht erfüllt, MUST NOT gemergt werden. Die Meldung MUST den Grund
nennen. Ein PR ohne CI gilt nicht als grün. Branch-Schutzregeln der Plattform MUST das Dashboard
nicht umgehen. Lehnt die Plattform den Merge ab, MUST die Meldung das sagen. Jeder Merge-Versuch
MUST im AuditLog stehen, auch ein abgelehnter.

#### Scenario: Grüner PR
- **WHEN** der Betreiber für einen offenen PR mit grüner CI „Mergen“ bestätigt
- **THEN** ist der PR gemergt, das Dashboard zeigt ihn sofort als gemergt, und die Meldung verlinkt
  den PR

#### Scenario: Neuer Commit seit dem Klick
- **WHEN** Renovate den PR zwischen Anzeige und Bestätigung neu gebaut hat
- **THEN** wird nicht gemergt, und die Meldung sagt, dass sich der PR geändert hat

#### Scenario: CI inzwischen rot oder laufend
- **WHEN** die Live-Prüfung ergibt, dass die CI des aktuellen Commits nicht grün ist
- **THEN** wird nicht gemergt, und die Meldung nennt den CI-Status

#### Scenario: Konflikt
- **WHEN** der PR Konflikte mit dem Ziel-Branch hat
- **THEN** wird nicht gemergt, und die Meldung nennt den Konflikt

### Requirement: Merge-Methode wie im Repo erlaubt
Das Dashboard MUST die Merge-Methode verwenden, die das Repo erlaubt. Bevorzugt wird Squash, dann
Merge-Commit, dann Rebase. Der Bestätigungsdialog MUST die Methode nennen. Hat sich die erlaubte
Methode seit der Anzeige geändert, MUST die Live-Prüfung die aktuelle Einstellung verwenden.
Erlaubt das Repo keine dieser Methoden, MUST NOT gemergt werden.

#### Scenario: Squash erlaubt
- **WHEN** das Repo Squash und Merge-Commit erlaubt
- **THEN** nennt der Dialog „Squash“, und der PR wird per Squash gemergt

#### Scenario: Nur Merge-Commit
- **WHEN** das Repo nur Merge-Commits erlaubt
- **THEN** nennt der Dialog „Merge-Commit“, und so wird gemergt

### Requirement: Sammel-Merge grüner Patch- und Minor-PRs
Der Betreiber MUST alle offenen PRs mit Update-Typ Patch oder Minor und grüner CI in einem Schritt
mergen können. Dabei gilt:
- Sicherheits-, Major-, Digest- und Lockfile-PRs sind ausgenommen.
- Je Auslösung werden höchstens 20 PRs gemergt.
- Der Bestätigungsdialog nennt die Anzahl der PRs und Repos.
- Jeder PR durchläuft dieselbe Live-Prüfung wie beim Einzel-Merge.
- Ein PR, der die Prüfung nicht besteht, wird übersprungen, und die übrigen werden weiter
  verarbeitet.
- Die Meldung MUST die Zahl der gemergten und der übersprungenen PRs nennen, mit Grund je
  übersprungenem PR.
- Der Sammel-Merge MUST einen AuditLog-Eintrag erhalten, dazu jeder einzelne Merge-Versuch einen
  eigenen.

#### Scenario: Gemischte Lage
- **WHEN** drei grüne Patch-PRs offen sind und einer davon seit der Anzeige einen neuen Commit hat
- **THEN** werden zwei gemergt, einer wird mit Grund übersprungen, und die Meldung nennt beides

#### Scenario: Ausgenommene Typen
- **WHEN** ein grüner Sicherheits-PR und ein grüner Major-PR offen sind
- **THEN** erfasst der Sammel-Merge keinen von beiden
