# Postgres mit Init-Skript fuer die Datenbanken renovate_ce und dashboard (Entscheidung 5).
# Das Skript laeuft nur bei leerem Datenvolume.
FROM postgres:17.11

COPY init/ /docker-entrypoint-initdb.d/
