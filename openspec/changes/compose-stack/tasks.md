# Tasks

## 1. Vorbereitung

- [x] 1.1 Kennzahlen des Servers `gentle-goose` lesend über Coolify oder SSH erheben (RAM gesamt
  und frei, Plattenplatz) — mindestens 4 GB RAM und 20 GB Platz frei, sonst pausieren und den
  Betreiber fragen; Ergebnis in der Feature-Doku festhalten
  (Ergebnis 2026-10-13: 4 vCPU, 7,7 GB RAM, davon 6,4 GB verfügbar, kein Swap; 75 GB Platte, 65 GB
  frei — geht in die Feature-Doku aus 6.1)
- [x] 1.2 Aktuelle stabile Versionen von `ghcr.io/mend/renovate-ce`, `authelia/authelia`,
  `postgres:17` und `traefik/whoami` ermitteln — Tags existieren laut Registry
  (`docker manifest inspect` ohne Fehler)
- [x] 1.3 Doku der gepinnten CE-Version auf diese Punkte prüfen und die Annahmen in design.md
  Entscheidung 6 bestätigen oder korrigieren:
  - Name des API-Secrets (`MEND_RNV_API_SERVER_SECRET` oder `MEND_RNV_SERVER_API_SECRET`)
  - Cache-Pfad
  - Health-Endpunkt und Port
  - benötigte Rechte und Events der GitHub App

  Fertig, wenn eine kurze Liste mit Quellen-URL in der Feature-Doku steht

## 2. Images und Konfigurationsdateien

- [x] 2.1 `renovate-ce/Dockerfile` mit gepinntem Basis-Image und `COPY config.js` anlegen —
  `docker build` erfolgreich, `docker run --rm --entrypoint cat <image> /usr/src/app/config.js`
  zeigt die Datei
- [x] 2.2 `deploy/authelia/configuration.yml` laut design.md Entscheidung 4 ohne Secrets und
  `deploy/authelia/Dockerfile` anlegen — `docker build` erfolgreich und
  `authelia validate-config` im Image ohne Fehler (Secrets dabei als Dummy-Env im Kommando)
- [x] 2.3 `deploy/postgres/init/01-databases.sh` und `deploy/postgres/Dockerfile` anlegen —
  `shellcheck` sauber (falls verfügbar, sonst per Docker), `docker build` erfolgreich
- [x] 2.4 `deploy/docker-compose.yaml` anlegen. Inhalt:
  - vier Dienste mit `build:` bzw. gepinntem Image
  - Volumes `postgres-data`, `authelia-data`, `renovate-cache`
  - Healthchecks und `restart: unless-stopped`
  - keine `ports:`
  - Variablen laut Entscheidung 6
  - Forward-Auth-Labels laut Entscheidung 3

  Prüfen mit `docker compose -f deploy/docker-compose.yaml config` mit einer Platzhalter-Env-Datei aus
  dem Scratchpad: ohne Fehler, und `grep -n "ports:"` liefert nichts
- [x] 2.5 `deploy/scripts/setup-authelia-user.sh` nach dem Muster aus vaultsync anlegen:
  - TTY-Pflicht, mindestens zwölf Zeichen
  - Passwort nur per Env-Variable an den Hash-Befehl
  - schreibt `/data/users_database.yml` in den laufenden Container

  Prüfen mit `shellcheck` und einem Lauf gegen den lokalen Stack aus 4.1: Die Datei existiert,
  der Hash beginnt mit `$argon2id$`, das Passwort steht nicht in `ps`

## 3. Konfigurationswerte

- [x] 3.1 In `.env.example` alle Namen aus design.md Entscheidungen 4–6 ergänzen, jeweils mit
  leerem Wert und Herkunftskommentar — jeder `${VAR}`-Verweis in `deploy/docker-compose.yaml` hat einen
  Eintrag (per Skript abgleichen)
- [x] 3.2 Die acht selbst erzeugten Werte laut Entscheidung 7 erzeugen und per `>>` an
  `.env.production` anhängen, ohne die Datei zu lesen und ohne einen Wert auszugeben.
  Vorhandene Namen werden nicht doppelt angelegt. Prüfen: `grep -c '^NAME=' .env.production`
  liefert je Name 1
- [x] 3.3 `feature-documentation/secrets-register.md` anlegen. Für jeden selbst erzeugten Wert:
  Name, Herkunft, Zweck, Ablage im Betrieb (Coolify), Neuerzeugung und Folgen eines Wechsels
  (etwa Webhook-Secret auch in der GitHub App, DB-Passwort per `ALTER ROLE`). Fertig, wenn das
  Register alle acht Namen enthält und keinen Wert

## 4. Lokaler Test (ohne GitHub App)

- [x] 4.1 Postgres, Authelia und den Platzhalter lokal mit `docker compose up` starten, mit
  Dummy-Werten aus dem Scratchpad und ohne Renovate CE. Prüfen:
  - Postgres ist gesund.
  - Die Rolle `dashboard` kann sich nicht mit `renovate_ce` verbinden, die Rolle `renovate_ce`
    schon.
  - Authelia ist gesund.
- [x] 4.2 Renovate CE lokal ohne `MEND_RNV_LICENSE_KEY` starten — der Container beendet sich mit
  einer Meldung, die höchstens den Variablennamen nennt; danach den lokalen Stack samt Volumes
  entfernen

## 5. Einrichtung und Deploy (mit Betreiber; Deploy nur nach ausdrücklicher Freigabe)

- [x] 5.1 Betreiber setzt DNS-A-Einträge für `renovate.krinke-it.cloud` und
  `renovate-auth.krinke-it.cloud` auf 2.28.133.29 — `dig +short` liefert für beide diese IP
- [x] 5.2 Coolify-Ressource vom Typ Docker Compose im neuen Projekt „Renovate" auf
  `gentle-goose` anlegen. Dazu gehören:
  - Repo `Krinke-IT-Consulting/renovate`, Base Directory `/deploy`, Compose-Datei `/docker-compose.yaml`
  - keine Coolify-Domains (Routing nur über Labels, Entscheidung 3)
  - Variablen aus `.env.production`, leere optionale Werte weggelassen

  Erst nach Freigabe; Coolify zeigt alle Namen aus `.env.example` außer den leeren optionalen
  (Namen per `list_env_keys` abgleichen, keine Werte)
- [x] 5.3 Nach Freigabe deployen, dann prüfen:
  - Postgres, Authelia und Platzhalter sind gesund (Renovate CE erst nach 5.5 mit App-ID und Key).
  - Für `renovate.krinke-it.cloud` gibt es nur die eigenen Router `renovate-webhook` und
    `renovate-dashboard` (+ http-Pendants), keinen von Coolify erzeugten; der Dashboard-Router trägt
    die Middleware (Traefik-Dashboard oder `docker inspect` der Labels).
  - `curl -i https://renovate.krinke-it.cloud/webhook/api/jobs` ohne Sitzung endet am Login, nicht
    bei CE.
  - `curl -sI https://renovate.krinke-it.cloud/` ohne Sitzung leitet auf
    `renovate-auth.krinke-it.cloud` um.
  - `/api/` erreicht CE nicht, und `POST /webhook` ohne Signatur wird von CE abgewiesen.
  - Port 5432 ist von außen geschlossen.
  - Die Labels der Router sind dokumentiert.

  Greift die Forward-Auth nicht, sofort stoppen (mit Freigabe) und auf den Raw-Modus umstellen
- [x] 5.4 (2026-10-14: Konto `sascha`, TOTP registriert; Platzhalter zeigt Remote-User/-Name/-Email/-Groups;
  Überschreiben gleichnamiger Header per Traefik-`authResponseHeaders` dokumentiert) Betreiber führt `setup-authelia-user.sh` per SSH aus, meldet sich an und registriert
  TOTP mit dem Code aus `/data/notification.txt`. Prüfen:
  - Der Platzhalter zeigt den Header `Remote-User`.
  - Ein selbst mitgeschickter `Remote-User` wird überschrieben.
- [x] 5.5 (App angelegt und App-ID/Key übertragen am 2026-10-14 vor dem Deploy, weil beide Pflichtwerte sind;
  offen: Installation für das Test-Repo erst nach bestandener Prüfung 5.3) Betreiber legt die GitHub App laut Feature-Doku an, mit Webhook-URL und Webhook-Secret,
  und installiert sie für ein Test-Repo. App-ID und Key trägt er in `.env.production` und
  Coolify ein, danach Redeploy nach Freigabe. Prüfen:
  - Die Webhook-Zustellung „ping" zeigt in GitHub den Status 2xx.
  - Eine erneut zugestellte Anfrage mit falschem Secret, etwa per `curl` ohne Signatur, wird
    abgewiesen.
- [x] 5.6 (2026-10-14: Redeploy 09:35 und Neustart 09:36 UTC, alle Dienste gesund, Cache 1,5 MB,
  db.sqlite3 und users_database.yml unverändert) Neustart-Szenario: Den Stack nach Freigabe in Coolify neu starten. Danach sind alle
  Dienste gesund, das TOTP-Gerät existiert noch, und der Cache von CE ist erhalten (zuvor
  installierte Werkzeugversion noch vorhanden)

## 6. Dokumentation

- [x] 6.1 `feature-documentation/betrieb-coolify.md` schreiben. Inhalt:
  - Aufbau des Stacks und Routing-Tabelle
  - Schritte von Hand: DNS, Coolify, Authelia-Nutzer, GitHub App mit Rechten und Events
  - Werte rotieren
  - Erkenntnisse zu den Coolify-Labels aus 5.3
  - Server-Kennzahlen aus 1.1
- [x] 6.2 `PROGRESS.md` aktualisieren und `openspec validate compose-stack --strict` grün
