# Dashboard "Krinke-IT - Update Zentrale". Build-Kontext: dashboard/ (Coolify: ../dashboard).
# Der Build braucht keine Secrets und keine Datenbank; alle Seiten sind dynamisch.
FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build (standalone) und gebuendelter Migrations-Runner dist/migrate.js
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Nicht-Root-Nutzer "node" (uid 1000) aus dem Basisimage
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/dist/migrate.js ./migrate.js
USER node
EXPOSE 3000
# Zustand laut /api/health: Datenbank erreichbar und Migrationen angewendet. In Compose ueberschreibbar.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Erst migrieren (unter Advisory Lock), dann den Server als PID 1 starten.
CMD ["sh", "-c", "node migrate.js && exec node server.js"]
