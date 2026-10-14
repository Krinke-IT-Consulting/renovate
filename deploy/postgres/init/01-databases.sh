#!/usr/bin/env bash
# Legt je Dienst eine Rolle und eine Datenbank an (Change compose-stack, Entscheidung 5).
# Laeuft nur bei leerem Datenvolume. Passwoerter kommen aus der Umgebung und werden ueber
# psql-Variablen (\getenv) eingesetzt, stehen also in keiner Prozessliste und in keinem Log.
set -euo pipefail

: "${RENOVATE_CE_DB_PASSWORD:?RENOVATE_CE_DB_PASSWORD fehlt}"
: "${DASHBOARD_DB_PASSWORD:?DASHBOARD_DB_PASSWORD fehlt}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv ce_pw RENOVATE_CE_DB_PASSWORD
\getenv dash_pw DASHBOARD_DB_PASSWORD

CREATE ROLE renovate_ce LOGIN PASSWORD :'ce_pw';
CREATE ROLE dashboard LOGIN PASSWORD :'dash_pw';

CREATE DATABASE renovate_ce OWNER renovate_ce;
CREATE DATABASE dashboard OWNER dashboard;

-- Ohne dieses REVOKE duerfte jede Rolle ueber PUBLIC auf jede Datenbank verbinden.
REVOKE CONNECT ON DATABASE renovate_ce FROM PUBLIC;
REVOKE CONNECT ON DATABASE dashboard FROM PUBLIC;
SQL
