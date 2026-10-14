# Design

## Context

Siehe proposal.md (Why). Ausgangslage und Randbedingungen:

- **Repo-Stand:**
  - Im Repo liegen `renovate-ce/config.js` und `.env.example` mit `MEND_RNV_LICENSE_KEY` und
    `SCW_REGISTRY_SECRET_KEY`.
  - Der Lizenzschlüssel steht bereits in `.env.production`. Dort sind auch weitere Werte zu
    erwarten, deshalb wird die Datei nie gelesen, nur ergänzt.
- **Ziel in Coolify:** Coolify 4.4.6, Server `gentle-goose` (2.28.133.29). Dort läuft bereits
  vaultsync als einzelne Ressourcen mit eigenem Authelia.
- **Erfahrungen aus vaultsync** (`app - remarkable-vaultsync/feature-documentation/betrieb-auf-coolify.md`):
  - Bind-Mounts aus dem Git-Clone landen in Coolify nicht auf dem Host; aus einer Datei wird
    dort ein leeres Verzeichnis.
  - Datei-Mounts lassen sich nur durch Löschen und Neuanlegen ändern.
  - Authelia lehnt `http`-Ziele mit 400 ab.
  - `HEALTHCHECK` braucht `curl` oder `wget` im Image.
  - Ressourcen wurden nacheinander ausgerollt.
- **Renovate CE** liest die globale Konfiguration aus `/usr/src/app/config.js`. Die
  Betriebsparameter kommen als `MEND_RNV_*`-Variablen
  (`mend/renovate-ce-ee`, `docs/configuration-options.md`).

## Goals / Non-Goals

**Goals:**
- Ein Deploy-Knopf für den ganzen Stack; alle Dateien versioniert, keine Datei-Mounts aus dem Repo.
- Webhook öffentlich, alles andere hinter Authelia oder intern.
- Der spätere Wechsel vom Platzhalter zum Dashboard tauscht nur einen Dienst aus.

**Non-Goals:**
- Backups, Monitoring, Benachrichtigungen
- eine zweite CE-Instanz für GitLab
- Hochverfügbarkeit (Authelia ohne Redis, Sitzungen im Speicher)

## Decisions

### 1. Konfiguration ins Image backen statt mounten (Antwort 1a)
- **`renovate-ce/Dockerfile`:**
  `FROM ghcr.io/mend/renovate-ce:<version>` plus `COPY config.js /usr/src/app/config.js`
- **`deploy/authelia/Dockerfile`:** `FROM authelia/authelia:<version>` plus
  `COPY configuration.yml /config/configuration.yml`. Die Konfiguration enthält keine Secrets.
- **`deploy/postgres/Dockerfile`:** `FROM postgres:17.<x>` plus
  `COPY init/ /docker-entrypoint-initdb.d/`.
- In `deploy/docker-compose.yaml` verweisen diese Dienste per `build:` auf ihren Kontext. Coolify baut sie
  beim Deploy.
- Renovate erkennt die `FROM`-Zeilen über den Dockerfile-Manager. Dafür sind keine Zusatzregeln
  nötig.
- **Verworfen:**
  - Datei-Mounts wie bei vaultsync: Sie greifen nur beim Anlegen.
  - `content:`-Blöcke in der Compose-Datei: Damit stünde die Konfiguration doppelt im Repo, und
    `config.js` aus dem anderen Change würde nicht genutzt.
  - „Preserve repository during deployment" in Coolify: Damit hinge der laufende Betrieb am
    Git-Clone auf dem Host.

### 2. Nutzerdatei von Authelia einmalig per Skript auf das Volume
- `deploy/scripts/setup-authelia-user.sh` übernimmt das Muster aus vaultsync:
  - Passwort tippt der Betreiber direkt in die Eingabeaufforderung von
    `docker run --rm -it … authelia crypto hash generate argon2`; das Skript übernimmt nur die
    `Digest:`-Zeile. Das Passwort steht nie in einer Kommandozeile oder Variable.
  - Die Mindestlänge von zwölf Zeichen kann weder das Skript noch Authelia beim Hashen prüfen;
    sie ist Vorgabe in der Anleitung.
  - schreibt `users_database.yml` per `docker exec`/`docker cp` in das Volume `/data` des
    laufenden Authelia-Containers
- Die Konfiguration zeigt mit `file.path: /data/users_database.yml` und `watch: true` auf diese
  Datei.
- Das Skript läuft per SSH auf dem Server. Es wird vom Betreiber ausgeführt, nicht vom Agenten.
- **Verworfen:** die Nutzerdatei im Image. Der Hash stünde dann im öffentlichen Repo.

### 3. Routing ausschließlich über eigene Labels, keine Coolify-Domains
- **Domains in Coolify:**
  - `renovate-ce` erhält **keine** Coolify-Domain. Eine Domain mit Pfad würde Coolify mit
    „Strip Prefixes" versehen: Der Webhook käme als `/` an, und `/webhook/api/...` erreichte die
    Job-API an Authelia vorbei. Stattdessen eigener Router `renovate-webhook` mit der exakten Regel
    `Host(renovate.krinke-it.cloud) && Path(/webhook)` und Priorität 100.
  - `renovate-placeholder` erhält **keine** Coolify-Domain. Er wird nur über eigene Labels geroutet
    (Router `renovate-dashboard` mit Middleware `renovate-authelia@docker`). Eine Coolify-Domain
    würde einen zweiten Router ohne Middleware für denselben Host erzeugen.
  - `renovate-authelia` erhält ebenfalls **keine** Coolify-Domain: Die Coolify-API verwirft den Port
    aus `https://renovate-auth.krinke-it.cloud:9091` (beim Anlegen beobachtet). Eigene Router
    `renovate-auth` (https, Port 9091) und `renovate-auth-http` (Weiterleitung).
- **Vorrang:** Der Webhook-Router hat Priorität 100, die Router des Platzhalters Priorität 1.
  Nur der exakte Pfad `/webhook` geht ohne Login an CE; `/webhook/...` und alles andere landen am
  geschützten Platzhalter.
- **Forward-Auth:**
  - Die Middleware wird als Label am Dienst `renovate-authelia` definiert:
    - `forwardauth.address=http://renovate-authelia:9091/api/authz/forward-auth`
    - `trustForwardHeader=true`
    - `authResponseHeaders=Remote-User,Remote-Groups,Remote-Email,Remote-Name`
  - Am `renovate-placeholder` wird sie per Label an den Router gehängt.
  - Die Adresse ist intern. Dafür muss Traefik das Stack-Netz erreichen, was Coolify für Dienste
    mit Domain herstellt.
  - Ersatzweise dient die öffentliche URL `https://renovate-auth.krinke-it.cloud/...`.
- **Unsicherheit:** Wie Coolify 4.4 eigene Router-Labels mit den generierten zusammenführt, ist
  nicht dokumentiert, und vaultsync hat die Label-Texte nicht im Repo. Task 5.3 klärt das am
  laufenden Stack, also welcher Router-Name greift und ob Labels doppelt erscheinen.
- **Rückfallebene:** der Compose-Modus „Raw (deploy file as-is)" mit vollständig eigenen
  Traefik-Labels (Router, TLS, Middleware) für alle drei öffentlichen Ziele.
- `renovate-ce`, `renovate-authelia` und `renovate-placeholder` hängen zusätzlich im externen Proxy-Netz `coolify`
  (`traefik.docker.network=coolify`), weil unklar ist, ob Coolify Dienste ohne Domain mit dem
  Proxy verbindet. Die Dienstnamen tragen das Präfix `renovate-`, weil Compose sie als Alias in
  dieses geteilte Netz einträgt und vaultsync dort eine eigene Authelia betreibt.
- Der Platzhalter hat eigene Router für `https` (mit Middleware) und `http` (Weiterleitung auf
  https), beide mit Priorität 1; der Webhook-Router (Priorität 100) gewinnt damit immer.
- `renovate-authelia` trägt `traefik.enable=true` explizit; ohne die Middleware verwirft Traefik den
  Router des Platzhalters (fail-closed, 404).
- Pflicht-Secrets prüft der Containerstart, nicht die Compose-Datei: Coolify führt `compose build`
  nur mit Build-Variablen aus, `${VAR:?}` brach deshalb schon den Build ab (erstes Deploy am
  2026-10-14). Die Secrets für den Build freizugeben hieße, sie als Build-Argumente in die Images
  zu reichen. Stattdessen:
  - `renovate-ce`: eigener Entrypoint `renovate-ce/check-env.sh` prüft die Pflichtwerte nach Namen
    und startet dann den Original-Entrypoint; sonst nutzte CE für ein fehlendes Webhook-Secret
    still den öffentlichen Standardwert `renovate`.
  - Postgres: Init-Skript mit `${VAR:?}`, das offizielle Image verweigert ein leeres
    `POSTGRES_PASSWORD`.
  - Authelia startet ohne seine Secrets nicht.
- Coolify: Base Directory `/deploy`, Compose-Datei `/docker-compose.yaml`; die Build-Kontexte sind relativ
  zu `deploy/` und stimmen damit unabhängig davon, wie Coolify das Projektverzeichnis setzt.
- Kein Dienst veröffentlicht `ports:`.

### 4. Authelia-Konfiguration
- Image-Tag wie vaultsync: `authelia/authelia:4.39.28`, oder neuer, falls inzwischen verfügbar.
- **Verbindungen:**
  - `server.address: tcp://0.0.0.0:9091`
  - Endpunkt `forward-auth` (ForwardAuth)
  - `session.cookies[0]`: `domain: krinke-it.cloud`,
    `authelia_url: https://renovate-auth.krinke-it.cloud`,
    `default_redirection_url: https://renovate.krinke-it.cloud`
- **Zugriffsregeln:** `default_policy: deny` und eine Regel
  `domain: renovate.krinke-it.cloud`, `policy: two_factor`.
- **Speicher und Mails:**
  - `storage.local.path: /data/db.sqlite3`
  - `notifier.filesystem.filename: /data/notification.txt` (Antwort 4a)
- **Einschränkungen:**
  - `password_reset.disable: true`
  - TOTP mit Issuer `Krinke-IT - Update Zentrale`
- **Sitzung:** `expiration 12h`, `inactivity 1h`
- **Secrets** kommen nur über Env-Variablen der Ressource:
  - `AUTHELIA_SESSION_SECRET`
  - `AUTHELIA_STORAGE_ENCRYPTION_KEY`
  - `AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET`
- Die Schlüssel fehlen in der Datei. Fehlt die Variable, startet Authelia nicht und läuft so
  nicht mit einem öffentlichen Standardwert.
- Die Cookie-Domain `krinke-it.cloud` deckt beide Hostnamen ab. Sie gilt nur für diese
  Authelia-Instanz. vaultsync nutzt eine andere Domain und einen eigenen Cookie.

- Platzhalter: `traefik/whoami` hat weder Shell noch `curl`/`wget`. `deploy/placeholder/Dockerfile`
  kopiert das Binary in `busybox` (beide gepinnt), damit ein Healthcheck möglich ist.
- Cookie-Name `renovate_authelia_session`, `remember_me` aus (würde die 12 Stunden aushebeln).
- Das Einrichtungsskript lässt das Passwort direkt in die Eingabeaufforderung von
  `authelia crypto hash generate argon2` tippen und übernimmt nur den Hash; das Passwort steht nie
  in einer Kommandozeile. Auf `gentle-goose` laufen zwei Authelia-Container, daher ist
  `AUTHELIA_CONTAINER=<name>` Pflicht.

### 5. Postgres mit zwei Rollen per Init-Skript
- `01-databases.sh` liest `RENOVATE_CE_DB_PASSWORD` und `DASHBOARD_DB_PASSWORD`. Es legt an:
  - die Rollen `renovate_ce` und `dashboard`, jeweils mit `LOGIN`
  - die Datenbanken `renovate_ce` und `dashboard`, jeweils mit `OWNER` auf die gleichnamige
    Rolle
- Für die Datenbanken gilt `REVOKE CONNECT … FROM PUBLIC`. So kann sich keine Rolle mit der
  fremden Datenbank verbinden.
- Superuser-Passwort: `POSTGRES_PASSWORD`, nur für Wartung.
- Das Skript läuft nur bei leerem Volume, das ist Postgres-Standard. Spätere Änderungen an den
  Rollen sind Handarbeit und werden dokumentiert.
- Healthcheck: `pg_isready -h 127.0.0.1` (über TCP erst nach Abschluss der Init-Skripte grün; über
  den Socket wäre er schon während der Init grün).

### 6. Variablen von Renovate CE

| Variable | Wert / Herkunft |
|---|---|
| `MEND_RNV_ACCEPT_TOS` | `y` (fest in der Compose-Datei) |
| `MEND_RNV_LICENSE_KEY` | Mensch |
| `MEND_RNV_PLATFORM` | `github` (fest) |
| `MEND_RNV_GITHUB_APP_ID`, `MEND_RNV_GITHUB_APP_KEY` | Mensch (GitHub App) |
| `MEND_RNV_WEBHOOK_SECRET` | selbst erzeugt, identisch in der GitHub App eingetragen |
| `MEND_RNV_API_SERVER_SECRET` | selbst erzeugt; Name gegen die gepinnte CE-Version prüfen (Doku nennt auch `MEND_RNV_SERVER_API_SECRET`) |
| `MEND_RNV_AUTODISCOVER_FILTER` | `Hiwamashi/*,Krinke-IT-Consulting/*` (fest) |
| `MEND_RNV_DATA_HANDLER_TYPE` | `postgresql` (fest) |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | `postgres`, `5432`, `renovate_ce`, `renovate_ce` (fest) |
| `PGPASSWORD` | `${RENOVATE_CE_DB_PASSWORD}` |
| `SCW_REGISTRY_SECRET_KEY` | optional, leer (Namespace öffentlich) |

- Den Cache-Pfad von CE bestimmt die Doku der gepinnten Version, voraussichtlich
  `/tmp/renovate`. Er bekommt das Volume `renovate-cache`.
- Zusätzlich gesetzt: `MEND_RNV_API_ENABLED=true`, `MEND_RNV_API_ENABLE_JOBS=true` (ohne sie hätte
  das API-Secret keinen Zweck) und `MEND_RNV_SERVER_PORT=8080` (das Image meldet Port 3000, die
  Doku 8080; explizit gesetzt). Health-Endpunkt `/health`, `curl` ist im Image.
- Cache: Volume `renovate-cache` auf `/tmp/renovate`; `containerbaseDir` in `config.js` legt den
  Download-Cache der Werkzeuge dorthin, damit er Redeploys überdauert.
- Abhängigkeit: `depends_on` Postgres mit `condition: service_healthy`.
- Speichergrenze 3 GB für `renovate-ce`. Der Server hat 7,7 GB RAM ohne Swap und trägt vaultsync;
  ein speicherhungriges Lockfile-Update soll nur Renovate treffen, nicht die Nachbarn
  (Freigabe des Betreibers nach Task 1.1).
- Healthcheck auf den Health-Endpunkt von CE, sofern das Image `curl` oder `wget` enthält.
  Sonst ein Node-Einzeiler.

### 7. Erzeugen und Ablegen der selbst erzeugten Werte
Diese Werte erzeugt der Agent mit `openssl rand -hex 32`:
- `MEND_RNV_WEBHOOK_SECRET`
- `MEND_RNV_API_SERVER_SECRET`
- `POSTGRES_PASSWORD`
- `RENOVATE_CE_DB_PASSWORD`
- `DASHBOARD_DB_PASSWORD`
- die drei Authelia-Secrets

So wird mit ihnen umgegangen:
- Sie werden per `>>` direkt an `.env.production` angehängt, ohne die Datei zu lesen oder Werte
  auszugeben. Vorher prüft `grep -c '^NAME='`, ob der Name schon vorhanden ist.
- Im selben Schritt kommen sie in das Secrets-Register, nur mit Namen.
- In Coolify überträgt sie der Betreiber oder der Agent per Coolify-API, nur nach Freigabe.
- Leere optionale Werte werden nicht übertragen.

### 8. GitHub App (manuell, Anleitung in der Feature-Doku)
- App „Krinke IT Renovate", Webhook-URL `https://renovate.krinke-it.cloud/webhook`,
  Webhook-Secret wie oben.
- Rechte und Events gemäß CE-Doku. Ausgangspunkt ist die Liste im PRD Abschnitt 4.2.
- Installation in beiden Ownern, zunächst nur für ein Test-Repo.
- App-ID und Private Key (PEM) trägt der Betreiber selbst in `.env.production` und Coolify ein.
  Der PEM-Inhalt wird in Coolify als mehrzeiliger Wert hinterlegt.

## Risks / Trade-offs

- **[Risiko] Label-Zusammenführung in Coolify unklar.** Die Forward-Auth greift dann
  möglicherweise nicht, und `/` wäre ungeschützt erreichbar.
  - Task 5.3 prüft ausdrücklich ohne Sitzung, dass `/` zum Login umleitet. Erst danach wird die
    App installiert.
  - Rückfallebene ist der Raw-Modus.
- **[Risiko] Ressourcen auf `gentle-goose`.** Die RAM-Größe ist unbekannt, und CE braucht beim
  Lockfile-Update 2–4 GB.
  - Task 1.1 liest die Server-Kennzahlen vorher aus. Sind weniger als 4 GB frei, wird pausiert.
- **[Risiko] Init-Skript läuft nur einmal.** Ein Fehler darin erfordert ein Löschen des Volumes.
  - Gegenmaßnahme: Der Test läuft vor dem ersten Deploy lokal mit `docker compose`.
- **[Trade-off] Eigene Images statt Mounts.** Jede Konfigurationsänderung braucht ein Redeploy mit
  Build. Dafür ist der laufende Zustand immer gleich dem Repo.
- **[Trade-off] Sitzungen im Speicher.** Ein Neustart von Authelia erzwingt ein neues Anmelden.
  Das TOTP-Gerät bleibt in SQLite erhalten.

## Migration Plan

1. Lokal mit `docker compose` bauen und starten, mit Platzhalterwerten aus einer
   Scratchpad-Datei, nicht `.env.production`.
2. DNS-Einträge setzen.
3. Coolify-Ressource anlegen und Variablen übertragen.
4. Nach Freigabe deployen.
5. Authelia-Nutzer anlegen und TOTP registrieren.
6. GitHub App anlegen und für ein Test-Repo installieren.
7. Danach Gruppe 5 aus `renovate-konfiguration` abarbeiten.

Rückweg: die Coolify-Ressource stoppen. Andere Dienste auf dem Server bleiben unberührt.

## Open Questions

- Exakter Cache-Pfad und Health-Endpunkt der gepinnten CE-Version (Task 2.1 liest die Doku).
  Das ändert nur Werte in der Compose-Datei.
