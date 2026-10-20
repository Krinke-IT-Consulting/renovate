# Entwurf: Ansichten Repos, Repo-Detail, Pull Requests, Jobs und Probleme

Status: **Entwurf bestätigt** (2026-10-20, `/impeccable shape`, Task 6.1 des Changes
`dashboard`). Die Übersicht („Lagebericht“) ist separat entworfen:
[`../uebersicht-entwurf.md`](../uebersicht-entwurf.md). Verbindlich bleiben `PRODUCT.md` und die
Spec `dashboard-views`.

## 1. Aufgabe und Nutzer

- **Nutzer:** einziger Nutzer ist der Betreiber, meist am Desktop in der regelmäßigen Sichtung,
  gelegentlich mobil.
- **Modus:** Arbeitsfläche (Operate).
- **Rolle der Ansichten:**
  - Der Lagebericht sagt, *was* zu tun ist.
  - Die fünf Ansichten sind die Stellen, an denen der Betreiber nachschlägt, eingrenzt und von
    dort zur Aktion auf GitHub oder ins Dashboard springt.
- **Herkunft der Besuche:** Sie kommen meist über einen Link aus dem Lagebericht, also mit
  gesetztem Filter.

## 2. Ziel und Belege

- **Erfolg:** Den Stand eines Repos, eines PRs oder eines Laufs kennt der Betreiber, ohne GitHub
  zu öffnen. GitHub ist das Ziel der Aktion, nicht der Suche.
- **Datenquelle:** Alle Werte kommen aus den abgeglichenen Tabellen:
  - `repositories`, `pull_requests`, `renovate_jobs`, `problems`, `rollout_actions`
  - Jede Seite zeigt den Abgleich-Stempel aus `sync_state`.
- **Keine erfundenen Daten:** Entwicklung und Tests nutzen gekennzeichnete Fixtures.

## 3. Gewählte Richtung

Die Ansichten folgen der krinke.me-Welt und dem Lagebericht. Sie bilden keine eigene Welt. Die
Marke zeigt sich in präzisen Details, nicht in Dekoration.

- **Ruhige Tabellen auf Papier:**
  - Weiße Fläche auf Surface-Grund, Kopfzeile in Montserrat, Inhalt in Inter.
  - Zahlenspalten rechtsbündig mit `tabular-nums`.
- **Leiterbahn als wiederkehrendes Motiv, sparsam eingesetzt:**
  - Im Repo-Detail verbindet sie den Kopf mit den Abschnitten „Was hier zu tun ist“.
  - Die Listen selbst bleiben ohne Motiv.
- **Statusfarben (Entscheidung 1a):**

  | Zustand | Farbe | Einsatz | Kontrast auf Weiß / Surface |
  |---|---|---|---|
  | Fehler (rote CI, Lauf fehlgeschlagen, Konfigurationsfehler) | Ziegelrot `#A63A2B` | Text, Badge, Symbol | 6,44 / 6,11 |
  | Warnung (hängend, Major zur Freigabe, Build-Check fehlt) | Bernstein `#8A5F10` | Text, Badge, Symbol | 5,64 / 5,35 |
  | Erfolg (CI grün, Lauf erfolgreich, onboardet) | Logo-Grün `#6B8E23` | nur Symbol oder Linie, nie Fließtext | 3,81 / 3,61 (Grafik, ≥ 3:1) |
  | Läuft / in Warteschlange | Rheinblau hell `#3D62B5` | Text, Badge, Symbol | 5,81 / 5,51 |
  | Neutral / unbekannt | `ink-soft` `#525866` | Text | 7,13 / 6,76 |

  - **Rollen der Markenfarben:**
    - Olive bleibt die Farbe der Hauptaktion.
    - Fassholz verliert die Rolle „destructive“ und wird nicht mehr als Status genutzt.
  - **Nie nur über Farbe:** Jeder Status trägt Text und ein Symbol in eigener Form:

    | Zustand | Symbol |
    |---|---|
    | Fehler | Kreuz im Kreis |
    | Warnung | Dreieck |
    | Erfolg | Haken |
    | Läuft | halber Kreis |
    | Neutral | Strich |
- **Monospace (Entscheidung 2a):**
  - Systemschrift über den vorhandenen Stack `ui-monospace, "SF Mono", Menlo, Consolas`, keine
    zusätzliche Webfont.
  - Verwendet für Versionen, Versionssprünge (`4.2.1 → 5.0.0`), Commit-SHAs, Job-IDs, Pfade und
    den Log-Auszug.
- **Dichte (Entscheidung 3a):**
  - Kompakte Tabellenzeilen von etwa 40 px. Auf dem Desktop passen so 25 bis 50 Repos fast
    vollständig auf einen Bildschirm.
  - Interaktive Elemente in der Zeile behalten ihre Trefferfläche von mindestens 44 px, notfalls
    über die Zeilenhöhe hinaus per Pseudo-Element.
  - Auf Touch-Geräten werden die Tabellen ohnehin zu Karten.

## 4. Umfang und Grenzen

- **Umfang:** Produktionsreife Seiten für `/repos`, `/repos/[owner]/[name]`, `/pull-requests`,
  `/jobs` und `/probleme`, gebaut in Tasks 6.3 bis 6.6.
- **Unverändert bleiben:**
  - App-Shell (Kopfleiste, Navigation, Abgleich-Stempel, Skip-Link)
  - Logo
  - Lagebericht-Entwurf
- **Aktionen:** Die Knöpfe „Lauf starten“, „Onboarding-PR“ und „Build-Check ausrollen“ sind im
  Repo-Detail und in der Repo-Liste vorgesehen. Gebaut werden sie in Phase 7. In Phase 6 sind sie
  nicht sichtbar, also auch nicht deaktiviert sichtbar.
- **Bewusst nicht gewollt:**
  - Kennzahlen-Kacheln über den Listen (die stehen im Lagebericht)
  - Diagramme
  - Spalten-Konfigurator
  - Infinite Scroll
  - Begriffe, die GitLab ausschließen, also „Pull Request“ im Fließtext und keine
    GitHub-spezifischen Wörter außer in Link-Beschriftungen wie „Auf GitHub öffnen“

## 5. Zustände und Mengen

- **Mengen:**

  | Daten | Normal | Extremfall |
  |---|---|---|
  | Repos | 25–50 | — |
  | offene PRs | 0–30 | über 100 nach langer Pause |
  | Jobs | rund 25–50 pro Stunde | — |
  | offene Probleme | 0–10 | — |

- **Paginierung:**
  - Repos werden nicht paginiert.
  - PRs und Probleme paginieren ab 50.
  - Jobs zeigen die letzten 7 Tage, 50 je Seite, mit „Ältere laden“.
- **Laden:** Platzhalter in Zeilenform, kein Ladekreisel.
- **Leer, mit Grund und nächstem Schritt:**
  - PRs: „Keine offenen Renovate-PRs. Der nächste Lauf ist stündlich.“
  - Probleme: „Keine offenen Probleme.“ mit einem Link auf die behobenen.
  - Jobs: „Noch kein Lauf.“
  - Gefilterte Ansicht: „Keine Treffer für diese Filter.“ mit „Filter zurücksetzen“.
- **Fehler und veraltete Daten:**
  - Der Abgleich-Stempel zeigt den Fehler mit Uhrzeit.
  - Die letzten Daten bleiben sichtbar.
  - Bei einem Teilfehler eines Repos steht ein Hinweis in dessen Zeile.
- **Entfernte Repos** (`removed_at` gesetzt) sind standardmäßig ausgeblendet. Ein Filter
  „Entfernte zeigen“ blendet sie ein.

## 6. Interaktion und Layout

### Gemeinsam

- **Seitenkopf:** Titel, eine Zeile Zusammenfassung (etwa „12 offene PRs, davon 2 Sicherheit“),
  darunter die Filterleiste.
- **Filter als Pill-Chips:**
  - Sie stehen in der Adresse (`?type=major&ci=failed`).
  - Aktive Chips sind gefüllt.
  - „Zurücksetzen“ erscheint nur, wenn ein Filter gesetzt ist.
  - Die Freitextsuche filtert nach Repo oder Paket und schreibt nach kurzer Verzögerung in die
    Adresse.
- **Sortierung:**
  - Per Klick und per Tastatur auf den Spaltenkopf.
  - `aria-sort` wird gesetzt.
  - Die Sortierung steht ebenfalls in der Adresse.
- **Zeilen und Ziele:**
  - Die Hauptspalte ist ein Link, nicht die ganze Zeile.
  - GitHub-Links öffnen in neuem Tab und tragen ein Symbol für „extern“.
- **Mobil (< 768 px):**
  - Karten mit Status oben links, Titel, zwei Detailzeilen und dem Link.
  - Die Filter liegen in einer waagerecht scrollbaren Chip-Leiste; die Seite selbst scrollt nie
    waagerecht.
- **Aktualisierung:** `router.refresh()` alle 60 s bei sichtbarem Tab. Ohne Bewegung,
  `prefers-reduced-motion` wird beachtet.

### Repos (`/repos`)

- **Sortierung:** nach Handlungsbedarf (Fehler, dann Warnung, dann OK), danach nach Name.
- **Gruppierung:** Owner (Hiwamashi, Krinke-IT-Consulting) ist ein Filter-Chip, keine Gruppierung.
- **Spalten:**
  - Repo
  - Status, als Badge mit dem dringendsten Zustand
  - Onboarding
  - Build-Check
  - Letzter Lauf, als Zeit relativ mit Ergebnis-Symbol
  - Offene PRs
  - Sicherheit
- **Filter:**
  - Owner
  - Status
  - „Problem vorhanden“
  - „Nicht onboardet“
  - „Eigene CI“
  - „Entfernte zeigen“

### Repo-Detail (`/repos/[owner]/[name]`)

- **Kopf:**
  - Name, Owner und Zustands-Badge
  - Links: „Auf GitHub öffnen“ und „Dependency Dashboard“, Letzteres nur wenn das Issue existiert
  - Darunter Onboarding, Build-Check (bzw. „eigene CI“), Konfigurationspfad und letzter Lauf
- **Erster Abschnitt „Was hier zu tun ist“:**
  - Die offenen Probleme dieses Repos und die PRs, die eine Entscheidung brauchen, in der
    Reihenfolge des Lagebericht.
  - Fehlen sie, heißt der Abschnitt „Nichts zu tun.“ und bleibt einzeilig.
- **Danach:**
  - Offene PRs, als kompakte Liste wie `/pull-requests`, ohne Repo-Spalte
  - Letzte 20 Jobs mit Link auf `/jobs?repo=…`
  - Rollout-Aktionen mit Status und PR-Link
- **Unbekanntes Repo:** Eine nicht abgeglichene Adresse ergibt die vorhandene Seite
  `not-found` mit Link auf `/repos`.

### Pull Requests (`/pull-requests`)

- **Darstellung:** flache Liste, keine Gruppierung.
- **Sortierung:** Sicherheit zuerst, dann rote CI, dann Major, dann nach Alter absteigend.
- **Spalten:**
  - Titel bzw. Paket
  - Versionssprung (mono)
  - Repo
  - Update-Typ (Badge: Sicherheit, Major, Minor, Patch, Digest)
  - CI
  - Automerge (Symbol mit Text „Automerge“)
  - Alter
- **Hängende PRs:** Ab 14 Tagen bzw. 7 Tagen bei Sicherheit trägt die Alter-Spalte das
  Warnungssymbol.
- **Filter:** Repo, Update-Typ, CI-Status, Automerge.
- **Link:** Ziel ist der PR auf GitHub.

### Jobs (`/jobs`)

- **Sortierung:** neueste zuerst.
- **Spalten:**
  - Zeit
  - Repo
  - Auslöser (Zeitplan, Webhook, manuell)
  - Status
  - Dauer
  - Hinweis auf Artefaktfehler
- **Filter:**
  - Repo
  - Status, mit dem Chip „Fehlgeschlagen“ als schnellem Einstieg
- **Log-Auszug:**
  - Fehlgeschlagene Jobs haben einen Auf/Zu-Knopf (`aria-expanded`). Der Auszug erscheint unter
    der Zeile in Monospace auf Surface-Grund.
  - Er ist auf 30 Zeilen begrenzt, mit „Ganzen Auszug zeigen“.
  - Der Knopf „Kopieren“ bestätigt sich kurz mit „Kopiert“ (`aria-live`).
- **Purged-Jobs:** Ist der Log nicht mehr verfügbar, steht dort „Log nicht mehr verfügbar“.

### Probleme (`/probleme`)

- **Umschalter:** „Offen“ / „Behoben“ als Segment, Vorgabe „Offen“.
- **Gruppierung:** nach Art, in der Reihenfolge Konfigurationsfehler, fehlgeschlagener Lauf,
  Lockfile-Fehler, rote CI, fehlender Build-Check, hängender PR.
  - Jede Gruppe hat eine Überschrift mit Anzahl.
  - Je Gruppe sind die ersten 10 sichtbar, dazu „weitere X anzeigen“.
- **Eintrag:**
  - Repo
  - Kurzbeschreibung
  - Seit wann, bei behobenen „behoben am“
  - genau ein Link zum Beleg: Job-Log, PR oder Repo-Detail
- **Filter:** Repo, Art.

## 7. Vorgaben und offene Entscheidungen

- **Technik:**
  - Next.js App Router mit Server Components, die Daten direkt aus Drizzle lesen.
  - TanStack Table nur für Sortierung und Filter.
  - shadcn-Bausteine (Badge, Button, Table, Tabs, Collapsible), an die Tokens angepasst.
- **Neue Tokens in `globals.css`:**
  - `--status-fehler`, `--status-warnung`, `--status-erfolg`, `--status-laeuft`,
    `--status-neutral`
  - `--destructive` zeigt künftig auf `--status-fehler` statt auf Fassholz.
- **Zugänglichkeit:**
  - Tabellen als echte `<table>` mit `<caption>` (visuell versteckt).
  - Fokusstil wie in der Shell.
  - Touch-Ziele mindestens 44 px.
  - Status nie nur über Farbe.
- **Offen, vom Bauenden nicht zu erfinden:**
  - Wortlaut der Problem-Kurzbeschreibungen. Vorschlag: aus festen Textbausteinen je Art in
    `src/domain/problems.ts`, mit Abstimmung beim Review von 6.5.
