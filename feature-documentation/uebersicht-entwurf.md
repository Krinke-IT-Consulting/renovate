# Entwurf: Übersicht der Krinke-IT - Update Zentrale

Status: **Entwurf bestätigt** (2026-10-13, `/impeccable shape übersicht`), noch nicht umgesetzt.
Umsetzung erfolgt in einem OpenSpec-Change für das Dashboard; dort ist dieser Entwurf die
Grundlage für die Gestaltung. Gewählte Variante: **Lagebericht**. Die verworfenen Varianten
„Zwei Owner, ein Bus" und „Posteingang" liegen als Skizzen unter `.impeccable/mocks/decision/`
(mit Beispieldaten).

## 1. Aufgabe und Nutzer

- Einziger Nutzer ist der Betreiber, in zwei Situationen: die regelmäßige Sichtung am Desktop
  und der kurze Blick unterwegs („Brennt irgendwo etwas?").
- Modus: Arbeitsfläche (Operate). Die Übersicht ist zum Erledigen da, nicht nur zum Ablesen.

## 2. Ziel und Belege

- Hauptaufgabe: abarbeiten, was eine Entscheidung braucht, in fester Reihenfolge:
  1. Sicherheitsupdates
  2. rote Builds und fehlgeschlagene Läufe
  3. Major-Updates zur Freigabe
  4. nicht onboardete Repos
  5. hängende PRs
- Erfolg: Kein Repo muss einzeln geöffnet werden, um seinen Stand zu kennen.
- Alle Zahlen kommen aus der Renovate-CE-Job-API und aus GitHub. Jeder Wert zeigt, wann er
  zuletzt abgeglichen wurde.

## 3. Gewählte Richtung: Lagebericht

- **Gestaltung:** krinke.me bleibt verbindlich (Rheinblau, Fassholz, Signal-Olive,
  Montserrat und Inter, Logo unverändert).
- **Kernidee:** Oben steht ein geschriebener Lagebericht in ganzen Sätzen, zum Beispiel
  „Sechs Dinge brauchen Sie: 2 Sicherheitsupdates in seatmagic und lector …". Jede Zahl
  darin ist ein Link auf die gefilterte Liste.
- **Erkennungsmerkmal:** Unter dem Lagebericht liegen die offenen Aufgaben als nummerierte
  Schritte auf einer Leiterbahn, wie im Logo.
  - Offene Schritte sind gefüllte Knoten.
  - Erledigte Schritte bleiben als Ring abgehakt stehen und verschwinden nicht.
  - Die Reihenfolge ist fest, damit immer klar ist, was als Nächstes kommt.
- **Rechts:** Kennzahlen und ein Raster mit einer Kachel pro Repo. Die Kachelfarbe zeigt den
  Zustand; das Raster sitzt auf einem sichtbaren Zellenraster, ein Repo pro Zelle.
- **Auf dem Handy:** Ein Schritt füllt den Bildschirm, der nächste liegt einen Wisch entfernt,
  und die Aktion sitzt in Daumenreichweite.

## 4. Umfang und Grenzen

- Bisher nur der Entwurf. Gebaut wird zusammen mit Backend und Synchronisierung.
- Bewusst nicht gewollt:
  - eine Wand aus Kennzahlen-Kacheln als Einstieg
  - Diagramme ohne Entscheidungswert
  - eine Arbeitsliste, die durch Erledigtes springt
  - Begriffe, die GitLab ausschließen

## 5. Zustände und Mengen

- **Mengen:** 25 bis 50 Repos; im Normalfall 0 bis 15 offene Schritte, im Extremfall nach
  langer Pause über 40.
  - Dann zeigt die Liste je Gruppe die ersten Einträge und darunter „weitere X anzeigen".
  - Der Lagebericht bleibt auch dann ein einziger Absatz.
- **Zustände:**
  - *Alles erledigt:* „Alles aktuell. Nächster Lauf um 03:00."
  - *Erster Start:* Es gibt noch keinen Lauf und kein onboardetes Repo; der Lagebericht führt
    zum Onboarding.
  - *Laden:* Platzhalter in Form des Absatzes, keine Ladekreisel.
  - *Daten veraltet:* Kommen GitHub oder CE nicht durch, zeigt der Abgleich-Stempel den Fehler
    mit Uhrzeit; die letzten Daten bleiben sichtbar.
  - *Aktion läuft* bzw. *Aktion fehlgeschlagen.*

## 6. Interaktion und Layout

- **Desktop:** obere Leiste mit Logo, Navigation (Übersicht, Repos, Pull Requests, Jobs,
  Probleme) und Abgleich-Stempel. Darunter links breit der Lagebericht und die Schritte,
  rechts eine Spalte von etwa 380 px mit Kennzahlen und Repo-Raster.
- **Jeder Schritt** zeigt Typ, Paket mit Versionssprung, Repo, Detailzeile (CVE, CI-Status,
  Alter) und genau **eine** Hauptaktion: Mergen auf GitHub, Log ansehen, Freigeben oder
  Onboarding-PR.
- **Aktionen mit Folgen** (Lauf starten, Onboarding) verlangen eine Bestätigung. Danach
  erscheint eine Meldung mit Link zum PR bzw. Job.
- **Repo-Kacheln:** Ein Klick filtert die Schritte auf dieses Repo.
- **Mobil sind alle Aktionen verfügbar.**
- **Bewegung:** nur das Abhaken eines Schritts (Knoten wird zum Ring), vollständig
  abschaltbar über `prefers-reduced-motion`.

## 7. Vorgaben und offene Entscheidungen

- Next.js, shadcn/ui und Tailwind; Oberfläche auf Deutsch mit „Sie"; nur heller Modus.
- Touch-Ziele mindestens 44 px. Status wird nie nur über Farbe gezeigt; Kacheln und Badges
  tragen zusätzlich Text oder Form.
- **Offen:**
  - Höchstdauer in Tagen, ab der ein Sicherheitsupdate als „hängend" hervorgehoben wird
  - Lagebericht aus Textbausteinen oder frei formuliert (empfohlen: Textbausteine, kein LLM)
  - Monospace-Schrift für Versionen und Logs
  - Eigene `DESIGN.md` für dieses Repo: entsteht erst nach dem Bau, aus der fertigen
    Oberfläche abgeleitet
