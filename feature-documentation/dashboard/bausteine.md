# Dashboard: gemeinsame UI-Bausteine

Status: umgesetzt auf dem Branch `feat/dashboard-ansichten`. Dieses Dokument beschreibt die Bausteine, die
die Seiten aus [`ansichten.md`](ansichten.md) gemeinsam nutzen. Die Gestaltungsvorgaben stehen in
[`ansichten-entwurf.md`](ansichten-entwurf.md), Abschnitt 3 (Statusfarben, Monospace, Dichte) und Abschnitt 7
(Zugänglichkeit).

Die Dateien liegen unter `dashboard/src/`. Wenn dieser Text und der Code voneinander abweichen, gilt der Code.

## 1. Übersicht der Dateien

| Baustein | Datei |
|---|---|
| Tonlagen, Beschriftungen, Ableitung des Repo-Zustands | `dashboard/src/domain/status-tone.ts` |
| Symbol, Text, Badge für einen Zustand | `dashboard/src/components/status/status.tsx` |
| Farb-Tokens für Status | `dashboard/src/app/globals.css` |
| Tabelle mit Sortierung, Karten unter 768 px | `dashboard/src/components/data/data-table.tsx` |
| Filter-Chips und Leiste | `dashboard/src/components/data/filter-chips.tsx` |
| Freitextsuche | `dashboard/src/components/data/search-box.tsx` |
| Blättern | `dashboard/src/components/data/pagination.tsx` |
| Ladezustände in Zeilenform | `dashboard/src/components/data/table-skeleton.tsx` |
| Link auf die Plattform | `dashboard/src/components/data/external-link.tsx` |
| Leerzustand | `dashboard/src/components/shell/empty-state.tsx` |
| Adressparameter lesen und schreiben | `dashboard/src/lib/search-params.ts` |
| Datum, Zeit, Dauer, Plural | `dashboard/src/lib/format.ts` |
| Abgleich-Stempel | `dashboard/src/components/shell/sync-stamp.tsx`, `dashboard/src/queries/sync.ts` |
| Auto-Refresh | `dashboard/src/components/shell/auto-refresh.tsx` |
| LIKE-Maskierung für Suchtexte | `dashboard/src/lib/sql.ts` |
| Sichere externe Adressen (nur https) | `dashboard/src/lib/safe-external-href.ts` |

## 2. Status: Töne, Symbole, Farben

### 2.1 Töne

`StatusTone` in `dashboard/src/domain/status-tone.ts` hat fünf Werte: `fehler`, `warnung`, `laeuft`, `erfolg`,
`neutral`. Die Rangfolge für „dringendster Zustand“ und Sortierung steht in `TONE_RANK` (kleiner heißt dringender):
`fehler` 0, `warnung` 1, `laeuft` 2, `erfolg` 3, `neutral` 4.

Alle Beschriftungen liegen in derselben Datei, je als `Record` über den Wert:

- `PROBLEM_KIND_LABEL`, `PROBLEM_KIND_ORDER`, `PROBLEM_KIND_TONE` (Arten von Problemen)
- `UPDATE_TYPE_LABEL`, `UPDATE_TYPE_TONE` (Update-Typen)
- `CI_STATUS_LABEL`, `CI_STATUS_TONE`
- `JOB_STATUS_LABEL`, `JOB_STATUS_TONE`, `JOB_TRIGGER_LABEL`
- `ONBOARDING_LABEL`, `ONBOARDING_TONE`, `BUILD_CHECK_LABEL`, `BUILD_CHECK_TONE`

`deriveRepoHealth` leitet den dringendsten Zustand eines Repos ab. Die Reihenfolge der Prüfungen:

1. entfernt, dann archiviert (Ton `neutral`)
2. offene Sicherheitsupdates (`fehler`)
3. offene Probleme der Arten mit Ton `fehler`, in der Reihenfolge `PROBLEM_KIND_ORDER`
4. hängende PRs (`stale_pr`, `warnung`)
5. Onboarding `none` (`warnung`)
6. fehlender Build-Check (`warnung`)
7. Major-Updates (`warnung`)
8. laufender Job (`laeuft`)
9. Onboarding-PR offen (`laeuft`), deaktiviert (`neutral`)
10. sonst `erfolg` mit dem Text „Aktuell“

### 2.2 Symbol je Ton

Jeder Status trägt Text und ein Symbol in eigener Form. Das ist die Regel „nie nur Farbe“. Die Symbole stehen in
`dashboard/src/components/status/status.tsx` (`ICONS`):

| Ton | Symbol (lucide) | Form |
|---|---|---|
| `fehler` | `CircleXIcon` | Kreuz im Kreis |
| `warnung` | `TriangleAlertIcon` | Dreieck |
| `erfolg` | `CheckIcon` | Haken |
| `laeuft` | `ContrastIcon` | halber Kreis |
| `neutral` | `MinusIcon` | Strich |

Die Symbole sind `aria-hidden`. Der Text trägt die Bedeutung.

### 2.3 Bausteine

- `StatusIcon({ tone, className })`: nur das Symbol, in der Farbe des Tons.
- `StatusText({ tone, children })`: Symbol und Text ohne Fläche, für Tabellenzellen und Detailzeilen. Die Textfarbe
  ist je Ton gesetzt. Für `erfolg` ist der Text Tinte (`text-ink`), nur das Symbol ist grün.
- `StatusBadge({ tone, children })`: Pille mit leichter Fläche und Ring, für den dringendsten Zustand eines Repos
  und für Update-Typen.

### 2.4 Farb-Tokens

Die Tokens stehen in `dashboard/src/app/globals.css` im Block `:root` und werden über `--color-status-*` für
Tailwind freigegeben (Klassen wie `text-status-fehler`, `bg-status-fehler/8`).

| Token | Wert | Bedeutung |
|---|---|---|
| `--status-fehler` | `#a63a2b` | Fehler, auch `--destructive` |
| `--status-warnung` | `#8a5f10` | Warnung |
| `--status-erfolg` | `var(--logo-gruen)` = `#6b8e23` | Erfolg, nur Symbole und Linien |
| `--status-laeuft` | `var(--rheinblau-hell)` = `#3d62b5` | läuft oder wartet |
| `--status-neutral` | `var(--ink-soft)` = `#525866` | neutral |

Der Entwurf legt für Logo-Grün fest: nur Symbol oder Linie, nie Fließtext (Kontrast 3,81:1 auf Weiß, Grafik ab 3:1). Fassholz (`--fassholz`) ist kein Status mehr. `--destructive` zeigt auf `--status-fehler`.

## 3. Tabelle: `DataTable`

Datei: `dashboard/src/components/data/data-table.tsx`. Ein Client-Baustein mit TanStack Table.

### 3.1 Aufruf

```ts
DataTable<T>({
  caption,          // sichtbar versteckt in <caption> und als aria-label der Karten-Liste
  columns,          // ColumnDef<T>[] mit id, header, cell, optional accessorFn, meta, enableSorting
  rows,             // bereits gefilterte und vom Server gelieferte Zeilen
  rowKey,           // eindeutige ID je Zeile
  renderCard,       // Inhalt einer Karte unter 768 px
  renderExpanded,   // optional: (row, layout) => ReactNode | null, Zusatzzeile
  manualSorting,    // optional, Standard false: Zeilen sind bereits sortiert (Sortierung auf dem Server)
  rowClassName,     // optional; in den Aufrufen nicht verwendet
})
```

### 3.2 Layout

- Ab 768 px (`md`) eine echte `<table>` mit `scope="col"` in den Spaltenköpfen. Darunter eine Liste (`<ul>`) mit
  Karten (`renderCard`). Beide stehen im DOM; CSS blendet je nach Breite eines aus. Tests prüfen deshalb mit
  `visible=true`.
- `meta.align = "right"` rechtsbündig (für Zahlen), `meta.className` für Sichtbarkeit je Breite (z. B.
  `hidden lg:table-cell` bei Onboarding und Build-Check in `repo-table.tsx`).
- Zeilenhöhe etwa 40 px (`h-10`). Die Sortierschaltfläche in der Kopfzeile bekommt mit einem Pseudo-Element eine
  größere Trefferfläche.

### 3.3 Sortierung

- Die Sortierung steht in der Adresse: `sort=<Spalten-ID>` und `dir`. `dir=asc` aufsteigend, sonst absteigend
  (`searchParams.get("dir") !== "asc"`). Ein dritter Klick entfernt die Sortierung (`enableSortingRemoval`).
- Nur Spalten, deren `id` in `columns` steht, werden berücksichtigt. Eine Spalte mit `enableSorting: false` ist
  nicht klickbar.
- Der Spaltenkopf setzt `aria-sort` auf `ascending` oder `descending`. Der Klick und die Taste Enter funktionieren
  auf dem Knopf im Kopf.
- Die Änderung schreibt die Adresse per `router.replace` mit `scroll: false`. `seite` bleibt dabei erhalten. Mit
  `manualSorting` entfällt `seite`: Eine neue Sortierung beginnt auf Seite 1, weil die Seiten über alle Treffer sortiert
  werden (Commit `96e8dfb`).
- **`manualSorting`:** Ohne diese Prop sortiert die Tabelle die übergebenen Zeilen selbst (TanStack Table). Mit
  `manualSorting` übernimmt sie die Reihenfolge der Zeilen. Die Seiten für PRs und Jobs sortieren dann vorher selbst
  über alle Treffer (siehe [`ansichten.md`](ansichten.md), Abschnitte 3.4 und 3.5). `PullRequestTable` und `JobTable`
  reichen die Prop durch. Spaltenköpfe, `aria-sort` und das Schreiben in die Adresse bleiben gleich.

### 3.4 Zusatzzeile (`renderExpanded`)

- Liefert `renderExpanded` einen Knoten, steht er in einer eigenen Zeile direkt unter der Datenzeile, über alle
  Spalten (`colSpan`). Die Datenzeile verliert dabei die untere Linie.
- Auf Karten steht der Knoten unter dem Inhalt der Karte.
- Der zweite Parameter `layout` (`"table"` oder `"card"`) gibt jeder Ausgabe eine eindeutige ID. Beide Layouts
  stehen im DOM.
- Verwendet von `JobTable` für den Log-Auszug (siehe [`ansichten.md`](ansichten.md), Abschnitt 3.5).

### 3.5 Spalten-IDs je Seite

| Seite | Sortierbare IDs |
|---|---|
| `/repos` | `repo`, `status`, `lauf`, `prs`, `sicherheit` |
| `/pull-requests` | `repo`, `typ`, `alter` |
| `/jobs` | `zeit`, `repo`, `ausloeser`, `status`, `dauer` |
| Repo-Detail, PR-Tabelle | `typ`, `alter` (ohne Repo-Spalte) |
| Repo-Detail, Job-Tabelle | `zeit`, `ausloeser`, `status`, `dauer` (ohne Repo-Spalte) |

Die Spalte `repo` der PR-Tabelle und der Job-Tabelle ist nur mit `showRepo` (Standard: an) vorhanden. Die
Rollout-Tabelle und die Schritte im Repo-Detail (`RepoSteps`) sortieren nicht.

## 4. Filter und Suche

### 4.1 `FilterChips`

Datei: `dashboard/src/components/data/filter-chips.tsx`.

- Ein Chip ist ein `Link` mit `replace` und `scroll={false}`. Die Adresse ist `withParams(pathname, searchParams,
  { [param]: next })`. Ohne JavaScript funktioniert das ebenfalls.
- Der Klick schaltet einen Wert um (`toggle`). Mehrfachwerte sind kommagetrennt.
- Ein aktiver Chip (`aria-current="true"`) ist gefüllt, trägt einen Haken und den versteckten Zusatz „(aktiv)“.
- Die Gruppe ist ein `role="group"` mit `aria-label` gleich dem sichtbaren Titel. Der Titel steht ab `sm` sichtbar.
- Die Prop `single` (nur ein Wert) ist vorgesehen, wird aber in keinem Aufruf verwendet.

### 4.2 `FilterBar`

- Umschließt Chips und Suche. Auf dem Handy liegen Chips in einer waagerecht scrollbaren Zeile. Die Seite selbst
  scrollt nicht waagerecht (Tests prüfen 375 px).
- Die Prop `resetHref` zeigt den Link „Filter zurücksetzen“ nur, wenn ein Filter gesetzt ist. Die Seiten geben
  den Link nur bei aktiven Filtern weiter.

### 4.3 `SearchBox`

Datei: `dashboard/src/components/data/search-box.tsx`.

- `<input type="search">` mit sichtbarem Platzhalter und unsichtbarem Label (`label`).
- Die Eingabe wird nach 300 ms per `router.replace` in `q` geschrieben. Leer entfernt den Parameter. Andere Parameter
  bleiben erhalten, `seite` entfällt.
- Ändert sich `q` in der Adresse (etwa durch „Filter zurücksetzen“), zieht das Feld nach. Das geschieht nicht, solange
  eine Eingabe noch auf ihre Pause wartet oder das Feld den Fokus hat. Eine laufende Eingabe bleibt dann erhalten.
- Die Filterung findet auf dem Server statt. Die Suche ist kein Client-Filter.

### 4.4 `Pagination`

Datei: `dashboard/src/components/data/pagination.tsx`.

- Bei einer Seite rendert sie nichts. Sonst eine Navigation (`aria-label="Seiten"`) mit „Zurück“, „Seite N von M“
  und „Weiter“. Die Links setzen `seite` über `withParams`; Seite 1 entfernt den Parameter.
- Verwendet auf `/pull-requests` und `/jobs`.

## 5. Adressparameter: `search-params.ts`

Datei: `dashboard/src/lib/search-params.ts`. Die Typen: `RawSearchParams = Record<string, string | string[] | undefined>`.

| Funktion | Verhalten |
|---|---|
| `parseText(sp, key)` | ohne Steuerzeichen (C0 und DEL), getrimmt, auf 100 Zeichen gekürzt, leer wird `undefined` |
| `parseList(sp, key, allowed)` | kommagetrennt; nur Werte aus `allowed`, in der Reihenfolge von `allowed`, ohne Duplikate |
| `parseOne(sp, key, allowed, fallback)` | ein erlaubter Wert, sonst `fallback`. Verwendet auf `/probleme` für `ansicht` |
| `parseFlag(sp, key)` | wahr bei `1` oder `ja` |
| `parsePage(sp, key = "seite")` | positive ganze Zahl, sonst 1 |
| `parseSort(sp, allowed)` | liefert `{ key, dir }` oder `null`. Verwendet auf `/pull-requests` (`PR_SORT_KEYS`) und `/jobs` (`JOB_SORT_KEYS`). `DataTable` liest `sort` und `dir` nur für die Anzeige der Sortierung |
| `toUrlSearchParams(sp)` | macht aus allen Werten Strings, Listen werden kommagetrennt |
| `withParams(pathname, current, changes)` | setzt, ersetzt oder entfernt Parameter (`undefined`, leer, leere Liste entfernen). Ohne Angabe von `seite` entfernt sie `seite` |
| `toggle(list, value)` | Wert in einer Liste umschalten |

Kommt ein Schlüssel mehrfach vor, liest `first()` nur den ersten Wert. Das betrifft alle `parse*`-Funktionen.
`toUrlSearchParams` und `withParams` fügen Arrays dagegen kommagetrennt zusammen.

## 6. Abgleich-Stempel

### 6.1 Daten

`loadSyncStamp(db)` in `dashboard/src/queries/sync.ts` liest `sync_state` für zwei Quellen:

| Quelle | Label | Intervall | „veraltet“ ab |
|---|---|---|---|
| `github` | GitHub | 5 Minuten | 15 Minuten ohne Erfolg (dreifaches Intervall) |
| `ce` | Renovate | 60 Sekunden | 3 Minuten ohne Erfolg |

- `lastError` ist nur gesetzt, wenn der Fehler jünger ist als der letzte Erfolg (oder kein Erfolg da ist).
- `partialErrorCount` zählt die Einträge in `partial_errors`.
- `pausedUntil` kommt direkt aus `sync_state`.
- Fehlt eine Zeile, gilt die Quelle als „noch kein Abgleich“.
- Der Aufruf im Layout (`dashboard/src/app/layout.tsx`) fängt Fehler ab. Dann bekommt die Kopfzeile `null`, und der
  Stempel zeigt „Datenbank nicht erreichbar“.

### 6.2 Zustände je Quelle

`describe()` in `dashboard/src/components/shell/sync-stamp.tsx` prüft in dieser Reihenfolge:

1. **Fehler** (`lastError`), Ton `fehler`: „GitHub: Fehler HH:MM“. Die Details (Fehlermeldung, Zeitpunkt und, falls
   vorhanden, „Daten von HH:MM“) stehen im Tooltip und in einem versteckten Text.
2. **Noch kein Abgleich** (kein Erfolg), Ton `neutral`: „GitHub: noch kein Abgleich“.
3. **Pausiert** (`pausedUntil` liegt in der Zukunft), Ton `warnung`: „Renovate HH:MM, pausiert“. Details: Kontingent
   knapp, Abgleich pausiert bis HH:MM.
4. **Veraltet** (Erfolg liegt länger als das Dreifache des Intervalls zurück), Ton `warnung`: „GitHub HH:MM, veraltet“.
5. **Teilfehler** (`partialErrorCount > 0`), Ton `warnung`: „GitHub HH:MM“. Der Hinweis „N Repo(s) mit Teilfehler im
   letzten Abgleich“ steht nur im Tooltip und im versteckten Text. Auf der Repo-Liste steht die Meldung je Repo
   (`PartialError` in `repo-table.tsx`).
6. **Erfolg**, Ton `erfolg`: „GitHub HH:MM“.

Der Stempel enthält keine Zahlen außer der Uhrzeit. Die Uhrzeit steht in Europe/Berlin (`formatTime`).

### 6.3 Platzierung

`SiteHeader` (`dashboard/src/components/shell/site-header.tsx`) rendert den Stempel zweimal: ab `lg` in der Kopfleiste
und darunter als eigene Zeile unter `lg`. Beide erhalten dieselben Daten.

## 7. Auto-Refresh

Datei: `dashboard/src/components/shell/auto-refresh.tsx`. Eingebunden in `dashboard/src/app/layout.tsx`, also auf jeder
Seite.

- Alle 60 Sekunden `router.refresh()`, solange `document.visibilityState` „visible“ ist.
- Beim Wechsel auf „visible“ sofort ein Refresh und der Timer startet neu. Beim Verlassen des Tabs stoppt der Timer.
- Das Intervall ist per Prop änderbar (Standard 60 000 ms). Der Aufruf im Layout verwendet den Standard.
- `router.refresh()` lädt die Server-Komponenten neu. Der Erledigt-Zustand im Lagebericht überlebt das, weil
  `StepList` gemountet bleibt. Der Schlüssel ändert sich nur beim Repo-Filter. Details in
  [`lagebericht.md`](lagebericht.md), Abschnitt 3.

## 8. Weitere Bausteine

- **`EmptyState`** (`dashboard/src/components/shell/empty-state.tsx`): Überschrift, optionaler Inhalt und optionaler
  Link `action`. Verwendet auf allen Listenseiten und auf der Not-Found-Seite.
- **`TableSkeleton` und `HeaderSkeleton`** (`dashboard/src/components/data/table-skeleton.tsx`): Platzhalter in
  Zeilenform, kein Ladekreisel. `TableSkeleton` hat `role="status"`, `aria-live="polite"` und einen versteckten
  Text. Die Loading-Dateien der Listen-Seiten verwenden sie; die Zeilenzahl steht in `ansichten.md` (Repos 12,
  Repo-Detail 4, Probleme 6). Für Jobs und PRs gilt der Standard von 8 Zeilen.
- **`ExternalLink`** (`dashboard/src/components/data/external-link.tsx`): `target="_blank"`, `rel="noopener noreferrer"`,
  Symbol „extern“ und der versteckte Zusatz „(öffnet in neuem Tab)“. Verlinkt wird nur `https:`. Die Prüfung
  übernimmt `safeExternalHref` (`dashboard/src/lib/safe-external-href.ts`). Bei anderen Werten, etwa aus der Datenbank,
  steht der Text ohne Link als `span`. Dieselbe Prüfung nutzen die Schritt-Aktionen im Lagebericht
  (`step-list.tsx`) und im Repo-Detail (`repo-steps.tsx`). Diese Stellen haben eigene Markup-Blöcke.
- **LIKE-Muster** (`dashboard/src/lib/sql.ts`): `escapeLike` maskiert `%`, `_` und `\`. `likePattern` baut daraus
  `%text%`. Die Abfragen für Repos, PRs und Jobs nutzen die Funktionen für die Freitextsuche.
- **Formatierung** (`dashboard/src/lib/format.ts`), Zeitzone `Europe/Berlin`:
  - `formatTime`: „14:05“
  - `formatDateTime`: „20.10.2026, 14:05“
  - `formatDate`: „20.10.2026“
  - `formatRelative(d, now)`: „gerade eben“ (unter einer Minute), „vor N Min.“, „vor N Std.“, dann Tage: „vor 1 Tag“,
    „vor N Tagen“
  - `ageInDays(d, now)`: ganze Tage, abgerundet, nicht negativ
  - `formatDuration(ms)`: „42 s“, „3 Min. 05 s“, „1 Std. 02 Min.“. Ohne Wert „–“ (Gedankenstrich)
  - `plural(n, einzahl, mehrzahl)`
- **Schriften und Monospace:** Monospace nutzen der Versionssprung, der Konfigurationspfad im Repo-Detail und der
  Log-Auszug (`font-mono`, Tailwind). Der Entwurf sieht den Systemstack `ui-monospace, "SF Mono", Menlo, Consolas`
  vor. Eine eigene Webfont ist nicht eingebunden: `dashboard/src/app/layout.tsx` lädt nur Inter und Montserrat.
- **Fokus und Bewegung:** `globals.css` setzt einen sichtbaren Fokusrahmen und schaltet Animationen und Übergänge
  bei `prefers-reduced-motion: reduce` praktisch aus.

## 9. Offene Punkte

- `@tanstack/react-table` ist bewusst auf `8.21.3` gepinnt: v9 erschien erst im August 2026 mit geänderter API; das Update kommt als Renovate-Major-PR.
- Ungenutzt im Code: die Prop `rowClassName` von `DataTable` und die Prop `single` von `FilterChips`. Sie sind
  vorhanden, aber nicht aufgerufen. Ob sie bleiben oder entfernt werden, ist offen.