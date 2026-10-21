# Dashboard: Aufbau und Betrieb

Stand: 2026-10-22. Quellen: `dashboard/Dockerfile`, `dashboard/next.config.ts`, `dashboard/scripts/build-migrate.mjs`,
`dashboard/src/db/migrate-cli.ts`, `dashboard/src/env.ts`, `dashboard/src/proxy.ts`, `dashboard/src/lib/session-check.ts`,
`dashboard/src/app/api/health/route.ts`, `dashboard/src/db/health.ts`, `deploy/docker-compose.yaml`.
Das Deployment auf Coolify steht in `../betrieb-coolify.md`, die Geheimnisse in `../secrets-register.md`.

## 1. Ein Container, ein Prozess

Das Dashboard läuft als ein Container `renovate-dashboard` im Stack `deploy/docker-compose.yaml`. Im Container läuft ein
einziger Node-Prozess: der Next-Server. Der Abgleich mit GitHub und Renovate CE startet darin über
`src/instrumentation.ts` (`register()`), einmal je Serverprozess. Es gibt keinen separaten Worker-Container.

- Build-Kontext: `../dashboard` (relativ zu `deploy/`).
- `mem_limit: 512m` (Begründung im Compose-Kommentar: der Server hat 7,7 GB RAM ohne Swap).
- `restart: unless-stopped`.
- `depends_on`: `postgres` (Bedingung `service_healthy`) und `renovate-authelia` (Bedingung `service_healthy`).
- Netze: `default` und das externe Proxy-Netz `coolify`. Traefik spricht den Dienst über `coolify` an.
- Kein Port wird veröffentlicht. Der Dienst hat `EXPOSE 3000` im Dockerfile und den Traefik-Service-Port `3000` im Label.
- Routing: Router `renovate-dashboard` (https, Priorität 1, Middleware `renovate-authelia@docker`) und
  `renovate-dashboard-http` (Weiterleitung nach https). Der Webhook-Router von `renovate-ce` (Priorität 100) gewinnt
  für `/webhook` immer.
- Zusätzliche Umgebungsvariable im Compose: `TZ: Europe/Berlin`. Sie steht nicht im Env-Schema.

## 2. Dockerfile

`dashboard/Dockerfile`, mehrstufig:

| Stufe | Inhalt |
|---|---|
| `base` | `node:24.22.0-alpine` mit Digest (Version und Digest stehen in `vorbereitung.md`, Task 1.1). `WORKDIR /app`, `NEXT_TELEMETRY_DISABLED=1`. |
| `deps` | `npm ci` anhand von `package.json` und `package-lock.json`. |
| `build` | Kopiert den Quellcode und führt `npm run build` aus. Das ist `next build` gefolgt von `npm run build:migrate`. |
| `runner` | Nur Laufzeitdateien (siehe unten). |

Im Runner:

- `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`.
- Kopiert werden `.next/standalone` (nach `./`), `.next/static`, `public`, `drizzle` und `dist/migrate.js` (als `migrate.js`).
- `USER node`. Laut Kommentar im Dockerfile ist das die uid 1000 aus dem Basisimage.
- Der Build braucht keine Secrets und keine Datenbank; alle Seiten sind dynamisch (Kommentar im Dockerfile).
- Startbefehl: `CMD ["sh", "-c", "node migrate.js && exec node server.js"]`. Erst die Migrationen, dann der Server als PID 1.

`dashboard/next.config.ts`: `output: "standalone"`, `poweredByHeader: false`, `reactStrictMode: true`.

`dashboard/scripts/build-migrate.mjs` bündelt `src/db/migrate-cli.ts` mit esbuild zu `dist/migrate.js` (Format `cjs`,
Target `node22`, `pg-native` extern). Das Image braucht dadurch kein `node_modules` für den Migrationslauf.
`dist/` steht in `dashboard/.gitignore`.

## 3. Startablauf

1. `node migrate.js` (`src/db/migrate-cli.ts`):
   - Liest das gesamte Env-Schema über `getEnv()`. Fehlt ein Wert, endet der Lauf mit Exit-Code 1. Die Ausgabe nennt
     nur die Variablennamen.
   - Ruft `runMigrations` auf (`src/db/migrate.ts`). Details zum Advisory-Lock und zur Migration in `datenmodell.md`.
   - Gibt `Migrationen angewendet: <n>. Tenant angelegt|vorhanden.` aus.
   - Bei einem Datenbankfehler gibt er nur `Migration fehlgeschlagen (<SQLSTATE>).` aus, ohne Verbindungsdaten.
2. `exec node server.js`: Next startet den Server. `instrumentation.ts` ruft `startSyncFromEnv()` auf (siehe `abgleich.md`).
   Ist das Env-Schema unvollständig, schreibt der Abgleich einmal `Abgleich nicht gestartet: Konfiguration unvollständig (<Namen>).`
   und startet nichts. Der Server selbst läuft weiter.

## 4. Healthcheck

Endpunkt `GET /api/health` (`src/app/api/health/route.ts`, `dynamic = "force-dynamic"`):

- Antwort `200 {"status":"ok"}` oder `503 {"status":"unavailable"}`, Header `cache-control: no-store`. Keine Details.
- `isHealthy()` (`src/db/health.ts`) gilt nur, wenn die Datenbank erreichbar ist und die Migrationen vollständig sind:
  Anzahl der Zeilen in `drizzle.__drizzle_migrations` entspricht der Anzahl der Einträge in `drizzle/meta/_journal.json`,
  und der neueste `created_at`-Wert entspricht dem jüngsten `when` im Journal.
- GitHub und Renovate CE sind nicht Teil der Prüfung (Kommentar im Code, Spec "Gesundheitszustand").
- Der Pool für diese Prüfung hat `max: 2`, Verbindungs- und Abfrage-Timeout je 3 Sekunden.

Der Docker-Healthcheck in Compose (überschreibt den Dockerfile-Healthcheck):
`node -e "fetch('http://127.0.0.1:3000/api/health')..."`, Intervall 15 s, Timeout 5 s, 3 Versuche, Startfrist 30 s.
`127.0.0.1` statt `localhost`, weil Node `localhost` auch als `::1` auflöst (Kommentar im Compose).

## 5. Konfiguration: Env-Schema

Das Schema steht in `dashboard/src/env.ts`. Alle sechs Werte sind Pflicht, es gibt keine Vorgabewerte.
Der Build braucht sie nicht.

| Name | Prüfung im Code | Wer setzt ihn im Betrieb |
|---|---|---|
| `DATABASE_URL` | muss mit `postgres://` oder `postgresql://` beginnen | Compose, zusammengesetzt aus `DASHBOARD_DB_PASSWORD` (Name) |
| `RENOVATE_CE_API_URL` | muss mit `http://` oder `https://` beginnen | Compose, `http://renovate-ce:8080` |
| `MEND_RNV_API_SERVER_SECRET` | nicht leer | Compose, Coolify (gemeinsamer Wert mit `renovate-ce`) |
| `MEND_RNV_GITHUB_APP_ID` | nicht leer | Compose, Coolify |
| `MEND_RNV_GITHUB_APP_KEY` | nicht leer | Compose, Coolify |
| `AUTHELIA_INTERNAL_URL` | muss mit `http://` oder `https://` beginnen | Compose, `http://renovate-authelia:9091` |

Zur Lesung:

- Gelesen wird erst zur Laufzeit: `getEnv()` (alle Werte, einmal gecacht) und `getEnvFor(...)` (nur benötigte Werte).
  Der Proxy braucht nur `AUTHELIA_INTERNAL_URL`; der Datenbank-Pool liest `DATABASE_URL` erst beim ersten Zugriff.
- Fehlermeldungen nennen nur Variablennamen (`EnvError`). Werte werden nie ausgegeben.
- Die Werte für den lokalen Betrieb stehen in `dashboard/.env.local`. Die `.gitignore` im Repo-Root schließt `.env*` aus,
  ausgenommen `.env.example`. Die Namen stehen in der Vorlage `.env.example` im Repo-Root.
  Die Herkunft der einzelnen Werte steht in `../secrets-register.md`. Dieses Dokument nennt keine Werte.
- Ohne `AUTHELIA_INTERNAL_URL` weist der Proxy alle Anfragen mit 403 ab und loggt das einmal.

## 6. Vertrauensgrenze

Das Dashboard vertraut keinem Header von außen. Jede Anfrage braucht eine Sitzung, die Authelia bestätigt
(`design.md`, Entscheidung 4; Umsetzung in `src/proxy.ts` und `src/lib/session-check.ts`).

Ablauf je Anfrage (`proxy.ts`, Funktion `proxy`):

1. Ohne Cookie: 403, ohne Anfrage an Authelia.
2. Sonst `createSessionChecker().check()`:
   - Ausnahme: `GET /api/health` wird ohne Prüfung durchgelassen.
   - Cache-Schlüssel: SHA-256 über Cookie und Host (`x-forwarded-host` oder `host`). Nur positive Ergebnisse werden
     gecacht, 30 Sekunden, höchstens 500 Einträge. Abgelaufene Einträge werden beim Zugriff entfernt; beim Überlauf fällt
     der älteste Eintrag weg.
   - Anfrage an `GET {AUTHELIA_INTERNAL_URL}/api/authz/forward-auth` mit dem Cookie und den Headern `X-Forwarded-Method`,
     `X-Forwarded-Proto` (Standard `https`), `X-Forwarded-Host`, `X-Forwarded-Uri`, optional `X-Forwarded-For`.
     Zeitlimit 3 Sekunden, Weiterleitungen werden nicht gefolgt.
   - Erlaubt nur bei Status 200 und einem nicht leeren Header `Remote-User`. `Remote-Name` und `Remote-Email` werden
     übernommen, wenn gesetzt.
   - Jeder andere Status, jeder Netzfehler und jede Antwort ohne `Remote-User` führt zu 403. Bei Netzfehlern und
     5xx-Antworten wird höchstens einmal je Minute geloggt, ohne Werte.
3. Erlaubt: Die eingehenden Header `remote-user`, `remote-name`, `remote-email`, `remote-groups` und `x-dashboard-user`
   werden entfernt. Danach setzt der Proxy `x-dashboard-user` auf den Wert von `Remote-User` aus der Antwort von Authelia.
   Server Actions lesen den Nutzer nur aus diesem Header (`src/actions/context.ts`).
4. Verweigert: 403, Text `Zugriff verweigert`, `cache-control: no-store`, ohne Details.

Der Proxy gilt für alle Pfade ohne Matcher, also auch für statische Dateien.

Ausgehende Verbindung zur CE: Die Job- und Reporting-API von `renovate-ce` wird mit `Authorization: Bearer` und dem
Server-Secret `MEND_RNV_API_SERVER_SECRET` aufgerufen (`src/ce/client.ts`). Zeitlimit je Anfrage 10 Sekunden.

Der Webhook `/webhook` läuft nicht über das Dashboard, sondern über einen eigenen Router an `renovate-ce` ohne Login
(`deploy/docker-compose.yaml`). Die Prüfung von 403 bei direktem Aufruf aus dem Netz und die Prüfung des Webhooks stehen
in `../betrieb-coolify.md`, Abschnitt 8.

## 7. Ressourcen

| Dienst | Grenze laut Compose | Anmerkung |
|---|---|---|
| `renovate-dashboard` | `mem_limit: 512m` | Der Dienst setzt keine CPU-Grenze. |
| `renovate-ce` | `mem_limit: 3g` | Kommentar im Compose: harte Grenze, weil der Host ohne Swap läuft. |
| `postgres` | keine Grenze | |

Datenbankverbindungen des Dashboards: Der gemeinsame Pool (`src/db/client.ts`) hat `max: 10`, Verbindungs-Timeout 5 Sekunden.
Jeder Abgleichsdurchlauf (GitHub, CE, Probleme) reserviert während seiner Laufzeit eine Verbindung für seinen Advisory-Lock
(`src/sync/lock.ts`). Die Gesundheitsprüfung nutzt
einen eigenen Pool mit `max: 2`.

## 8. Deployment, Geheimnisse, Migrationen

- Deployment, Routing, Prüfungen nach dem Deploy und die Erkenntnisse des ersten Deploys stehen in
  `../betrieb-coolify.md`. Die Ergebnisse von Task 4.6 stehen in dessen Abschnitt 8.
- Herkunft, Zweck und Erneuerung der Geheimnisse stehen in `../secrets-register.md`.
- Das Schema und die Migrationen beschreibt `datenmodell.md`.
- Das frühere Proxy-Secret (`DASHBOARD_PROXY_SECRET`) gibt es im Code, in `deploy/`, in `.github/` und in
  `renovate-ce/` nicht mehr. Die Sitzungsprüfung ersetzt es (Task 4.7).

Die Coolify-Variable `DASHBOARD_PROXY_SECRET` wurde nach Freigabe des Betreibers im Oktober 2026 aus
Coolify gelöscht; sie steht deshalb auch nicht in `secrets-register.md`.
