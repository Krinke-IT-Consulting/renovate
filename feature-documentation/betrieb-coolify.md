# Betrieb auf Coolify (Compose-Stack)

Status: Der Stack läuft seit dem ersten Deploy (Change `compose-stack`). Der Change `dashboard` ersetzt den
Platzhalter durch das Dashboard (`renovate-dashboard`, Stand im Repo, Deploy steht aus). Noch nicht
deployt ist diese Änderung: Die Einrichtung in Coolify, das Deploy und die Prüfungen nach dem Deploy (Tasks 5.x) stehen
aus und brauchen eine ausdrückliche Freigabe des Betreibers. Quelle der Anforderungen:
`openspec/changes/archive/2026-10-14-compose-stack/` (`proposal.md`, `design.md`, `tasks.md`, `specs/`).

Dieses Dokument beschreibt, was die Dateien im Repo tatsächlich enthalten. Wenn eine Datei und dieser
Text voneinander abweichen, gilt die Datei. Werte (Secrets, Passwörter, Lizenzschlüssel, PEM-Schlüssel)
stehen in keinem Dokument dieses Repos; sie leben in `.env.production` und in Coolify.

## 1. Überblick

Der Stack besteht aus vier Diensten (`postgres`, `renovate-ce`, `renovate-authelia`, `renovate-dashboard`) in einer Datei, `deploy/docker-compose.yaml`. Coolify liest diese Datei
(Compose-Ressource, Base Directory `/deploy`, Compose-Datei `/docker-compose.yaml`). Dienste mit `build:` baut
Coolify beim Deploy aus den Kontexten unter `deploy/` und `renovate-ce/`. Pflicht-Secrets prüft der
Containerstart (bei `renovate-ce` das Skript `renovate-ce/check-env.sh`), nicht die Compose-Datei:
Coolify führt den Build nur mit Build-Variablen aus, und die Secrets sind bewusst nur zur Laufzeit
gesetzt. Fehlt einer, startet der Dienst nicht, und das Log nennt nur den Namen.

| Dienst | Image / Basis | Volume | Netze | Healthcheck |
|---|---|---|---|---|
| `postgres` | `postgres:17.11`, gebaut aus `deploy/postgres/Dockerfile` (Init-Skript kopiert) | `postgres-data` → `/var/lib/postgresql/data` | nur `default` | `pg_isready -U postgres -d postgres` |
| `renovate-ce` | `ghcr.io/mend/renovate-ce:15.7.0`, gebaut aus `renovate-ce/Dockerfile` (`config.js` eingebacken) | `renovate-cache` → `/tmp/renovate` | nur `default` | `curl -fsS http://localhost:8080/health` |
| `renovate-authelia` | `authelia/authelia:4.39.28`, gebaut aus `deploy/authelia/Dockerfile` (`configuration.yml` eingebacken) | `authelia-data` → `/data` | `default` und `coolify` | `wget` auf `http://localhost:9091/api/health` |
| `renovate-dashboard` | Next.js-Dashboard (Node-Alpine), gebaut aus `dashboard/Dockerfile`, Port 3000, `mem_limit: 512m`, Start `node migrate.js && exec node server.js` | keines | `default` und `coolify` | `node -e fetch(...)` auf `http://127.0.0.1:3000/api/health` (DB erreichbar, Migrationen angewendet) |

Alle Dienste haben `restart: unless-stopped`. Kein Dienst veröffentlicht `ports:`. Die Volumes
`postgres-data`, `authelia-data` und `renovate-cache` sind Named Volumes der Compose-Datei.

**Netze:**

- `default` ist das Netz des Stacks. Alle vier Dienste hängen darin und finden sich über ihren
  Dienstnamen (`postgres`, `renovate-ce`, …).
- `coolify` ist das externe Proxy-Netz des Servers (`networks.coolify.external: true`). Die Datei
  trägt den Eintrag `networks: coolify` an einzelnen Diensten, **Coolify ignoriert ihn aber**: Alle Dienste
  hängen laut Befund aus dem Deploy vom 2026-10-15 nur im Projektnetz des Stacks, das sie allein mit
  `coolify-proxy` (Traefik) teilen. Darauf darf sich nichts verlassen; die Vertrauensgrenze des
  Dashboards hängt deshalb nicht an der Netzzuordnung (siehe Sitzungsprüfung in Abschnitt 3).
- Der Präfix `renovate-` steht, weil Compose Dienstnamen als Alias im geteilten Netz `coolify`
  einträgt. Auf dem Server betreibt vaultsync eine eigene Authelia in diesem Netz. Mit dem Präfix
  kollidieren die Aliase nicht. Die Middleware-Namen tragen aus demselben Grund den Präfix
  (`renovate-authelia@docker`), weil Traefik Middleware-Namen global führt.

**Speichergrenze:** `renovate-ce` hat `mem_limit: 3g`. Der Server hat 7,7 GB RAM und keinen Swap und
trägt zusätzlich vaultsync. Ohne Grenze könnte ein speicherhungriger Lauf (etwa ein Lockfile-Update)
den ganzen Host an den OOM-Killer bringen. Das Dashboard hat `mem_limit: 512m`. Postgres und Authelia haben keine Grenze.

**Abhängigkeit:** `renovate-ce` und `renovate-dashboard` warten per `depends_on` mit
`condition: service_healthy` auf `postgres`, das Dashboard zusätzlich auf `renovate-authelia`. Das Dashboard legt seine Tabellen beim Start selbst an
(`migrate.js`, unter Advisory Lock) und spricht CE nur über `http://renovate-ce:8080` im Stack-Netz an.

## 2. Server

| Merkmal | Wert (Stand 2026-10-13) |
|---|---|
| Name in Coolify | `gentle-goose` |
| IP | 2.28.133.29 |
| CPU | 4 vCPU |
| RAM | 7,7 GB gesamt, 6,4 GB verfügbar |
| Swap | keiner |
| Platte | 75 GB, davon 65 GB frei |
| Coolify | 4.4.6 (laut `design.md`) |
| Weitere Dienste | vaultsync mit eigener Authelia (eigene Domain, eigenes Cookie, eigene Middleware) |

Die Kennzahlen stammen aus Task 1.1 in `tasks.md`. Die Schwelle dort war mindestens 4 GB RAM und 20 GB
Platz frei.

## 3. Routing

Alle Hostnamen zeigen auf 2.28.133.29. Die Zuordnung steht in `deploy/docker-compose.yaml` (Kommentarkopf und
Labels) und in `deploy/authelia/configuration.yml`.

| Host / Pfad | Dienst | Login | Wie geroutet |
|---|---|---|---|
| `https://renovate.krinke-it.cloud/webhook` (exakt, Port 8080) | `renovate-ce` | nein (Signatur mit Webhook-Secret) | Eigene Labels: Router `renovate-webhook`, Regel `Host && Path(/webhook)`, Priorität 100. **Keine Coolify-Domain** – Coolify würde bei einer Domain mit Pfad den Pfad abschneiden und `/webhook/api/...` an CE durchreichen. |
| `https://renovate.krinke-it.cloud/` und alle anderen Pfade (auch `/api/...` und `/webhook/...`) | `renovate-dashboard` (Port 3000) | ja (Passwort und TOTP) | Eigene Labels in `deploy/docker-compose.yaml`: Router `renovate-dashboard` (https, Middleware `renovate-authelia@docker`) und Router `renovate-dashboard-http` (Redirect auf https). Priorität 1. `GET /api/health` ist nur intern für den Healthcheck gedacht. |
| `https://renovate-auth.krinke-it.cloud` (Port 9091 intern) | `renovate-authelia` | nein (ist das Anmeldeportal) | Eigene Labels: Router `renovate-auth` (https) und `renovate-auth-http` (Redirect). **Keine Coolify-Domain** – die Coolify-API verwirft den Port aus der Domain. |
| Job-, System- und Reporting-API von `renovate-ce` | `renovate-ce` | – | Kein Router. Nur im Stack-Netz erreichbar; das Dashboard nutzt sie mit `MEND_RNV_API_SERVER_SECRET`. |
| Postgres (Port 5432) | `postgres` | – | Kein Router, kein veröffentlichter Port. Nur im Stack-Netz erreichbar. |

**WICHTIG:** Für den Dienst `renovate-dashboard` in Coolify **keine Domain setzen**. Coolify würde sonst
einen zweiten, ungeschützten Router für `renovate.krinke-it.cloud` erzeugen. Der Dienst wird allein über
die Labels geroutet.

**Sitzungsprüfung im Dashboard (Vertrauensgrenze):** Das Dashboard vertraut keinem eingehenden Header.
Der Proxy der Next-App (`dashboard/src/proxy.ts`, Logik in `dashboard/src/lib/session-check.ts`) ruft für
jede Anfrage `GET ${AUTHELIA_INTERNAL_URL}/api/authz/forward-auth` auf (in Produktion
`http://renovate-authelia:9091`, fest in der Compose-Datei) und reicht Cookie, `X-Forwarded-Method`,
`-Proto`, `-Host`, `-Uri` und `-For` der Anfrage weiter. Nur Status 200 mit nicht-leerem `Remote-User`
gilt als gültige Sitzung; alles andere (401, 3xx, kein Cookie, Authelia nicht erreichbar, Zeitlimit 3 s)
ergibt 403. Eingehende `Remote-*`- und `x-dashboard-user`-Header werden entfernt, der Nutzer kommt nur aus
der Authelia-Antwort (`x-dashboard-user`, gelesen in `layout.tsx`). Positive Ergebnisse werden 30 s im Speicher
gehalten (SHA-256 aus Cookie und Host, höchstens 500 Einträge). Ausnahme ist exakt `GET /api/health`.
Ist Authelia nicht erreichbar, steht höchstens einmal pro Minute eine kurze Meldung ohne Werte im Log.
Der Router `renovate-dashboard` trägt nur noch die Middleware `renovate-authelia@docker`. Es gibt kein
Proxy-Secret mehr; die frühere Middleware `renovate-dashboard-proxy` entfällt.
Die Redirect-Middleware `renovate-redirect-https` ist an jedem Dienst mit http-Router identisch definiert
(`renovate-ce`, `renovate-authelia`, `renovate-dashboard`). Traefik blendet ungesunde Container aus; so
hängen die http-Router der anderen Dienste nicht davon ab, dass das Dashboard gesund ist.

**Coolify escapt `$` in Labels zu `$$`** (Befund aus dem Deploy am 2026-10-15). Ein Label mit
`${VARIABLE}` erreicht Traefik deshalb als wörtlicher Text, nicht als Wert. Labels enthalten darum keine
`${…}`-Platzhalter. Das war der Grund, den Proxy-Secret-Ansatz zu verwerfen.

**Coolify-Variable `DASHBOARD_PROXY_SECRET` entfernen:** Die Variable wird nicht mehr gebraucht und ist in
Coolify (und in `.env.production`) einzeln zu löschen, nur mit Freigabe des Betreibers.

Die Middleware `renovate-authelia` ist am Dienst `renovate-authelia` als Label definiert:

- `forwardauth.address`: `http://renovate-authelia:9091/api/authz/forward-auth` (interne Adresse)
- `forwardauth.trustForwardHeader`: `true`
- `forwardauth.authResponseHeaders`: `Remote-User,Remote-Groups,Remote-Email,Remote-Name`

Traefik prüft damit die Anmeldung vor dem Dashboard. Gegen gefälschte `Remote-*`-Header und Aufrufe am
Router vorbei schützt zusätzlich die Sitzungsprüfung im Dashboard (siehe oben).

**Authelia-Regeln** (`deploy/authelia/configuration.yml`): `default_policy: deny`. Eine einzige Regel
erlaubt `renovate.krinke-it.cloud` mit `two_factor`. Die Cookie-Domain ist `krinke-it.cloud`, der Cookie
heißt `renovate_authelia_session`.

**Unklar, bis Task 5.3 geprüft ist:** Ob Coolify die eigenen Router-Labels unverändert übernimmt und
ob es für Dienste ohne Domain zusätzliche Router erzeugt. Die Details stehen in
Abschnitt 8. Rückfallebene ist der Compose-Modus „Raw (deploy file as-is)" mit vollständig eigenen
Traefik-Labels für alle drei öffentlichen Ziele.

## 4. Renovate CE

Die Fakten in diesem Abschnitt stammen aus der Doku der gepinnten Version 15.7.0
(`https://github.com/mend/renovate-ce-ee/tree/15.7.0/docs`, Dateien `configuration-options.md`,
`setup-for-github.md`, `overview.md`). Sie wurden für dieses Dokument nicht erneut online geprüft. Die Umsetzung im Repo (Dockerfiles,
`docker-compose.yaml`, `config.js`) wurde dagegen am Code gelesen.

- **Pflicht-Variablen:** `MEND_RNV_LICENSE_KEY`, `MEND_RNV_GITHUB_APP_ID`, `MEND_RNV_GITHUB_APP_KEY`,
  `MEND_RNV_WEBHOOK_SECRET`. Ohne Lizenzschlüssel beendet sich CE mit `FATAL`. Die Meldung nennt nur den
  Variablennamen (lokal geprüft, Task 4.2).
- **API-Secret:** Name `MEND_RNV_API_SERVER_SECRET`. Die Doku nennt früher `MEND_RNV_SERVER_API_SECRET`.
  Der Name ist Pflicht, sobald `MEND_RNV_API_ENABLED=true` gesetzt ist. Der Stack setzt beides.
- **Port:** `MEND_RNV_SERVER_PORT` steht im Stack auf `8080`. Das Image meldet Port 3000, die Doku nennt
  8080 als Default. Der Wert ist explizit gesetzt, damit Healthcheck und Coolify-Domain auf 8080 zeigen.
- **Health-Endpunkt:** `/health`. `curl` ist im Image vorhanden.
- **Webhook:** Pfad `/webhook`. Das Default-Secret ist `renovate`. Ein eigenes Secret ist Pflicht.
- **Cache:** `/tmp/renovate/cache` und `/tmp/renovate/repos`. Das Volume `renovate-cache` liegt auf
  `/tmp/renovate`. Die Werkzeuge unter `/opt/containerbase` sind nicht persistent. Deshalb setzt
  `renovate-ce/config.js` `containerbaseDir: "/tmp/renovate/cache/containerbase"`, damit der
  Download-Cache im Volume liegt und Redeploys übersteht.
- **Globale Konfiguration:** `/usr/src/app/config.js`. Die Datei wird per `COPY` ins Image gebacken,
  nicht gemountet (Begründung in `design.md`, Entscheidung 1: Datei-Mounts in Coolify greifen nur beim
  Anlegen).

**Was `renovate-ce/config.js` setzt:** `onboarding: false`, `requireConfig: "required"`,
`binarySource: "install"`, der `containerbaseDir` oben und optional eine Host-Regel für die Scaleway
Container Registry (`rg.nl-ams.scw.cloud`). Die Regel greift nur, wenn `SCW_REGISTRY_SECRET_KEY` gesetzt
ist. Das Passwort kommt aus der Umgebung, nie aus der Datei.

**Was der Stack an Umgebung setzt** (`deploy/docker-compose.yaml`, Dienst `renovate-ce`): `MEND_RNV_ACCEPT_TOS=y`,
`MEND_RNV_PLATFORM=github`, `MEND_RNV_AUTODISCOVER_FILTER=Hiwamashi/*,Krinke-IT-Consulting/*`,
`MEND_RNV_DATA_HANDLER_TYPE=postgresql`, `MEND_RNV_API_ENABLED=true`, `MEND_RNV_API_ENABLE_JOBS=true`,
`MEND_RNV_API_ENABLE_SYSTEM=true`, `MEND_RNV_API_ENABLE_REPORTING=true` (Repo-Status für das Dashboard, z. B.
`GET /api/v1/orgs/{org}/-/repos`) sowie `PGHOST=postgres`, `PGPORT=5432`, `PGDATABASE=renovate_ce`, `PGUSER=renovate_ce` und
`PGPASSWORD` aus `RENOVATE_CE_DB_PASSWORD`.

## 5. Schritte von Hand

Reihenfolge wie in `tasks.md`, Gruppe 5. Jeder Schritt ist Handarbeit des Betreibers. Ein Agent bereitet
vor, führt aber kein Deploy ohne Freigabe aus (Spec `platform-deployment`, „Kein Deploy ohne Freigabe").

1. **DNS.** Zwei A-Records setzen, beide auf `2.28.133.29`: `renovate.krinke-it.cloud` und
   `renovate-auth.krinke-it.cloud`. Prüfen mit `dig +short renovate.krinke-it.cloud` und
   `dig +short renovate-auth.krinke-it.cloud`. Beide müssen die IP liefern.
2. **Repo pushen.** Coolify baut die Images aus GitHub. Der Stand, den Coolify baut, ist der Stand auf
   dem Remote-Branch.
3. **Coolify-Ressource anlegen.**
   - Typ: Docker Compose, neues Projekt „Renovate", Server `gentle-goose`.
   - Repo `Krinke-IT-Consulting/renovate`, Base Directory `/deploy`, Compose-Datei `/docker-compose.yaml`.
   - **Keine Domains** in Coolify setzen. Alle Router stehen als Labels in `deploy/docker-compose.yaml`.
   - Variablen aus `.env.production` übertragen (Namen aus `.env.example`). `AUTHELIA_INTERNAL_URL` ist
     keine Coolify-Variable, sie steht fest in der Compose-Datei. Leere optionale Werte weglassen,
     also `SCW_REGISTRY_SECRET_KEY`, wenn er leer ist.
   - `MEND_RNV_GITHUB_APP_KEY` ist ein PEM-Schlüssel und wird als mehrzeiliger Wert eingetragen.
   - Namen per `list_env_keys` abgleichen, nie Werte ausgeben.
4. **Deploy nur nach ausdrücklicher Freigabe.**
5. **Prüfungen nach dem Deploy** (Task 5.3):
   - `postgres`, `renovate-authelia` und `renovate-dashboard` sind gesund. `renovate-ce` wird erst nach
     Schritt 7 gesund, weil App-ID und Key fehlen, bis die GitHub App existiert.
   - Für `renovate.krinke-it.cloud` gibt es nur die eigenen Router `renovate-webhook` und
     `renovate-dashboard` (plus http-Pendants), keinen von Coolify erzeugten; der Dashboard-Router trägt
     die Middleware.
   - `curl -i https://renovate.krinke-it.cloud/webhook/api/jobs` ohne Sitzung endet am Login.
   - `curl -sI https://renovate.krinke-it.cloud/` ohne Sitzung leitet auf `renovate-auth.krinke-it.cloud` um.
   - `https://renovate.krinke-it.cloud/api/` erreicht CE nicht. Die Anfrage endet am Login.
   - Port 5432 ist von außen geschlossen.
   - Die Labels der Router sind dokumentiert (Abschnitt 8).
   - Greift die Forward-Auth nicht, sofort stoppen (mit Freigabe) und auf den Raw-Modus umstellen.
6. **Authelia-Nutzer anlegen** (Task 5.4). Per SSH auf dem Server:

   ```
   AUTHELIA_CONTAINER=<name> deploy/scripts/setup-authelia-user.sh
   ```

   - `AUTHELIA_CONTAINER` ist Pflicht, weil auf `gentle-goose` zwei Authelia-Container laufen (der von
     vaultsync ist der andere). Das Skript bricht ab, wenn nicht genau ein Container gefunden wird. Ohne
     den Wert wird nichts geschrieben.
   - Das Skript braucht ein echtes Terminal. Benutzername und E-Mail fragt es ab, wenn sie nicht als
     `AUTHELIA_USERNAME` und `AUTHELIA_EMAIL` gesetzt sind.
   - Das Passwort tippt der Betreiber direkt in den Prompt von `authelia crypto hash generate argon2`
     (Wegwerf-Container, `docker run --rm -it`). Das Skript übernimmt nur die `Digest:`-Zeile und schreibt
     `/data/users_database.yml` in den Container.
   - Mindestlänge **zwölf Zeichen** ist eine Vorgabe der Anleitung. Das Skript prüft sie nicht, und Authelia
     prüft sie beim Hashen ebenfalls nicht.
   - Danach `https://renovate.krinke-it.cloud` im Browser öffnen und anmelden. Authelia verlangt die
     TOTP-Einrichtung und schreibt den Einmalcode in eine Datei im Container. Den Code lesen mit:

     ```
     docker exec <container> cat /data/notification.txt
     ```

     Code eingeben, QR-Code mit der Authenticator-App scannen, bestätigen.
7. **GitHub App anlegen** (Abschnitt 6). App-ID und PEM-Key in `.env.production` und in Coolify eintragen,
   danach Redeploy nach Freigabe.

## 6. GitHub App „Krinke IT Renovate"

| Feld | Wert |
|---|---|
| Webhook-URL | `https://renovate.krinke-it.cloud/webhook` |
| Webhook-Secret | gleicher Wert wie `MEND_RNV_WEBHOOK_SECRET` (nie im Klartext in Doku oder Chat) |
| Installation | in `Hiwamashi` und `Krinke-IT-Consulting`, zunächst nur für ein Test-Repo |
| App-ID und PEM-Key | in `.env.production` und in Coolify als `MEND_RNV_GITHUB_APP_ID` und `MEND_RNV_GITHUB_APP_KEY` |

**Repository-Rechte:**

| Recht | Stufe |
|---|---|
| Administration | read |
| Checks | read and write |
| Commit statuses | read and write |
| Contents | read and write |
| Dependabot alerts | read (optional, für Sicherheitsupdates empfohlen) |
| Issues | read and write |
| Metadata | read |
| Pull requests | read and write |
| Workflows | read and write |

**Organisations-Rechte:** Members, read.

**Events:** Security Advisory, Check run, Check suite, Issues, Pull request, Push, Repository, Status.

Quelle: `docs/setup-for-github.md` von `mend/renovate-ce-ee` in Version 15.7.0 (Task 1.3). Gegenüber
dem PRD kommen die Events Check suite, Repository und Security Advisory hinzu; Checks ist Lesen und
Schreiben statt nur Lesen.

Wichtig: CE bleibt ohne App-ID und Key ungesund. Erst nach dem Eintragen und Redeploy ist der Dienst
gesund. Der Webhook-Test (Task 5.5) prüft: Die Zustellung „ping" zeigt in GitHub Status 2xx. Eine Anfrage
ohne gültige Signatur wird abgewiesen.

## 7. Werte rotieren

Die selbst erzeugten Werte stehen mit Name, Herkunft, Zweck, Ablage und Folgen eines Wechsels in
`feature-documentation/secrets-register.md`. Dort steht auch das Muster zum Neuerzeugen. Die Werte von Menschen (Lizenzschlüssel, App-ID, PEM-Key, optional
Scaleway-Schlüssel) stehen nicht im Register.

Die Besonderheiten, die im Register nur knapp stehen:

- **Webhook-Secret:** Wert in `.env.production` und in Coolify ändern, Redeploy von `renovate-ce`, **und**
  im Feld „Webhook secret" der GitHub App denselben Wert setzen. Sonst lehnt CE alle Webhooks ab.
- **Datenbank-Passwörter** (`POSTGRES_PASSWORD`, `RENOVATE_CE_DB_PASSWORD`, `DASHBOARD_DB_PASSWORD`): Das
  Init-Skript legt die Rollen nur bei leerem Volume an. Ein Wechsel im Betrieb geht deshalb per
  `ALTER ROLE <rolle> PASSWORD ...` in der Datenbank. Danach die Variable in Coolify anpassen und
  `renovate-ce` neu starten. Das Passwort nie in eine Kommandozeile schreiben, die im Verlauf landet.
- **`AUTHELIA_STORAGE_ENCRYPTION_KEY`:** Ein Wechsel macht die gespeicherten TOTP-Geräte unlesbar. Das
  Volume `authelia-data` muss dann geleert werden (oder die Datenbank neu angelegt). Danach das
  Nutzerskript erneut ausführen und TOTP neu registrieren.
- **`AUTHELIA_SESSION_SECRET`:** Neu erzeugen und Redeploy. Alle Sitzungen enden, Neuanmeldung nötig.
- **`MEND_RNV_API_SERVER_SECRET`:** Wird von `renovate-ce` und `renovate-dashboard` genutzt. Wert in Coolify
  ändern und beide gemeinsam neu deployen (ein Redeploy des Stacks), sonst weist CE das Dashboard ab.
- **`MEND_RNV_GITHUB_APP_ID` und `MEND_RNV_GITHUB_APP_KEY`:** Ebenfalls von CE und Dashboard genutzt; Wechsel
  mit gemeinsamem Redeploy.
- **`AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET`:** Neu erzeugen und Redeploy. Keine weiteren
  Folgen, weil der Passwort-Reset deaktiviert ist.

## 8. Erkenntnisse aus dem ersten Deploy

Deploy der Sitzungsprüfung am 2026-10-15 (Coolify-Variable `DASHBOARD_PROXY_SECRET` vorher gelöscht):

- Alle vier Dienste gesund. Das Dashboard hat seine Migration angewendet und den Tenant angelegt.
- Direkter Aufruf aus dem Projektnetz ohne Sitzung: 403. Mit `Remote-User: admin` und gefälschtem Cookie:
  403. `GET /api/health`: 200 `{"status":"ok"}`.
- `/webhook` ohne Signatur: 401. Startseite ohne Login: 302 zu `renovate-auth.krinke-it.cloud`.
- Reporting-API von CE antwortet (`/api/v1/orgs`): beide Owner, 27 Repos.

Deploy des Dashboards am 2026-10-15 (Coolify 4.4.6):

- **Coolify escapt `$` in Labels zu `$$`.** Aus `${DASHBOARD_PROXY_SECRET}` im Label wurde wörtlicher Text;
  Traefik schickte den Platzhalter statt des Werts. Der Proxy-Secret-Ansatz ist deshalb verworfen
  (Entscheidung 4 im Change `dashboard`).
- **Coolify ignoriert `networks: coolify`.** Die Dienste hängen nur im Projektnetz des Stacks, das sie mit
  `coolify-proxy` teilen.

Erstes Deploy am 2026-10-14 (Coolify 4.4.6, Traefik 3.6.25):

- **Pflichtprüfung `${VAR:?}` bricht den Build ab.** Coolify ruft `docker compose build` nur mit
  den Build-Variablen auf (`--env-file /artifacts/build-time.env`). Laufzeit-Secrets fehlen dort.
  Deshalb prüft `renovate-ce/check-env.sh` die Pflichtwerte beim Containerstart.
- **Coolify ergänzt `ARG`-Zeilen** in jedem Dockerfile (für `COOLIFY_*` und alle Build-Variablen).
  Secrets deshalb nie als Build-Variable markieren.
- **Compose-Domain mit Port:** Die Coolify-API verwirft den Port (`:9091`) aus der Domain. Daher
  routet der Stack alle Ziele über eigene Labels; Coolify-Domains sind leer.
- **Die CLI kann den Pfad der Compose-Datei nicht setzen**; Coolify sucht `docker-compose.yaml`
  im Base Directory.
- **Eigene Labels und Netz `coolify` werden unverändert übernommen.** Der Certresolver heißt
  `letsencrypt`, die Entrypoints `http` und `https`. Die Zertifikate kamen innerhalb einer Minute.
- **Prüfungen ohne Sitzung** (alle bestanden):

  | Anfrage | Ergebnis |
  |---|---|
  | `GET /`, `/api/jobs`, `/api/v1/jobs`, `/webhook/`, `/webhook/api/jobs`, `/health` | 302 auf `renovate-auth.krinke-it.cloud` |
  | `http://renovate.krinke-it.cloud/` | 301 auf https |
  | `GET /webhook` | 404 von CE (nur POST) |
  | `POST /webhook` ohne bzw. mit falscher Signatur | 401 |
  | `https://renovate-auth.krinke-it.cloud/api/health` | 200 |
  | Ports 5432, 8080, 9091 von außen | geschlossen |

- **Authelia beendet sich beim ersten Start einmal** (legt die Nutzerdatei an) und startet danach
  neu; Coolify zählt das als einen Crash-Neustart.
- **Renovate CE meldet sich als App `krinke-it-renovate[bot]` an**; ohne Installation findet die
  App-Synchronisation 0 Repos.
- **System-API nachträglich eingeschaltet** (`MEND_RNV_API_ENABLE_SYSTEM=true`): ohne sie liefern
  `POST /system/v1/sync` und `/system/v1/jobs/add` 404. Aufruf nur im Container, z. B.
  `docker exec <renovate-ce> sh -c 'curl -X POST -H "Authorization: Bearer $MEND_RNV_API_SERVER_SECRET" http://localhost:8080/system/v1/sync'`
  — das Secret verlässt den Container dabei nicht.
- **Erste Installation** (nur `Krinke-IT-Consulting/renovate`): Webhooks `installation.created` und
  `issues.opened` kamen an; Renovate legte Issue #1 „Dependency Dashboard“ an (Postgres v18 wartet
  auf Freigabe, Minor-Gruppe wartet auf den Zeitplan).
- **Postgres-Major im eigenen Stack gesperrt** (Regel in `renovate.json`): Der Sprung braucht Dump
  und Wiederherstellung und wird bewusst als eigener Change gemacht.
- **Neustart-Test (Task 5.6):** Redeploy und Neustart am 2026-10-14; Werkzeug-Cache, TOTP-Datenbank
  und Nutzerdatei blieben erhalten, alle Dienste nach rund einer Minute gesund.
- **Zeitzonen:** GitHub zeigt Zustellungen in Ortszeit, Coolify- und Container-Logs in UTC.

## 9. Bekannte Grenzen

- **Sitzungen im Speicher.** Ein Neustart von Authelia beendet alle Sitzungen. Das TOTP-Gerät bleibt in
  SQLite erhalten. Es gibt keine Hochverfügbarkeit (keine Redis-Anbindung).
- **Kein Backup im MVP.** Backups sind laut PRD ein Nice-to-have und nicht Teil dieses Changes. Die Daten
  lassen sich aus GitHub und CE neu aufbauen. Ausnahme ist die Authelia-Datenbank (SQLite, Volume
  `authelia-data`): Sie enthält die TOTP-Geräte und lässt sich nur per `docker cp` aus dem Container sichern.
  Geht das Volume verloren, muss TOTP neu registriert werden.
- **Init-Skript der Datenbank läuft nur einmal.** Ein Fehler darin erfordert das Löschen des Volumes
  `postgres-data`. Spätere Änderungen an den Rollen sind Handarbeit.
- **Kein Monitoring und keine Benachrichtigungen** (Nicht-Ziel in `design.md`).
- **Rückweg.** Die Coolify-Ressource stoppen (laut `design.md`). Andere Dienste auf dem Server bleiben
  unberührt.
- **Redeploy bei jeder Konfigurationsänderung.** Die Konfiguration steckt im Image. Eine Änderung an
  `config.js` oder `configuration.yml` braucht einen neuen Build.

- **`wget` im Authelia-Image.** Der Healthcheck von `renovate-authelia` nutzt `wget`. Im lokalen Test
  (Task 4.1) meldete der Dienst sich damit als gesund; das Image enthält das Programm also.

- **Container-Erkennung im Nutzerskript.** Ohne `AUTHELIA_CONTAINER` sucht das Skript über das Label
  `com.docker.compose.service=renovate-authelia`. Ob Coolify es setzt, zeigt erst Task 5.4; bis dahin
  `AUTHELIA_CONTAINER=<name>` immer angeben.
