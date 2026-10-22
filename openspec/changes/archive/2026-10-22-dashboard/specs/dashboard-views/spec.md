# Spec Delta

## Purpose

Die Ansichten der „Krinke-IT - Update Zentrale“: ein Lagebericht als Einstieg und Listen für Repos,
Pull Requests, Jobs und Probleme, damit kein Repo einzeln geöffnet werden muss, um seinen Stand zu
kennen.

## ADDED Requirements

### Requirement: Lagebericht als Übersicht
Die Startseite MUST oben einen Lagebericht in ganzen deutschen Sätzen zeigen. Er entsteht aus
festen Textbausteinen, nicht frei formuliert. Jede Zahl darin MUST auf die passend gefilterte
Liste verlinken. Darunter MUST sie die offenen Aufgaben als nummerierte Schritte zeigen, in dieser
festen Reihenfolge:
1. Sicherheitsupdates
2. rote Builds und fehlgeschlagene Läufe
3. Major-Updates zur Freigabe
4. nicht onboardete Repos
5. hängende PRs

Jeder Schritt MUST Typ, Repo, Detail (etwa Paket, Versionssprung, CI-Status, Alter) und genau eine
Hauptaktion zeigen. Erledigte Schritte MUST als abgehakt stehen bleiben, bis die Seite neu geladen
wird. Je Gruppe MUST die Liste bei vielen Einträgen die ersten zeigen und den Rest über
„weitere X anzeigen“. Daneben MUST die Seite Kennzahlen und ein Raster mit einer Kachel pro Repo
zeigen; ein Klick auf eine Kachel filtert die Schritte auf dieses Repo.

#### Scenario: Zwei Sicherheitsupdates offen
- **WHEN** in seatmagic und lector je ein Sicherheitsupdate offen ist
- **THEN** nennt der Lagebericht „2 Sicherheitsupdates“, die Zahl führt zur gefilterten PR-Liste,
  und Schritt 1 zeigt beide PRs

#### Scenario: Alles erledigt
- **WHEN** es keine offenen Schritte gibt
- **THEN** lautet der Lagebericht „Alles aktuell.“, ergänzt um den nächsten geplanten Lauf, sofern
  bekannt

#### Scenario: Erster Start
- **WHEN** noch kein Repo onboardet ist und es keinen Lauf gibt
- **THEN** führt der Lagebericht zum Onboarding

### Requirement: Listen für Repos, Pull Requests, Jobs und Probleme
Das Dashboard MUST diese Ansichten bieten, jede sortier-, filter- und durchsuchbar:

| Ansicht | Inhalt | Filter |
|---|---|---|
| Repos | Owner, Onboarding-Status, Build-Check-Status, letzter Lauf mit Ergebnis, offene PRs, Sicherheitsupdates | Owner, Status, Problem vorhanden |
| Repo-Detail | Kopf mit Status und Links, offene PRs, Jobs, Probleme, Rollout-Aktionen | — |
| Pull Requests | alle offenen Renovate-PRs aller Repos | Repo, Update-Typ, CI-Status, Automerge |
| Jobs | Jobs aller Repos mit Auslöser, Status, Dauer; Log-Auszug aufklappbar und kopierbar | Repo, Status |
| Probleme | offene Probleme, umschaltbar auf behobene | Repo, Art |

Filter MUST in der Adresse stehen, damit Links aus dem Lagebericht die gefilterte Ansicht öffnen.
Links zu GitHub MUST auf den PR, das Repo oder das Dependency-Dashboard-Issue zeigen.

#### Scenario: Gefilterte PR-Liste per Link
- **WHEN** der Betreiber im Lagebericht auf die Zahl der Major-Updates klickt
- **THEN** öffnet sich die PR-Liste mit dem Filter „Major“, und die Adresse enthält ihn

#### Scenario: Log-Auszug
- **WHEN** der Betreiber einen fehlgeschlagenen Job aufklappt
- **THEN** sieht er den Log-Auszug und kann ihn mit einem Klick kopieren

### Requirement: Zustände jeder Ansicht
Jede Ansicht MUST einen Lade-, Leer- und Fehlerzustand haben. Beim Laden MUST ein Platzhalter in
der Form des Inhalts erscheinen, kein Ladekreisel. Ein Leerzustand MUST sagen, warum nichts da ist
und was als Nächstes passiert.

#### Scenario: Noch kein Lauf
- **WHEN** ein Repo noch keinen Job hat
- **THEN** zeigt seine Job-Liste „Noch kein Lauf“ statt einer leeren Tabelle

### Requirement: Gestaltung und Zugänglichkeit
Die Oberfläche MUST deutsch sein, den Betreiber mit „Sie“ ansprechen und nur einen hellen Modus
haben. Sie MUST der Gestaltung von krinke.me folgen (Palette, Montserrat und Inter, Logo
unverändert). Sie MUST auf Desktop und Mobil bedienbar sein. Auf Mobil werden Tabellen zu Karten,
und alle Aktionen bleiben erreichbar. Touch-Ziele MUST mindestens 44 × 44 px groß sein. Ein Status
MUST NOT allein über Farbe vermittelt werden. Die Oberfläche MUST vollständig per Tastatur bedienbar
sein, sichtbare Fokusstile und einen Skip-Link haben und `prefers-reduced-motion` beachten.

#### Scenario: Status ohne Farbe
- **WHEN** ein Repo rote CI hat
- **THEN** trägt seine Kachel zusätzlich einen Text oder ein Symbol für den Zustand

#### Scenario: Mobil
- **WHEN** der Betreiber die PR-Liste auf einem Telefon öffnet
- **THEN** erscheinen die PRs als Karten, ohne waagerechtes Scrollen der Seite
