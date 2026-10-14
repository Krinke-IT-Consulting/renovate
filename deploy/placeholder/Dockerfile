# Platzhalter hinter Authelia, bis das Dashboard ihn ersetzt.
# traefik/whoami hat keine Shell und kein curl/wget; Coolify und Compose-Healthchecks
# brauchen aber eines davon. Daher wird die Binaerdatei in ein busybox-Image kopiert
# (Abweichung von Entscheidung 1: eigenes Dockerfile fuer den Platzhalter).
FROM traefik/whoami:v1.12.0 AS whoami

FROM busybox:1.37.0
COPY --from=whoami /whoami /whoami
EXPOSE 80
ENTRYPOINT ["/whoami"]
