# Voraussichtliche Kostenschätzung: Claude-Code-/API-Kosten

> Eigenständiger Bericht zu `PRD.md`, kein Teil des PRD. Erstellt am 2026-10-13.

## 1. Projekt

**Renovate-Plattform Krinke IT** (`Krinke-IT-Consulting/renovate`)

Selbst gehostetes Mend Renovate CE für 10–50 GitHub-Repos aus `Hiwamashi` und `Krinke-IT-Consulting`, mit Shared Preset, Reusable Build-Check-Workflow und Automerge-Regeln. Dazu kommt ein eigenes Next.js-Dashboard hinter Authelia, das den Status aller Repos, PRs und Jobs zeigt und das Onboarding per PR übernimmt; alles als Compose-Stack auf Coolify.

## 2. Annahmen

- **Preisbasis:** Anthropic-Listenpreise der aktuellen Modelle, live abgerufen am **2026-10-13** von `platform.claude.com/docs/en/about-claude/pricing`. Das ist bewusst die teuerste Route und damit eine **konservative Obergrenze**; günstigere Wege (Gateway, Bedrock, Batch) sind möglich.
- **Cache-Schreibpreis:** Der **1-Stunden-Cache** (Claude Code arbeitet in dieser Umgebung mit 1-h-TTL). Das ist der teurere der beiden Cache-Write-Tarife.
- **Mengenbasis:** `ist-kennzahlen.md`, **Stand August 2026** (über 55.000 Gateway-Requests). Die Daten sind etwa zwei Monate alt, also innerhalb der Verfallsfrist von sechs Monaten.
- **Scope laut PRD:**
  - Renovate-CE-Konfiguration (`config.js`), Shared Preset (`default.json`), Reusable Workflow für 5 Ökosysteme
  - Compose-Stack mit 4 Diensten (CE, Dashboard, Postgres, Authelia) inklusive Traefik/Authelia-Routing und Webhook-Ausnahme
  - Next.js-Dashboard mit 6 Ansichten (Übersicht, Repos, Repo-Detail, PRs, Jobs, Probleme)
  - Sync-Worker (CE-Job-API, GitHub-API), `PlatformAdapter`/`GitHubAdapter`, Rollout-Logik (Onboarding-PR), Drizzle-Schema mit 8 Tabellen
  - Tests (Vitest, Playwright-Smoke), `feature-documentation/`, `PROGRESS.md`
  - Setup von Graphify, OpenSpec und Impeccable
- **Komplexitätstreiber:**
  - Umfang: geschätzt **8.000–12.000 LOC** in **120–180 Dateien**
  - Architektur: mittlere Tiefe mit einem Monolithen (Next.js) und zwei Fremdsystemen, die zu integrieren sind (CE-API, GitHub App)
  - **Erhöhte Unsicherheit**, die zu Nacharbeit führt:
    - exakte Variablennamen und Rechte von CE
    - Authelia-Forward-Auth in Coolify/Traefik
    - Verhalten von Automerge bei fehlenden Checks
    - Build-Check für Expo und CDK
- **Sitzungen und Prompts** (inklusive eines Nacharbeitsfaktors von rund 1,3 im Erwartungswert):

  | Szenario | Sitzungen | eigene Prompts je Sitzung | eigene Prompts | Modellaufrufe (× 2,3) |
  |---|---:|---:|---:|---:|
  | Best | 20 | 12 | 240 | 552 |
  | Erwartung | 30 | 15 | 450 | 1.036 |
  | Worst | 45 | 20 | 900 | 2.070 |

- **Kontext je Aufruf (Mittelwert):** Spitzenklasse 200.000, Arbeitsklasse 140.000, Sparklasse 60.000 Tokens, gewichtet rund **156.000**. Damit liegt der Wert leicht über dem gemessenen Median (P50 = 125.000), weil der Mittelwert einer rechtsschiefen Verteilung über dem Median liegt. Bandbreite: Best 100–140k, Worst 200–300k.
- **Tool-Calls:** sind in den Aufrufen enthalten (Faktor 2,3 je Prompt). Results fließen als frischer Input bzw. Cache-Write in die Mengen ein.
- **Cache-Quote:** 78 % der Eingabemenge als Cache-Read, 4 % Cache-Write, 18 % frischer Input. Im Worst Case 72 % / 4 % / 24 %, etwa durch häufigere Verdichtung.
- **Output:** 1 Token je 288 gelesenen (Messwert)
- **Client-Overhead:** 18 % der Gesamtkosten, auf dem Sitzungsmodell
- **Fehler und Abbrüche:** +3 % Aufschlag
- **Tokenizer:** Die Messdaten stammen bereits von Modellen mit dem neuen Tokenizer (etwa +30 % Tokens). Im Erwartungswert gibt es deshalb keinen weiteren Aufschlag, im Worst Case +15 % als Sicherheitsmarge.

## 3. Modell-Mix

| Modell | Einsatzzweck | Anteil Aufrufe % | Anteil Kosten % (ohne Overhead) |
|---|---|---:|---:|
| Claude Opus 5.5 (Spitzenklasse) | Sitzungsmodell: Architektur, OpenSpec-Changes, Integration CE/GitHub/Authelia, Fehlersuche, Review | 30 % | 56 % |
| Claude Sonnet 5.5 (Arbeitsklasse) | Subagenten `implementer`, `reviewer`, `researcher`: Umsetzung der Ansichten, Schema, Tests | 68 % | 44 % |
| Claude Haiku 5.5 (Sparklasse) | Subagenten `scout`, `docs-writer`: Dateisuche, Doku aus Code | 2 % | < 0,1 % |

Der Opus-Anteil an den Aufrufen ist mit 30 % bewusst höher angesetzt als gemessen (17 %), weil das Sitzungsmodell in diesem Setup Opus ist. Der Kostenanteil von 56 % trifft den Messwert von 55 %. Haiku wird realistisch mit 2 % angesetzt, nicht als Zielvorgabe.

## 4. Token- & Kostentabelle (Erwartungswert)

| Modell | Kategorie | Tokens (Erwartung) | Preis pro MTok | Kosten (USD) |
|---|---|---:|---:|---:|
| Opus 5.5 | Base In | 11,20 Mio. | $4,00 | 44,78 |
| Opus 5.5 | Cache Write (1 h) | 2,49 Mio. | $8,00 | 19,90 |
| Opus 5.5 | Cache Read | 48,52 Mio. | $0,20 | 9,70 |
| Opus 5.5 | Output | 0,22 Mio. | $20,00 | 4,32 |
| **Opus 5.5** | **Summe** | | | **78,71** |
| Sonnet 5.5 | Base In | 17,74 Mio. | $2,00 | 35,48 |
| Sonnet 5.5 | Cache Write (1 h) | 3,94 Mio. | $4,00 | 15,77 |
| Sonnet 5.5 | Cache Read | 76,88 Mio. | $0,10 | 7,69 |
| Sonnet 5.5 | Output | 0,34 Mio. | $10,00 | 3,42 |
| **Sonnet 5.5** | **Summe** | | | **62,36** |
| Haiku 5.5 (≤ 100k) | Base In | 0,23 Mio. | $0,10 | 0,02 |
| Haiku 5.5 (≤ 100k) | Cache Write (1 h) | 0,05 Mio. | $0,20 | 0,01 |
| Haiku 5.5 (≤ 100k) | Cache Read | 0,98 Mio. | $0,01 | 0,01 |
| Haiku 5.5 (≤ 100k) | Output | 0,004 Mio. | $0,50 | 0,00 |
| **Haiku 5.5** | **Summe** | | | **0,04** |
| | **Modellkosten gesamt** | | | **141,12** |
| Opus 5.5 | Client-Overhead (18 % der Gesamtkosten) | | | 30,98 |
| alle | Fehler und Abbrüche (+3 %) | | | 5,16 |
| | **Gesamt (Erwartung)** | | | **177,26** |

**Live-Preise (Abruf 2026-10-13, $/MTok):**

| Modell | Base Input | 5m-Cache-Write | 1h-Cache-Write | Cache-Read | Output |
|---|---:|---:|---:|---:|---:|
| Claude Opus 5.5 | 4,00 | 5,00 | 8,00 | 0,20 | 20,00 |
| Claude Sonnet 5.5 | 2,00 | 2,50 | 4,00 | 0,10 | 10,00 |
| Claude Haiku 5.5 (≤ 100k Prompt) | 0,10 | 0,125 | 0,20 | 0,01 | 0,50 |
| Claude Haiku 5.5 (> 100k Prompt) | 0,50 | 0,625 | 1,00 | 0,05 | 2,50 |
| *zum Vergleich:* Claude Fable 5.1 | 10,00 | 12,50 | 20,00 | 0,25 | 50,00 |

## 5. Szenario-Summen

Kurs: EZB-Referenzkurs vom **12.10.2026**, 1 EUR = 1,1181 USD (Quelle: ecb.europa.eu)

| Szenario | Modellaufrufe | Gesamt USD | Gesamt EUR |
|---|---:|---:|---:|
| Best Case | 552 | 66,77 | 59,72 |
| **Erwartungswert** | **1.036** | **177,26** | **158,53** |
| Worst Case | 2.070 | 705,85 | 631,29 |

Der Worst Case liegt beim **Faktor 10,6** über dem Best Case.

## 6. Erklärung zur Tokenberechnung

1. **Eingabemenge je Modell** = Aufrufe × mittlerer Kontext. Beispiel Opus im Erwartungswert: 311 Aufrufe × 200.000 = 62,2 Mio. Eingabe-Tokens.
2. **Aufteilung der Eingabe:**
   - **Cache Read (78 %):** System-Prompt, `CLAUDE.md`, PRD, bereits gelesene Dateien und der bisherige Gesprächsverlauf werden in jedem Turn erneut gesendet und aus dem Cache gelesen. Das ist mengenmäßig der größte Posten (gemessen 77 % der Menge).
   - **Cache Write (4 %):** erstmals geladene Dateien, neue Skills sowie der Cache-Neuaufbau nach einer Verdichtung. Auf jeden geschriebenen Token kommen etwa 19 gelesene, das liegt im gemessenen Korridor von 16–19.
   - **Base In (18 %):** neue Prompts, Tool-Ergebnisse wie Dateiinhalte, Build- und Test-Ausgaben oder API-Antworten der CE, sowie Kontext, der noch nicht im Cache liegt
3. **Output** = Eingabe ÷ 288. Selbst rund 10.000 LOC Code und Doku machen nur etwa 0,56 Mio. Output-Tokens aus, also 5,5 % der Modellkosten.
4. **Caching-Logik:** Für Cache-Writes gilt der 1-h-Tarif (2 × Base). Cache-Reads kosten bei Opus 5.5 und Sonnet 5.5 nur noch **0,05 × Base** statt der früheren 0,1 ×.
5. **Tokenizer:** Die Messbasis enthält den neuen Tokenizer bereits, deshalb gibt es keinen Doppelzuschlag. Im Worst Case kommen +15 % hinzu.
6. **Overhead:** Die Modellkosten werden durch 0,82 geteilt, damit der Client-Overhead 18 % der Gesamtkosten ausmacht. Danach kommen +3 % für Fehler und Abbrüche hinzu.

## 7. Quercheck gegen Ist-Daten

| Kriterium | eigener Wert | Messwert | Bewertung |
|---|---|---|---|
| Kontextgröße je Aufruf (Erwartung) | ~156.000 Tokens | P10 41.000 / P50 125.000 | ✅ über P10, leicht über dem Median (Mittelwert > Median) |
| Output-Gewicht | 5,5 % | 5 % | ✅ |
| Cache-Quote | 78 % (Worst 72 %) | 70–90 % | ✅ im Korridor |
| frischer Input an den Kosten | 56,9 % | 56 % | ✅ |
| Cache-Read an den Kosten | 12,3 % | 22 % | ⚠️ Abweichung **durch den Preis, nicht durch die Menge**: Cache-Reads kosten bei Opus/Sonnet 5.5 nur 0,05 × Base (Messzeitraum: 0,1 ×). Bei gleicher Menge halbiert sich der Kostenanteil, das passt also. |
| Cache-Write an den Kosten | 25,3 % | 16 % | ⚠️ bewusst konservativ: Hier gilt der 1-h-Tarif (2 × Base) statt 5 Minuten (1,25 ×). Mit dem 5-m-Tarif lägen die Cache-Writes bei rund 17 %. Die Menge (4 %) entspricht dem Messwert. |
| Sparklasse | < 0,1 % der Kosten, 2 % der Aufrufe | 0,2 % / 2 % | ✅ keine geschönte Haiku-Annahme |
| Spitzenklasse an den Kosten | 56 % | 55 % | ✅ |
| Aufrufe je Prompt | 2,3 | 2,3 | ✅ |
| Client-Overhead | 18 % eingerechnet | 18 % | ✅ |
| Bandbreite Worst/Best | Faktor 10,6 | mindestens 2,5 | ✅ |

**Stand der Kennzahlen:** August 2026. Eine Neuerhebung ist nach der Verfallsregel noch nicht nötig. Die Preisstruktur hat sich aber mit Opus 5.5 und Sonnet 5.5 geändert (Cache-Read 0,05 ×). Bei der nächsten Aktualisierung von `ist-kennzahlen.md` sollte die Kostenstruktur deshalb mit den neuen Modellen neu gemessen werden.

## 8. Kostensenkende Bauvorgaben

- **Kommandoausgaben nicht ungefiltert in den Kontext spülen.** Ausgaben von `docker compose logs`, Renovate-Debug-Logs (`LOG_LEVEL=debug`), `npm install`, Playwright-Traces und GitHub-API-Antworten sind lang. Sie gehören mit `head`/`tail` gekürzt oder in eine Datei umgeleitet und gezielt gelesen. Ein einmal eingefügtes Renovate-Debug-Log kostet in jedem weiteren Request derselben Sitzung.
- **Cache-Präfix stabil halten.** Graphify, OpenSpec und Impeccable **einmal zu Beginn** einrichten. Änderungen an `CLAUDE.md`, Skills oder der Werkzeugliste bündeln, statt sie mitten in der Sitzung einzustreuen.
- **Subagenten auf die passende Klasse festlegen.** Die vorhandenen Rollen (`scout`/`docs-writer` auf Haiku, `implementer`/`reviewer`/`researcher` auf Sonnet) konsequent nutzen. Built-ins wie `Explore`, `Plan` oder `general-purpose` nur mit explizitem `model:`, sonst erben sie Opus.
- **Lange Sitzungen früh schneiden.** Eine Sitzung pro OpenSpec-Change bzw. pro Ansicht des Dashboards. Ein „Mach weiter" bei ~1 Mio. Tokens Kontext kostet über 6 USD für wenige hundert Tokens Antwort. Ein Übergang über `PROGRESS.md` und `feature-documentation/` ist billiger.
- **Bei Unklarheit erst recherchieren, dann bauen.** Variablennamen und Rechte von CE einmal von einem Subagenten aus der Doku extrahieren und in `feature-documentation/` ablegen, statt sie in jeder Sitzung neu im Kontext aufzubauen.
- **Integrationstests gegen echte Dienste gezielt einsetzen.** Für CE-API und GitHub mit Fixtures bzw. aufgezeichneten Antworten arbeiten, damit nicht jede Test-Iteration volle API-Antworten in den Kontext lädt.

## 9. Unsicherheiten & Hinweise

- **Hauptkostentreiber:** frischer Input auf dem Sitzungsmodell Opus 5.5 (allein ~45 USD im Erwartungswert) sowie der Client-Overhead. Den generierten Code kann man dagegen vernachlässigen.
- **Kostenkonzentration:** 5 % der Aufrufe tragen laut Messung die Hälfte der Kosten. Der Erwartungswert hängt also an wenigen dicken Requests, etwa Debug-Sitzungen rund um Authelia/Traefik oder rund um CE-Webhooks mit großem Log-Kontext. Der Worst Case ist bei ungebremstem Kontext der Normalfall, keine theoretische Größe.
- **Sensitivität:**
  - Kontextgröße und Zahl der Aufrufe wirken linear. +50 % Sitzungen bedeuten etwa +50 % Kosten.
  - Würde **Fable 5.1** statt Opus 5.5 als Sitzungsmodell genutzt (Base Input 2,5 × teurer), stiege der Erwartungswert auf rund **310 USD**.
  - Mit dem **5-Minuten-Cache** statt 1 h sänke der Erwartungswert um etwa **10 %**.
- **Größte Schätzrisiken:**
  - Integration von Authelia, Traefik und Coolify (häufige Iterationen mit Logs)
  - unklare Details der CE-API
  - Build-Check für Expo/React Native und AWS CDK
  - Nacharbeit, wenn Impeccable das Design grundlegend ändert
- **Abrufdaten:** Preise 2026-10-13 (Anthropic), Wechselkurs 12.10.2026 (EZB), Ist-Kennzahlen Stand August 2026
- **Nicht enthalten:**
  - Betriebskosten (Coolify-Server, Domains)
  - Kosten für einen Renovate-EE-Umstieg
  - Abonnement-Modelle (bewusst nur tokenbasierte API-Abrechnung)
  - Nutzungskosten der fertigen Plattform: Renovate selbst ruft keine LLMs auf
