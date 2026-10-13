# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Ein einziger Nutzer: Sascha Krinke**, Betreiber der Plattform. Er pflegt seine privaten Projekte (GitHub-Account `Hiwamashi`) und die Projekte von Krinke IT-Consulting (Organisation `Krinke-IT-Consulting`) und kennt Git, CI und Abhängigkeitsmanagement.

Typische Situationen:
- **Am Desktop, in einer regelmäßigen Sichtung:** Major-Updates freigeben, rote Builds klären, neue Repos onboarden, fehlgeschlagene Renovate-Läufe nachvollziehen.
- **Mobil, zwischendurch:** kurzer Blick, ob Sicherheitsupdates offen sind oder ein Lauf fehlgeschlagen ist.

Weitere Nutzer gibt es nicht. Kunden von Krinke IT-Consulting kommen erst mit der Mandantenfähigkeit hinzu; ob sie das Dashboard dann selbst nutzen oder nur der Betreiber für sie, ist **offen**.

## Product Purpose

Die **Krinke-IT - Update Zentrale** ist das Status-Dashboard einer selbst gehosteten Renovate-Plattform (Mend Renovate CE). Sie zeigt an einer Stelle, wie aktuell alle angebundenen GitHub-Repos sind, welche Renovate-PRs offen sind, welche Läufe fehlgeschlagen sind und wo etwas klemmt. Außerdem rollt sie das Onboarding neuer Repos per PR aus (eine `renovate.json` und die Aufruf-Datei des Build-Checks). Vollständige Anforderungen: `PRD.md`.

**Erfolg heißt:**
- **Alle aktiven Repos sind onboarded, und kein Sicherheitsupdate bleibt lange offen.** Die konkrete Höchstdauer in Tagen ist noch **offen**.
- **Kein Blick mehr in einzelne Repos nötig**, um ihren Stand zu kennen: Die Update Zentrale ist die einzige Stelle, an der der Zustand aller Repos abgelesen wird.

## Positioning

Eine eigene Übersicht über alle Repos, die es so weder in Renovate CE (ohne Weboberfläche) noch in der Mend-App gibt, und das ohne Drittanbieter mit Codezugriff. Daten, Tokens und Läufe bleiben vollständig auf der eigenen Infrastruktur (Coolify). Die Plattform ist von Anfang an für GitLab und mehrere Mandanten vorbereitet.

## Operating Context

- Läuft unter `renovate.krinke-it.cloud` hinter einer eigenen Authelia-Instanz (`renovate-auth.krinke-it.cloud`, mit 2FA). Der Login erfolgt über Authelia, das Dashboard hat keine eigene Nutzerverwaltung.
- Datenquellen: die Job-API von Renovate CE sowie die GitHub-API über die GitHub App der Plattform. Abgeglichen wird per Polling (Jobs etwa jede Minute, GitHub etwa alle 5 Minuten), nicht in Echtzeit.
- Daneben gibt es zwei Orte, die das Dashboard nicht ersetzt, sondern verlinkt: die Dependency-Dashboard-Issues von Renovate in jedem Repo und die PRs selbst auf GitHub.
- Ziel-Repos: rund 25, erwartet sind bis zu 50, mit gemischten Ökosystemen (npm, pnpm, Bun, Python, Go, Docker/Compose, GitHub Actions, Expo, AWS CDK).

## Capabilities and Constraints

- **Ansichten:** Übersicht mit Kennzahlen, Repos, Repo-Detail, Pull Requests über alle Repos, Jobs mit Log-Auszug, Probleme
- **Aktionen:** Renovate-Lauf für ein Repo oder alle Repos anstoßen, Onboarding-PR anlegen, Build-Check ausrollen. Jede Aktion verlangt eine Bestätigung.
- **Stack** (aus dem PRD): Next.js (App Router, TypeScript), Tailwind CSS, shadcn/ui, TanStack Table, PostgreSQL mit Drizzle, Octokit. Deployment als Docker-Compose-Stack in Coolify.
- **Plattformneutral:** Alle Zugriffe auf GitHub laufen über einen `PlatformAdapter`. Begriffe in der Oberfläche dürfen GitLab nicht ausschließen, etwa „Pull Request" mit dem späteren „Merge Request" im Blick.
- **Nur heller Modus**, kein Dark Mode
- Responsive für Desktop und Mobile
- Das Repo ist **öffentlich**: keine Secrets und keine kundenbezogenen Daten im Code
- **Fachbegriffe:** Onboarding-PR, Build-Check, Dependency Dashboard, Job (Renovate-Lauf), Problem, Update-Typ (Major/Minor/Patch/Security/Digest), Automerge
- **Offen:** Höchstdauer für offene Sicherheitsupdates; Benachrichtigungen; ob Kunden später selbst Zugang bekommen

## Brand Commitments

- **Name in der Oberfläche:** „Krinke-IT - Update Zentrale"
- **Ausgangspunkt der Gestaltung:** krinke.me. Verbindliche Referenz ist dessen `DESIGN.md` (`/Users/saschakrinke/Quellcode/Cursor/webseite - krinke.me/Webseite---krinke.me/DESIGN.md`) mit CI-Palette, Montserrat/Inter und einem Logo, das nicht verändert werden darf. Die dashboard-spezifische visuelle Sprache entsteht später in der eigenen `DESIGN.md` dieses Repos.
- **Logo:** krinke.me-Logo (`logo-wide.png`, `logo-compact.png`, `logo-square.png` aus `Webseite---krinke.me/public/images/`), unverändert. Es wird nicht neu gezeichnet, nicht umgefärbt und nicht beschnitten.
- **Tonfall wie krinke.me:** Deutsch, kompetent und pragmatisch, auf Augenhöhe, ohne Marketingsprache. Angesprochen wird wie auf krinke.me mit „Sie".

## Evidence on Hand

- Echte Daten kommen zur Laufzeit aus GitHub und Renovate CE. Die Bestandsaufnahme der Ziel-Repos steht in `PRD.md` (Abschnitt 2).
- Logos liegen im krinke.me-Repo unter `public/images/`.
- **Nicht vorhanden und nicht zu erfinden:** Beispiel-Repos, Kennzahlen oder Screenshots, die nicht aus echten Daten stammen. Für Entwicklung und Tests sind Fixtures als solche zu kennzeichnen.

## Product Principles

1. **Was eine Entscheidung braucht, steht vorn.** Sicherheitsupdates, rote Builds, fehlgeschlagene Läufe und nicht onboardete Repos kommen vor allem, was einfach läuft.
2. **Eine Wahrheit für alle Repos.** Der Stand eines Repos muss hier ablesbar sein, ohne GitHub zu öffnen; GitHub ist das Ziel für die Aktion, nicht für die Suche.
3. **Nachvollziehbar statt magisch.** Jeder Status zeigt, woher er kommt und wann er zuletzt abgeglichen wurde. Jede Aktion nennt vorher ihre Wirkung und hinterlässt einen Link (PR, Job).
4. **Eigene Infrastruktur, eigene Kontrolle.** Keine Drittanbieter-Dienste, kein Tracking, keine externen Einbindungen.
5. **Plattformneutral wachsen.** Heute GitHub und ein Mandant; nichts in Begriffen, Struktur oder Daten darf GitLab oder weitere Mandanten verbauen.

## Accessibility & Inclusion

- Wie bei krinke.me: Skip-Link, sichtbare Fokusstile, vollständige Tastaturbedienung (auch Menü, Dialoge und Tabellen), volle Unterstützung von `prefers-reduced-motion` und Touch-Ziele von mindestens 44 × 44 px
- Status wird nie allein über Farbe vermittelt (Badges tragen Text oder Icon).
- Ein formaler Standard (z. B. WCAG 2.2 AA) ist wie bei krinke.me noch **nicht bestätigt**, also offen.
