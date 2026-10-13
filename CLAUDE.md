# CLAUDE.md

Zentrale, selbst gehostete Renovate-Plattform (Mend Renovate CE + Next.js-Status-Dashboard) für die GitHub-Repos von Hiwamashi und Krinke-IT-Consulting — Anforderungen siehe `PRD.md`.

## LLM-Gateway — Label-Pflicht

> **Verbindlich, nicht abwählbar.** Jede Claude-Code-Session in diesem Projekt
> trägt das Repo-Label `x-bf-lh-repo: Krinke-IT-Consulting/renovate`. Über dieses Label erfasst
> das WRS-LLM-Gateway (Bifrost) Token-Verbrauch und Kosten je Repository — ohne
> Label ist die Nutzung dieses Projekts nicht zuordenbar. Ein separates
> Token-Protokoll in der Codebase ist deshalb nicht nötig und wird nicht geführt.

**Der Header-Name ist nicht frei wählbar.** Bifrost protokolliert Header nicht von
sich aus; automatisch in die Log-Metadaten übernommen wird nur, was den Präfix
`x-bf-lh-` trägt — der Präfix fällt dabei weg, der Rest wird zum Metadaten-Schlüssel
(`repo`). Der früher verwendete Header `x-bf-label` liegt dagegen in Bifrosts
eigenem Steuer-Namensraum, ist dort keine Funktion und wird verworfen: Die
Kostenzuordnung über Labels blieb dadurch von Juli bis September 2026 durchgehend
leer. Den Namen nicht zurückändern und nicht „aufräumen".

Gesetzt wird das Label projektweit über `env` in der eingecheckten
`.claude/settings.json` — nicht über persönliche Shell-Wrapper. Damit gilt es
für jeden, der das Repo klont:

```json
{
  "env": {
    "ANTHROPIC_CUSTOM_HEADERS": "x-bf-lh-repo: Krinke-IT-Consulting/renovate"
  }
}
```

**Die Gateway-Anbindung selbst ist optional.** Base-URL und Key gehören nicht
zum verbindlichen Teil:

- `ANTHROPIC_BASE_URL` steht nur dann in der `settings.json`, wenn dieses Projekt
  bewusst über das Gateway läuft:

  ```json
  {
    "env": {
      "ANTHROPIC_BASE_URL": "<GATEWAY-URL>",
      "ANTHROPIC_CUSTOM_HEADERS": "x-bf-lh-repo: Krinke-IT-Consulting/renovate"
    }
  }
  ```

  Fehlt der Eintrag, läuft die Session an einem anderen Endpunkt und das Label
  wird nirgends ausgewertet. Es bleibt trotzdem gesetzt — es kostet nichts und
  greift, sobald jemand die Session doch über das Gateway führt.
- Der Gateway-Key gehört **nie** ins Repository. Er wird lokal gesetzt — per
  `ANTHROPIC_AUTH_TOKEN` in der Shell oder in `.claude/settings.local.json`
  (gitignored) — oder er fehlt schlicht, wenn kein Gateway im Spiel ist.

Ein SessionStart-Hook (`.claude/scripts/set-repo-header.sh --hook`) prüft bei
jedem Start, ob das Label gesetzt ist und zum aktuellen Repository passt.
Fehlende Base-URL und fehlender Key ergeben dort einen **Hinweis**, keinen
Fehler.

**Regeln für KI-Agenten in diesem Projekt:**

- Den `env`-Eintrag `ANTHROPIC_CUSTOM_HEADERS` und den SessionStart-Hook nicht
  entfernen, umbenennen oder auf einen anderen Wert setzen.
- Meldet der Hook ein **fehlendes oder abweichendes Label**, ist das ein
  Konfigurationsfehler und **keine** Nebensächlichkeit: melde ihn dem Nutzer,
  bevor du inhaltlich weiterarbeitest. Hinweise zur optionalen Gateway-Anbindung
  (Base-URL, Key) sind dagegen kein Grund, die Arbeit zu unterbrechen.
- Wird das Repository umbenannt, verschoben oder geforkt, ändert sich das
  erwartete Label. Dann `/wrs-agent-rules` erneut ausführen, statt den Wert von
  Hand zu raten.

## Geheimnisse und Konfigurationswerte

Diese Regel gilt für jeden Wert, der nicht im Repository stehen darf: Zugangsschlüssel,
Client-Geheimnisse, Verbindungszeichenfolgen, selbst erzeugte Signaturschlüssel — etwa API-Keys
von Fremdsystemen (Shop, ERP, Kasse), Service-Account-Schlüssel oder Zugangsdaten zu
Produktivdatenbanken.

### Welche `.env`-Datei wofür

Jede Umgebung hat genau eine eigene Datei. Andere Namen und Mischformen gibt es nicht.

| Datei | Zweck | Versioniert? |
|---|---|---|
| `.env.example` | Vorlage: jeder Name mit leerem Wert und Herkunftskommentar | ja |
| `.env.local` (oder `.env`, wenn das Framework nur diese lädt — pro Projekt eine von beiden) | **lokaler Betrieb** auf dem eigenen Rechner | **nein, gitignored** |
| `.env.<umgebung>`, also `.env.production`, `.env.stage` usw. | **Spiegel eines Deployment-Ziels**: genau die Werte, die auf der Plattform für diese Umgebung hinterlegt sind | **nein, gitignored** |

- Lokal läuft die Anwendung **immer** mit `.env.local` bzw. `.env` — nie mit `.env.production`
  oder einer anderen Deployment-Datei. Wer lokal gegen ein Produktivsystem arbeiten muss, trägt
  die nötigen Werte bewusst in `.env.local` ein.
- `.env.<umgebung>` wird von keinem lokalen Startbefehl geladen. Sie dokumentiert den Stand der
  jeweiligen Umgebung, damit sich deren Verhalten nachvollziehen und die Plattform neu befüllen
  lässt.
- Der Name der Umgebung entspricht dem Deployment-Ziel (`production`, `stage`, …). Für jedes
  Ziel, das es gibt, existiert genau eine Datei; für Ziele, die es nicht gibt, keine.
- `.gitignore` nimmt alle `.env*`-Dateien aus — mit Ausnahme von `.env.example`.

### Die Stellen eines Konfigurationswerts

Ein neuer Konfigurationswert wird an allen folgenden Stellen eingetragen, sonst an keiner:

| Stelle | Was dort steht | Versioniert? |
|---|---|---|
| Env-Schema der Komponente (die zentrale Konfigurationsdatei, etwa `config.py` oder `env.ts`) | Name, Typ, Pflicht oder optional, Vorgabewert | ja |
| `.env.example` | Name mit leerem Wert, plus Kommentar woher der Wert kommt | ja |
| `.env.local` bzw. `.env` | der Wert für den lokalen Betrieb | **nein** |
| `.env.<umgebung>` je Deployment-Ziel | der Wert, der in dieser Umgebung gilt | **nein** |
| Deployment-Plattform (Variable bzw. Secret, etwa in Coolify) + Durchreichung in der Compose- bzw. Deployment-Datei | eine Hülle mit Platzhalter, die ein Mensch später befüllt | die Compose-Datei ja, der Wert nein |

Fehlt eine davon, ist die Aufgabe **nicht** erledigt. Ein Wert, der nur in einer `.env`-Datei
auftaucht, ist für den nächsten Menschen unsichtbar; einer, der nur im Schema steht, lässt die
Anwendung beim Start abbrechen. Kennt der Wert noch keinen Inhalt (etwa weil ein Mensch ihn
liefern muss), steht der Name trotzdem in jeder Datei — mit leerem Wert.

`.env.example` ist zugleich das **Interface für jeden, der das Projekt neu aufsetzt**: Jeder
Eintrag trägt einen Kommentar, woher der Wert kommt und ob er zwingend ist. Eine Variable, die nur
der Erstautor erraten kann, ist ein Fehler.

Wird deployt und dabei eine neue Umgebungsvariable oder ein neues Secret angelegt, gehört derselbe
Wert **im selben Arbeitsschritt** in die `.env.<umgebung>` dieses Ziels — sonst lässt sich das
Verhalten der Umgebung nicht mehr nachstellen.

### Wer den Wert liefert — und was das für dich heißt

Für jeden Wert ist festzuhalten, woher er stammt. Es gibt genau drei Herkünfte:

1. **Vom Menschen** — etwa ein API-Key, den ein Dienstleister ausstellt. Du erzeugst ihn nicht,
   du forderst ihn an und trägst ihn nirgends selbst ein.
2. **Von der Infrastruktur** — etwa Keys, die eine Plattform beim Anlegen eines Projekts oder
   einer Datenbank erzeugt. Der Wert entsteht erst beim Bereitstellen.
3. **Selbst erzeugt** — etwa ein Client-Token oder ein Signaturschlüssel. **Das ist der Fall, der
   besondere Sorgfalt verlangt.**

Wenn du einen Wert selbst erzeugst, gilt zusätzlich:

- Trage ihn **unmittelbar** in jede `.env`-Datei ein, in der er gilt (`.env.local` bzw. `.env`
  und/oder `.env.<umgebung>`) — nicht „später", nicht im Bericht.
- Nenne im Bericht nur den Namen, niemals den Wert, auch nicht gekürzt.
- Halte in `feature-documentation/secrets-register.md` fest: Name, Herkunft, Zweck, wo er im
  Betrieb herkommt, und wie er sich neu erzeugen lässt.
- Ein selbst erzeugter Wert, der nur im Kopf eines Agenten existierte und nie in einer
  `.env`-Datei landete, ist verloren — die Anwendung lässt sich dann lokal nicht mehr
  starten, ohne dass jemand versteht warum.

### Was niemals passiert

- Ein echter Wert in `.env.example`, in einer Migration, in einer Compose- oder Dockerfile-Vorlage,
  in einem Test, in einem Commit oder in einer Protokollausgabe.
- Ein Wert in einem Subagenten-Bericht — auch nicht maskiert. Berichte nennen Namen, keine Werte.
- Eine Fehlermeldung, die den Wert eines fehlenden oder ungültigen Eintrags ausgibt.
  Fehlermeldungen nennen den **Namen** der Variablen, nie ihren Inhalt.
- Ein Zugangstoken, das die Anwendung selbst an Clients ausgibt, im Klartext irgendwo außer in
  der einmaligen Anzeige bei der Ausgabe; gespeichert wird nur der Hash.

### Lokale Entwicklungszugangsdaten sind keine Geheimnisse

Die Zugangsdaten lokaler Docker-Dienste (etwa einer lokalen Datenbank) dürfen bewusst mit echten
Werten in `.env.example` stehen. Sie gehören zu Wegwerf-Containern und sind kein Geheimnis im
Sinne dieser Regel. Die Unterscheidung ist: **Betrifft der Wert ein System außerhalb dieses
Rechners?** Dann ist er ein Geheimnis.

## Dokumentations-Richtlinie

> Im Ordner `feature-documentation/` müssen alle neuen Funktionen und Features sowie deren Anpassungen in einzelnen `.md`-Dateien im Markdown-Format dokumentiert werden. Pro Funktion und Markdown eine Datei. Sollte ein Feature aus mehreren Funktionen bestehen, dürfen Unterordner pro Feature angelegt werden. Diese Dokumentation dient vor allem anderen KI-Coding-Agenten zum besseren Verständnis der Codebase.

> Der aktuelle Entwicklungsfortschritt ist fortlaufend in einer `PROGRESS.md` im Projekt-Root zu dokumentieren. Dort wird festgehalten, welche Features bereits umgesetzt sind, welche in Arbeit sind und welche noch ausstehen. So haben alle Beteiligten (Mensch und KI-Agent) jederzeit einen aktuellen Überblick über den Stand der Entwicklung.

## Graphify — Codebase Knowledge Graph

Dieses Projekt nutzt [Graphify](https://github.com/safishamsi/graphify/tree/v8)
zur strukturierten Codebase-Analyse.

### Setup (einmalig pro Repo)

Wenn `graphify-out/` nicht existiert oder `graphify-out/graph.json` fehlt:

1. Prüfe, ob `graphify` als CLI verfügbar ist (`graphify --version`).
   Falls nicht: `uv tool install graphifyy`
2. Prüfe, ob der Graphify-Skill registriert ist (`~/.claude/skills/graphify/`).
   Falls nicht: `graphify install`
3. Erkenne relevante Dateitypen im Repo und installiere passende Extras:
   - `.pdf` vorhanden → `uv tool install "graphifyy[pdf]"`
   - `.docx` / `.xlsx` vorhanden → `uv tool install "graphifyy[office]"`
   - `.sql` vorhanden → `uv tool install "graphifyy[sql]"`
   - `.mp4` / `.mov` / `.mp3` vorhanden → `uv tool install "graphifyy[video]"`
   - Im Zweifel: `uv tool install "graphifyy[all]"`
4. Baue den Graphen: `/graphify .`
5. Registriere im Global Graph: `graphify global add graphify-out/graph.json --as <repo-name>`
   Verwende den Verzeichnisnamen als `<repo-name>`.
6. Generiere die Architekturübersicht: `graphify export callflow-html`
7. Registriere Graphify für dieses Repo: `graphify claude install`
8. **Nur nach expliziter Freigabe durch den Benutzer:**
   Schlage `graphify hook install` vor (auto-rebuild bei git commit).
   Erkläre kurz, was der Hook tut, und warte auf Bestätigung.

### Nutzung

- Lies `graphify-out/GRAPH_REPORT.md` bevor du Architektur- oder
  Abhängigkeitsfragen beantwortest.
- Nutze `graphify query "<frage>"` für Strukturfragen, bevor du
  manuell Dateien durchsuchst.
- Nutze `graphify explain "<Knoten>"` um einzelne Konzepte zu verstehen.
- Nutze `graphify path "<A>" "<B>"` um Verbindungen zwischen
  Komponenten zu finden.
- Bei `AMBIGUOUS`-Kanten im Graphen: Quellcode gegenchecken.

### Aktualisierung

- Nach größeren Refactorings: `/graphify . --force`
- Nach Änderungen an Docs/PDFs: `/graphify . --update`
- Callflow-Export aktualisieren: `graphify export callflow-html`

## OpenSpec — Spec-Driven Development

Dieses Projekt nutzt [OpenSpec](https://github.com/Fission-AI/OpenSpec), um
Änderungen vor der Umsetzung als Spezifikation festzuhalten. Die gültigen Specs
liegen unter `openspec/specs/`, laufende Änderungen unter `openspec/changes/`.

### Setup (einmalig pro Repo)

Wenn `openspec/` nicht existiert:

1. Prüfe, ob `openspec` als CLI verfügbar ist (`openspec --version`).
   Falls nicht: `npm install -g @fission-ai/openspec`
2. Initialisiere das Repo: `openspec init --tools claude`
   Das legt `openspec/` sowie die Skills `.claude/skills/openspec-*` und die
   Kommandos `.claude/commands/opsx/` an — alles wird mit eingecheckt.
3. Trage Tech-Stack, Konventionen und Fachbegriffe als `context` in
   `openspec/config.yaml` ein, damit neue Artefakte darauf aufbauen.

### Nutzung

- Für neue Funktionen und Verhaltensänderungen, die mehr als eine Datei
  betreffen: zuerst einen Change anlegen (`/opsx:propose`), dann umsetzen
  (`/opsx:apply`), nach Abschluss archivieren (`/opsx:archive`).
- Bei unklaren Anforderungen erst `/opsx:explore` nutzen, statt direkt einen
  Change zu schreiben.
- Kleine Bugfixes, Tippfehler und reine Refactorings ohne Verhaltensänderung
  brauchen keinen Change.
- Lies vor Änderungen an einem Bereich die passende Spec unter `openspec/specs/`.
  Weicht der Code von der Spec ab, sprich den Widerspruch an, statt ihn still
  in eine Richtung aufzulösen.
- Prüfe Changes mit `openspec validate`, bevor du sie zur Umsetzung freigibst.

### Aktualisierung

- Nach einem Update der CLI: `openspec update`, damit die Skills und Kommandos
  im Repo zur installierten Version passen.

## Impeccable — Frontend-Design

Dieses Projekt nutzt [Impeccable](https://github.com/pbakaus/impeccable) für
Gestaltung und Qualitätsprüfung der Oberfläche. Produktwissen steht in
`PRODUCT.md`, die visuelle Sprache in `DESIGN.md`.

### Setup (einmalig pro Repo)

1. Prüfe, ob der Impeccable-Skill verfügbar ist (`~/.claude/skills/impeccable/`
   oder `.claude/skills/impeccable/`). Falls nicht:
   `npx skills add pbakaus/impeccable`
2. Fehlt `PRODUCT.md`: `/impeccable init` — erfasst Zielgruppe, Zweck und
   feste Vorgaben des Produkts.
3. Fehlt `DESIGN.md` und gibt es bereits eine Oberfläche:
   `/impeccable document` — leitet die vorhandene visuelle Sprache aus dem Code ab.
   Gilt für das Projekt ein Marken-Design-System der WRS-Gruppe (JAC, WEIN & CO,
   WRS), ist dieses die Vorgabe für `DESIGN.md`.
4. **Nur nach expliziter Freigabe durch den Benutzer:**
   Schlage `/impeccable hooks on` vor (Design-Prüfung nach jeder Änderung an
   UI-Dateien). Der Hook wird maschinenlokal in `.claude/settings.local.json`
   eingetragen. Erkläre kurz, was er tut, und warte auf Bestätigung.

### Nutzung

- Bei Arbeit an der Oberfläche (Seiten, Komponenten, Formulare, Styles) den
  Impeccable-Skill verwenden, statt ohne Designgrundlage zu gestalten.
- Vor dem Bau einer neuen Oberfläche: `/impeccable shape` für UX und Aufbau.
- Vor Abschluss einer UI-Änderung: `/impeccable audit` (Barrierefreiheit,
  Performance, Responsive) und bei Bedarf `/impeccable polish`.
- Für Review-Fragen zur Gestaltung: `/impeccable critique`.
- `PRODUCT.md` und `DESIGN.md` sind verbindlich. Widerspricht eine Anforderung
  ihnen, sprich es an, statt eine der Dateien still zu umgehen.

### Aktualisierung

- Ändert sich die visuelle Sprache grundlegend: `DESIGN.md` mit
  `/impeccable document` neu erzeugen, statt sie von Hand auseinanderlaufen zu lassen.

## Subagents proaktiv nutzen

- Prüfe bei jeder nicht-trivialen Aufgabe, ob sie sich für die Delegation an einen Subagent (Agent/Task-Tool) eignet – insbesondere bei:
  - breiter Codebase-Recherche (mehr als ~3 Suchanfragen)
  - unabhängigen, parallelisierbaren Teilaufgaben
  - Aufgaben, die viel Kontext (Logs, große Dateien) erzeugen würden
- Wenn eine Delegation sinnvoll ist, schlage sie **aktiv vor**, bevor du selbst loslegst: nenne kurz den Subagent-Typ und warum.
- Bei mehreren unabhängigen Teilaufgaben: schlage vor, sie parallel über mehrere Subagents laufen zu lassen.

### Beispielhafte Subagent-Rollen

Die folgenden Rollen sind **nur Beispiele** zur Orientierung, keine abschließende Liste. Leite passende Subagents jeweils aus der konkreten Aufgabe und aus dem ab, was dieses Projekt tatsächlich braucht:

- **Dokumentations-Experte** – Erstellt/aktualisiert Doku (z.B. `feature-documentation/`, README, Changelog). Vorschlagen, wenn neue Funktionen ergänzt oder bestehende geändert wurden und die Doku nachgezogen werden muss.
- **Code-Reviewer** – Prüft Diffs auf Bugs, Sicherheitslücken (OWASP), Performance und Stil. Vorschlagen nach größeren Änderungen oder vor einem Commit/PR. **Prüfe aber zuerst, ob bereits Hooks, Review-Gates oder Review-Skills (z.B. pre-commit-Hooks, CI-Checks, ein `/code-review`-Skill oder ein konfiguriertes Stop-Review-Gate) vorhanden sind** – wenn ja, nutze bzw. verweise auf diese, statt einen zusätzlichen Review-Subagent doppelt einzusetzen.
- **Recherche-/Explore-Experte** – Durchsucht die Codebase oder externe Quellen und liefert eine verdichtete Zusammenfassung. Vorschlagen bei "Wo ist X?", "Wie hängt Y zusammen?" oder breiter Architektur-Recherche.
- **Test-/Verifikations-Experte** – Führt Tests, Builds oder Linting aus und meldet nur das Ergebnis zurück. Vorschlagen, bevor eine Änderung als fertig gemeldet wird.
- **Refactoring-Experte** – Nimmt mechanische Umbenennungen/Umstrukturierungen über viele Dateien vor. Vorschlagen bei wiederkehrenden Änderungen an vielen Stellen.
- **Datenbank-/Migrations-Experte** – Prüft Schema-Änderungen und Migrationen auf Sicherheit. Vorschlagen bei Eingriffen in DB-Struktur oder Migrationen.

Passt eine dieser Rollen nicht zum Projekt, ist eine **projektspezifische Rolle die bessere Wahl** – etwa ein Experte für die eingesetzte Kassen-, Shop- oder ERP-Schnittstelle, für ein bestimmtes Framework oder für einen wiederkehrenden Datenimport. Solche Rollen aus dem Projekt ableiten und benennen, statt eine der Beispielrollen zu verbiegen.

Diese Rollen kannst du entweder ad-hoc über das Agent/Task-Tool ansprechen oder als feste Subagents unter `~/.claude/agents/` bzw. `.claude/agents/` definieren (mit `use proactively` in der `description`).

