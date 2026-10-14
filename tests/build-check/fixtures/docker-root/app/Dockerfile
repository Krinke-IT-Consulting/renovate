# Dockerfile in einem Unterverzeichnis, das die Wurzel des Beispiels als Build-Kontext braucht
# (wie in Monorepos: COPY aus einem Nachbarverzeichnis). Prüft die Kontext-Erkennung des Build-Checks.
FROM busybox:1.37.0
COPY shared/greeting.txt /greeting.txt
COPY --chmod=644 \
  app/Dockerfile /app/Dockerfile
RUN cat /greeting.txt
