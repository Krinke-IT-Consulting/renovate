# Tasks

## 1. Shared Preset

- [x] 1.1 `default.json` mit Basis anlegen: `$schema`, `config:recommended`,
  `helpers:pinGitHubActionDigests`, `dependencyDashboard`, `timezone: "Europe/Berlin"`,
  `schedule: ["* * * * 0,6"]`, Labels, Semantic Commits (`chore(deps)`), `prConcurrentLimit: 5`,
  `prHourlyLimit: 2`, `platformAutomerge: false`, `automergeType: "pr"` — prüfen mit
  `npx --yes --package renovate renovate-config-validator --strict --no-global default.json` (keine Fehler,
  keine Warnungen)
- [x] 1.2 `packageRules` ergänzen: Minor-Gruppe (`minor`, kein Automerge), danach Patch-Gruppe
  (`patch`, `digest`, `pin`, `pinDigest`, Automerge) und devDependency-Minor-Regel in der
  Patch-Gruppe; Major mit `dependencyDashboardApproval: true`; `addLabels` je Update-Typ —
  Reihenfolge laut design.md Entscheidung 1, Validator erneut grün
- [x] 1.3 Block `vulnerabilityAlerts` (Label `security`, `schedule: ["at any time"]`, keine
  Gruppe, keine Freigabe, kein Automerge; `prPriority` dort unzulässig, entfällt) und `osvVulnerabilityAlerts: true`
  ergänzen — Validator grün
- [x] 1.4 Aufgelöste Konfiguration prüfen: `renovate --print-config` bzw. eine Dry-Run-Ausgabe für
  ein Beispiel-`package.json` (Patch, Minor Laufzeit, Minor devDependency, Major) im Scratchpad
  zeigt genau die Zuordnung aus dem Szenario „Gemischte Updates in einem Repo" (Ergebnis im
  Abschnitt Prüfung der Feature-Doku festhalten)

## 2. Globale CE-Konfiguration

- [x] 2.1 `renovate-ce/config.js` laut design.md Entscheidung 8 anlegen (`onboarding: false`,
  `requireConfig: "required"`, `binarySource: "install"`, bedingte Scaleway-`hostRules`) —
  prüfen mit `node --check renovate-ce/config.js` und
  `RENOVATE_CONFIG_FILE=renovate-ce/config.js npx --yes --package renovate renovate-config-validator --strict`
- [x] 2.2 Laden mit und ohne Variable prüfen: `node -e` lädt die Datei einmal ohne und einmal
  mit gesetztem `SCW_REGISTRY_SECRET_KEY` (Dummywert im Kommando) und gibt nur die Zahl der
  `hostRules` aus (0 bzw. 1), niemals den Wert
- [x] 2.3 `SCW_REGISTRY_SECRET_KEY` in `.env.example` mit leerem Wert und Herkunftskommentar
  eintragen (Mensch, Scaleway-IAM-API-Key nur mit Registry-Lesen, optional) — `.env.example`
  existiert und ist nicht durch `.gitignore` ausgenommen (`git check-ignore` liefert nichts)

- [x] 2.4 Scaleway-Region in `renovate-ce/config.js`, Feature-Doku und Kommentaren von `fr-par` auf
  `nl-ams` umstellen (Registry `rg.nl-ams.scw.cloud`, Namespace `krinke-dockersolutions` öffentlich)
  — `grep -rn fr-par` ohne Treffer außerhalb des Archivs, Prüfungen aus 2.1 und 2.2 erneut grün

## 3. Repo-Konfiguration und Vorlage

- [x] 3.1 `renovate.json` im Repo-Root mit `extends: ["local>Krinke-IT-Consulting/renovate"]`
  anlegen — Validator grün
- [x] 3.2 `templates/renovate.json` mit `$schema` und
  `extends: ["github>Krinke-IT-Consulting/renovate"]` anlegen — Validator grün, Inhalt entspricht
  dem Spec-Szenario „Inhalt der Vorlage"

## 4. Validierung in CI

- [x] 4.1 `.github/workflows/validate-renovate.yml` anlegen (Push und PR auf die
  Konfigurationspfade, `permissions: contents: read`, Actions auf Digest gepinnt, gepinnte
  Renovate-Version, Validierung aller JSON-Dateien und von `config.js`) — prüfen mit
  `actionlint` (falls lokal vorhanden, sonst per `npx`) und einem lokalen Lauf der identischen
  Validator-Befehle
- [x] 4.2 Negativtest: unbekannte Option temporär in eine Kopie von `default.json` im
  Scratchpad einfügen und bestätigen, dass der Validator mit Exit-Code ≠ 0 und Dateinamen
  abbricht

## 5. Verifikation am Test-Repo (erst nach dem Compose-Change, wenn CE läuft)

- [ ] 5.1 Ein Test-Repo onboarden und bestätigen: kein Automerge ohne Status-Checks
  (Szenario „Repo ohne Status-Checks")
- [ ] 5.2 Bestätigen, dass Sicherheits-PRs `prConcurrentLimit`/`prHourlyLimit` umgehen; andernfalls
  die Limits im Block `vulnerabilityAlerts` auf 0 setzen (design.md Entscheidung 5)
- [ ] 5.3 Bestätigen, dass Major-Updates nur im Dependency Dashboard erscheinen und erst nach
  dem Anhaken einen PR erhalten

## 6. Dokumentation

- [x] 6.1 `feature-documentation/renovate-konfiguration.md` schreiben: Regeln des Presets in
  Tabellenform, Aufbau von `config.js`, Validierung, bewusste Entscheidungen (Gruppierung 1a,
  Wochenend-Zeitplan 2a, kein GitHub-Auto-Merge) und Ergebnis von Task 1.4
- [x] 6.2 `PROGRESS.md` aktualisieren (Gruppen 1–4 und 6 umgesetzt, Gruppe 5 ausstehend bis
  Compose-Stack) und `openspec validate renovate-konfiguration --strict` grün
