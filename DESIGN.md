---
name: "Krinke-IT - Update Zentrale"
description: "Ein ruhiger Kontrollraum für den Zustand aller Repos: weiße Karten auf hellgrauem Papier, Signal nur dort, wo jemand handeln muss."
colors:
  rheinblau: "#2b4c9b"
  rheinblau-tief: "#1a2744"
  rheinblau-hell: "#3d62b5"
  fassholz: "#8b5e3c"
  signal-olive: "#55711c"
  logo-gruen: "#6b8e23"
  papier: "#ffffff"
  surface: "#f8f9fa"
  tinte-weich: "#525866"
  ziegelrot: "#a63a2b"
  bernstein: "#8a5f10"
typography:
  display:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    fontFeature: "tabular-nums"
  title:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    fontFeature: "tabular-nums"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
  body-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
  column-head:
    fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.025em"
  data:
    fontFamily: "ui-monospace, \"SF Mono\", Menlo, Consolas, monospace"
    fontSize: "0.875em"
    fontWeight: 500
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  trefferflaeche: "44px"
components:
  button-primary:
    backgroundColor: "{colors.signal-olive}"
    textColor: "{colors.papier}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.rheinblau}"
    textColor: "{colors.papier}"
  button-quiet:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.rheinblau-tief}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
    height: "44px"
  button-quiet-hover:
    textColor: "{colors.rheinblau}"
  chip:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.rheinblau-tief}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "0 12px"
    height: "32px"
  chip-active:
    backgroundColor: "{colors.rheinblau}"
    textColor: "{colors.papier}"
  chip-active-hover:
    backgroundColor: "{colors.rheinblau-hell}"
  search-field:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.rheinblau-tief}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
    padding: "0 16px 0 36px"
    height: "44px"
  status-badge:
    textColor: "{colors.ziegelrot}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  nav-link:
    textColor: "{colors.rheinblau-tief}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  nav-link-active:
    textColor: "{colors.rheinblau}"
  card:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.rheinblau-tief}"
    rounded: "{rounded.xl}"
    padding: "16px"
  table-row:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.rheinblau-tief}"
    typography: "{typography.body-sm}"
    height: "44px"
  step-node-open:
    backgroundColor: "{colors.rheinblau}"
    textColor: "{colors.papier}"
    rounded: "{rounded.full}"
    size: "32px"
  step-node-done:
    backgroundColor: "{colors.papier}"
    textColor: "{colors.signal-olive}"
    rounded: "{rounded.full}"
    size: "32px"
---

# Design System: Krinke-IT - Update Zentrale

## Overview

**Creative North Star: "Das Stellwerk"**

Die Update Zentrale ist ein ruhiger Kontrollraum. Er zeigt den Zustand vieler Strecken auf einen Blick, nämlich den aller Repos, Pull Requests und Renovate-Läufe, und gibt nur dort Signal, wo jemand handeln muss. Alles, was einfach läuft, bleibt still: weiße Karten auf hellgrauem Grund, Tinte in Rheinblau tief, kaum Farbe. Wer das Dashboard öffnet, soll in wenigen Sekunden sehen, ob etwas eine Entscheidung braucht, und nicht erst suchen müssen.

Die Sprache stammt von krinke.me: Rheinblau, Fassholz, Olive und das Logo-Grün, Montserrat für Überschriften, Inter für alles andere. Das Dashboard übernimmt sie mit mehr Zurückhaltung als die Webseite. Es gibt eine einzige Hauptaktion je Element, in Olive. Alle übrigen Bedienelemente sind still: Rand, Tinte, kein Füllton. Die Dichte ist die eines Werkzeugs, nicht die eines Magazins. Zeilen sind 44 px hoch, Ziffern stehen in Spalten untereinander, und Status steht in Text und Symbol, nie in Farbe allein.

Die Oberfläche kennt nur den hellen Modus. Das Logo bleibt unverändert, die Anrede lautet „Sie". Das Dashboard bleibt bewusst unauffällig: Es verzichtet auf Hero-Zahlen, dekorative Verläufe und Bewegung, die nichts mitteilt.

**Key Characteristics:**
- Weiße Karten mit weichem Schatten auf hellgrauem Grund, keine Rahmen um Karten
- Genau ein Signal je Element: Olive für die Hauptaktion, alles andere ruhig
- Status in fünf Formen (Kreuz im Kreis, Dreieck, Haken, halber Kreis, Strich), immer mit Text
- Montserrat für Überschriften, Inter für Fließtext, Monospace nur für Daten
- Trefferflächen von mindestens 44 px, auch dort, wo das Element selbst kleiner ist
- Ränder von Bedienelementen mit mindestens 3:1 Kontrast
- Nur heller Modus, Bewegung nur als Farbübergang

## Colors

Eine zurückhaltende Palette aus Tintenblau und Papier. Farbe trägt hier Bedeutung: Blau markiert Navigation und Fokus, Olive die eine Aktion, Ziegelrot und Bernstein den Handlungsbedarf.

### Primary
- **Rheinblau** (#2b4c9b): Überschriften, aktive Navigation, aktive Filter-Chips, Fokusring, offene Knoten der Leiterbahn und Links. Die Markenfarbe, aber kein Flächenton für die Seite.
- **Rheinblau tief** (#1a2744): die Tinte. Fließtext, Tabelleninhalt, Dialogtitel, außerdem die Basis des Schattens und der Ränder (als Mischung mit Transparenz).
- **Rheinblau hell** (#3d62b5): Hover für aktive Chips und Navigation sowie das Symbol für „läuft".

### Secondary
- **Signal-Olive** (#55711c): die Hauptaktion (gefüllter Knopf, weiße Schrift), Textlinks wie „Filter zurücksetzen" und „Abmelden" sowie der Ring erledigter Schritte. Beim Hover wechselt der Knopf auf Rheinblau.
- **Logo-Grün** (#6b8e23): nur Symbole und Linien, etwa der Haken bei „aktuell" und die Unterstreichung der aktiven Navigation. Kontrast 3,8:1 auf Papier, deshalb nie als Textfarbe.

### Tertiary
- **Fassholz** (#8b5e3c): Teil der Markenpalette und als Token definiert, in der Oberfläche bisher nicht eingesetzt. Er ist für warme Akzente reserviert, falls eine Ansicht sie braucht.

### Neutral
- **Papier** (#ffffff): Flächen von Karten, Tabellen, Dialogen, Kopfleiste und Bedienelementen.
- **Surface** (#f8f9fa): der Seitengrund hinter den Karten sowie die Hover-Fläche von Tabellenzeilen und neutralen Kacheln.
- **Tinte weich** (#525866): Beschriftungen, Meta-Zeilen, Platzhalter, erledigte Schritte und das neutrale Statussymbol.

### Status
- **Ziegelrot** (#a63a2b): Fehler, etwa fehlgeschlagene Läufe, rote Builds und Konfigurationsfehler. Für Text, Badge und Symbol; Kontrast 6,44:1 auf Papier.
- **Bernstein** (#8a5f10): Warnung und Entscheidung, etwa Major-Updates zur Freigabe oder ein fehlender Build-Check. Für Text, Badge und Symbol; Kontrast 5,64:1 auf Papier.

### Named Rules
**Die Ein-Signal-Regel.** Olive füllt nur die eine Hauptaktion je Element (Karte, Schritt, Dialog). Eine zweite Aktion daneben ist ein ruhiger Knopf mit Rand. Wer zwei olivfarbene Flächen nebeneinander setzt, hat keine Hauptaktion mehr.

**Die Form-statt-Farbe-Regel.** Jeder Status trägt Text und ein Symbol eigener Form: Kreuz im Kreis (Fehler), Dreieck (Warnung), Haken (Erfolg), halber Kreis (läuft), Strich (neutral). Die Farbe verstärkt, sie trägt die Information nie allein.

**Die Grün-ist-kein-Text-Regel.** Logo-Grün erscheint nur in Symbolen und Linien. Erfolg wird im Text in Tinte gesetzt, nur das Symbol ist grün.

## Typography

**Display Font:** Montserrat (mit ui-sans-serif, system-ui, sans-serif)
**Body Font:** Inter (mit ui-sans-serif, system-ui, sans-serif)
**Label/Mono Font:** Systemschrift `ui-monospace, "SF Mono", Menlo, Consolas, monospace`

**Character:** Montserrat gibt den Überschriften eine feste, geometrische Stimme in Rheinblau, Inter hält Tabellen und Meta-Zeilen lesbar und unauffällig. Die Monospace-Schrift ist eine Systemschrift und wird nur für Daten gebraucht.

### Hierarchy
- **Display** (700, 1.5rem mobil, 1.875rem ab sm, Zeilenhöhe 2rem bzw. 2.25rem): Seitentitel, einer je Ansicht (h1, in Rheinblau).
- **Headline** (600, 1.125rem, 1.75rem): Titel von Dialogen und Leerzuständen.
- **Title** (600, 1rem, 1.5rem): Abschnittsüberschriften („Kennzahlen", „Repos"), Schritttitel und Gruppenköpfe der Leiterbahn.
- **Body** (400, 1rem, 1.5rem): Fließtext in Beschreibungen und Leerzuständen, Zeilenlänge auf `max-w-prose` (65ch) begrenzt.
- **Body klein** (500, 0.875rem, 1.25rem): Tabellenzellen, Knopfbeschriftungen, Navigation, Chips, Meta-Zeilen. Die Arbeitsgröße der Oberfläche.
- **Label** (600, 0.75rem, 1rem): Badges, Legende, Abgleich-Stempel.
- **Spaltenkopf** (Montserrat 600, 0.75rem, Laufweite 0.025em, Tinte weich): Tabellenköpfe, ohne Großschreibung.
- **Daten** (Monospace, 0.875em des umgebenden Textes): Versionsnummern, Commit- und Branch-Namen, Log-Auszüge, Code.

### Named Rules
**Die Monospace-nur-für-Daten-Regel.** Monospace steht für Dinge, die man abschreiben oder vergleichen kann: Versionen, Namen, Log-Zeilen. Beschriftungen, Knöpfe und Fließtext setzen wir nie in Monospace, auch nicht „für den technischen Look".

**Die Ziffern-stehen-still-Regel.** Überschriften und Tabellen nutzen tabellarische Ziffern (`tabular-nums`), ebenso Zähler an Chips und Gruppen. Zahlen in Spalten und Zählern springen beim Aktualisieren nicht.

## Layout

Eine einzige Spalte im Container von höchstens 80rem (`max-w-7xl`) mit 16 px seitlichem Rand und 24 bis 32 px Abstand oben. Der Inhalt bricht um, bevor er überläuft: Die Seite scrollt nie waagerecht, auch nicht bei 200 % Text-Zoom (geprüft bei 375 und 1440 px). Kopfleiste, Chips, Kennzahlen und Statuszeilen müssen dafür selbst umbrechen (`flex-wrap`, `min-w-0`).

Der Rhythmus folgt einer 4-px-Basis. Üblich sind 8 px zwischen verwandten Elementen, 16 px Innenabstand in Karten und 24 px zwischen Abschnitten. Die Dichte eines Werkzeugs: Tabellenzeilen sind 44 px hoch, Kennzahlenzeilen mindestens 44 px, die Leiterbahn legt Schritte mit 8 px Abstand untereinander.

Breakpoints (Tailwind, Pixel der Standardgröße):
- **ab 768 px (`md`):** Listen wechseln von Karten auf Tabellen, die Leiterbahn von wischbaren Einzelkarten auf Gruppen untereinander.
- **ab 1024 px (`lg`, entspricht 64rem):** Hauptnavigation, Abgleich-Stempel und Konto stehen in der Kopfleiste; darunter bleibt nur der Menü-Knopf mit Seitenleiste. Hier wechselt auch das Logo vom kompakten (h-8) zum breiten Format (h-10).
- **ab 640 px (`sm`):** Titel wachsen, die Repo-Kacheln erhalten eine vierte Spalte.

### Named Rules
**Die 44-px-Regel.** Jedes bedienbare Ziel ist mindestens 44 px hoch. Ist das sichtbare Element kleiner (Text-Link in einer Meta-Zeile, Chip mit 32 px, Spaltenkopf), vergrößert ein `::after`-Pseudo-Element die Trefferfläche über das Element hinaus, ohne den Abstand der Zeile zu ändern. Das Muster steckt in `TOUCH_TARGET` (`dashboard/src/lib/touch-target.ts`). Benachbarte Ziele dürfen sich nicht überdecken, deshalb sind Zeilen mit solchen Links mindestens 44 px hoch.

**Die Umbruch-vor-Überlauf-Regel.** Eine Zeile bricht um (`flex-wrap`, `min-w-0`, `[overflow-wrap:anywhere]`), bevor sie die Seite breiter als den Bildschirm macht. Waagerechtes Scrollen gibt es nur in ausdrücklich dafür gebauten Leisten (Filter auf dem Handy, Wischkarten).

## Elevation & Depth

Ruhige Karten auf Papier. Das System arbeitet mit einer einzigen Hebung: Weiße Flächen liegen mit einem weichen, kaum sichtbaren Schatten auf dem hellgrauen Grund. Die Karte hat keinen Rand, der Schatten und der Tonunterschied zwischen Papier und Surface trennen sie vom Grund. Dialoge heben sich zusätzlich durch ein abgedunkeltes Overlay in Rheinblau tief (40 %) ab.

### Shadow Vocabulary
- **Karte** (`box-shadow: 0 1px 2px color-mix(in srgb, var(--rheinblau-tief) 6%, transparent), 0 4px 16px -8px color-mix(in srgb, var(--rheinblau-tief) 12%, transparent)`): Karten, Tabellencontainer, Kennzahlen, Leiterbahn-Schritte und Leerzustände.
- **Karte flach** (`box-shadow: 0 1px 2px color-mix(in srgb, var(--rheinblau-tief) 6%, transparent)`): für Flächen, die dicht beieinanderliegen und keine eigene Tiefe brauchen.

### Named Rules
**Die Papier-statt-Rahmen-Regel.** Karten haben einen Schatten und keinen Rand. Bedienelemente (Suchfeld, inaktive Chips, ruhige Knöpfe) haben dagegen immer einen Rand, und dieser Rand erreicht mindestens 3:1 Kontrast gegen den Untergrund (Rheinblau tief zu 55 %: 3,4:1 gegen Surface, 3,6:1 gegen Papier). Ein Rand um eine Karte ist falsch, ein blasser Rand um ein Feld ebenso.

**Die Schatten-aus-Tinte-Regel.** Schatten werden aus Rheinblau tief gemischt, nie aus Schwarz. Sie stehen einmal als Token in `globals.css` und werden nicht an einzelnen Karten neu erfunden.

## Shapes

Weiche, aber nüchterne Ecken. Karten, Tabellencontainer und Knöpfe tragen 8 px Radius, Navigationslinks 6 px, kleine Elemente 4 px. Chips, Badges, das Suchfeld und die Knoten der Leiterbahn sind vollrund (Pille bzw. Kreis). Ränder von Bedienelementen sind 1 px innenliegende Ringe (`ring-1 ring-inset`), Auswahl und Fokus nutzen 2 px. Der Fokusring ist ein 2 px dicker Rheinblau-Ring mit 2 px Abstand und erscheint ohne Übergang.

Die Leiterbahn der Leiterbahn-Ansicht ist die einzige wiederkehrende Linie: 2 px stark, in Rheinblau zu 25 %, mit vollrunden Enden. Sie läuft hinter den Knoten durch und endet am letzten.

## Components

Alle Bedienelemente sind präzise und zurückhaltend: Olive für die eine Hauptaktion, alles andere still. Farbwechsel laufen über `transition-colors` (150 ms). Ein Fokusring erscheint sofort.

### Buttons
- **Shape:** 8 px Radius, mindestens 44 px hoch, 16 px Innenabstand, Schrift Inter 600, 0.875rem
- **Primär (Hauptaktion):** Signal-Olive mit weißer Schrift. Hover: Rheinblau.
- **Ruhig:** ohne Füllung, Tinte mit 1 px Ring in Rheinblau tief (55 %). Hover: Schrift und Ring in Rheinblau. Für Nebenaktionen und „Abbrechen"; erledigte Schritte bieten ihre Aktion ebenfalls ruhig an.
- **Während der Ausführung:** `aria-disabled` statt `disabled` mit 60 % Deckkraft, damit der Fokus nach dem Schließen eines Dialogs nicht verloren geht.
- **Text-Link:** Olive, unterstrichen, Hover Rheinblau, 44 px Trefferfläche („Filter zurücksetzen", „Abmelden").

### Chips
- **Style:** Pille, 32 px hoch (Trefferfläche 44 px über `::after`), Inter 500, 0.875rem. Inaktiv: Papier mit Ring in Rheinblau tief (55 %), Tinte. Zähler in Tinte weich.
- **State:** Aktiv: Rheinblau gefüllt, weiße Schrift, Haken vor der Beschriftung (nicht nur Farbe). Hover aktiv: Rheinblau hell, Hover inaktiv: Schrift und Ring in Rheinblau. Jeder Chip ist ein Link, damit Filter ohne JavaScript funktionieren und in der Adresse stehen.

### Cards / Containers
- **Corner Style:** 8 px
- **Background:** Papier
- **Shadow Strategy:** `Karte`, siehe Elevation & Depth
- **Border:** keiner
- **Internal Padding:** 16 px bis 20 px; Tabellenzellen 12 px seitlich, Zeilen 44 px hoch
- **Tabelle:** Kopfzeile 40 px, Spaltenköpfe in Montserrat 600 klein; Zeilentrenner als 1 px Linie in der Rahmenfarbe (Rheinblau tief 15 %, die Zeilen selbst zu 70 %); Hover auf Surface (70 %). Unter 768 px wird jede Zeile zur Karte.
- **Kennzahlen:** eine ruhige Liste (`dl`) in einer Karte, keine Kachelwand.
- **Repo-Raster:** Kacheln auf einem sichtbaren Zellenraster aus 1 px Linien; jede Kachel zeigt das Symbol des dringendsten Zustands mit schwacher Tönung (9 bis 10 % Statusfarbe auf Papier, deckend gemischt).

### Inputs / Fields
- **Style:** Suchfeld als Pille, Papier, 1 px Ring in Rheinblau tief (55 %), Lupe links in Tinte weich, Platzhalter in Tinte weich. 44 px hoch, ab 1024 px 36 px.
- **Focus:** Rheinblau-Ring (siehe Shapes), der Ring des Feldes wechselt auf Rheinblau.
- **Error / Disabled:** Fehler erscheinen als Statuszeile mit Symbol (`role="alert"`), nicht als roter Rand.

### Navigation
- **Style:** Textlinks in Inter 500, 0.875rem, Tinte, mindestens 44 px hoch, 12 px Innenabstand, 6 px Radius. Hover: Rheinblau hell.
- **Aktiv:** Rheinblau, mit 2 px Unterstreichung in Logo-Grün (Abstand 8 px); `aria-current="page"`.
- **Mobil:** Unter 1024 px öffnet ein 44-px-Menüknopf (Umriss-Variante des Button-Bausteins) eine Seitenleiste von rechts. Der Abgleich-Stempel rutscht in eine eigene Zeile auf Surface unter der Kopfleiste. Ein Skip-Link „Zum Inhalt springen" steht vor allem.

### Status
- **StatusBadge:** Pille mit leichter Tönung (Statusfarbe zu 8 %, Ring zu 25 %), Inter 600, 0.75rem, Symbol 14 px links. Für den dringendsten Zustand eines Repos oder einen Update-Typ.
- **StatusText:** Symbol und Text ohne Fläche für Tabellenzellen und Detailzeilen. Erfolg setzt den Text in Tinte, nur das Symbol ist grün.
- **Abgleich-Stempel:** je Datenquelle Symbol, Name und Uhrzeit des letzten Abgleichs; bei Fehler oder veralteten Daten in Ziegelrot bzw. Bernstein mit Erklärung im Titel.

### Leiterbahn (Signatur-Komponente)
Die Leiterbahn zeigt offene Schritte wie Stationen auf einer Strecke, angelehnt an das Logo. Ein Schritt ist eine Karte auf der Bahn; vor ihm sitzt ein Knoten von 32 px.
- **Offen:** gefüllter Rheinblau-Knoten mit weißer Nummer in Montserrat und 4 px Ring in Surface, der ihn von der Bahn abhebt. Die Hauptaktion des Schritts ist ein olivfarbener Knopf.
- **Erledigt:** Papier-Knoten mit 2 px Ring und Haken in Signal-Olive; der Text wechselt auf Tinte weich, „Erledigt" steht in Olive. Der Wechsel läuft als Farbübergang (300 ms). Erledigte Schritte bleiben bis zum Neuladen stehen, ihre Aktion wird zum ruhigen Knopf.
- **Gruppen:** Jede Gruppe beginnt mit einem kleinen Rheinblau-Punkt auf der Bahn; mehr als sieben Schritte werden nach fünf mit „weitere X anzeigen" gekürzt.
- **Mobil:** Ein Schritt füllt die Breite, der nächste liegt einen Wisch entfernt; Knoten und Karte bleiben gleich.

### Dialog
Ein Bestätigungsdialog (`AlertDialog`) auf Papier mit 8 px Radius und Overlay in Rheinblau tief (40 %). Der Titel steht in Montserrat 600, die Wirkung in einem Satz darunter. „Abbrechen" ist ruhig, die Bestätigung olivfarben und trägt den Namen der Aktion.

## Do's and Don'ts

### Do:
- **Do** Olive für die eine Hauptaktion je Element verwenden und jede weitere Aktion als ruhigen Knopf mit Ring setzen (Die Ein-Signal-Regel).
- **Do** jeden Status mit Text und einem Symbol eigener Form zeigen: Kreuz im Kreis, Dreieck, Haken, halber Kreis, Strich (Die Form-statt-Farbe-Regel).
- **Do** Logo-Grün auf Symbole und Linien beschränken; Text in Tinte setzen (Die Grün-ist-kein-Text-Regel).
- **Do** Karten mit `shadow-karte` auf Surface legen und sie ohne Rand lassen; Bedienelemente erhalten einen Rand von mindestens 3:1 (Die Papier-statt-Rahmen-Regel).
- **Do** jedes Ziel auf mindestens 44 px bringen, notfalls über das `after:`-Muster aus `TOUCH_TARGET` (Die 44-px-Regel).
- **Do** Zustände mit direkt gewählten Farben darstellen (zum Beispiel Tinte weich für Erledigtes, jeweils mindestens 4,5:1 für Text).
- **Do** Monospace nur für Versionen, Namen und Logs verwenden und Ziffern mit `tabular-nums` setzen.
- **Do** Texte in „Sie"-Form, auf Deutsch, sachlich und ohne Marketingsprache halten.

### Don't:
- **Don't** einen farbigen Seitenrand über 1 px an Karten, Listeneinträgen oder Hinweisen setzen.
- **Don't** Eyebrows oder Kicker über Überschriften stellen; die Überschrift trägt sich selbst.
- **Don't** Kennzahlen als Kachelwand mit großer Zahl und kleinem Label bauen; die Übersicht zeigt sie als ruhige Liste.
- **Don't** einen Dark Mode ergänzen. Die Oberfläche ist ausdrücklich nur hell (`color-scheme: light`).
- **Don't** das Logo verändern, umfärben, beschneiden oder neu zeichnen.
- **Don't** Zustände über Gruppen-Opacity abtönen. Ein erledigter Schritt erhält eigene, direkt gewählte Farben, damit der Kontrast je Text stimmt.
- **Don't** Status allein über Farbe vermitteln oder Fehler mit einem roten Rand statt einer Statuszeile anzeigen.
- **Don't** Hex-Werte in Komponenten schreiben. Komponenten nutzen die Token-Klassen (`bg-rheinblau`, `text-ink`, `shadow-karte`).
- **Don't** Fließtext, Knöpfe oder Beschriftungen in Monospace setzen.
