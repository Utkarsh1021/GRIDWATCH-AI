# Shared builder: installs all workspace deps and builds every package + app.
FROM node:20-alpine AS builder
# API_URL bakes the web's proxy target. Inside `docker compose` it is the
# internal service hostname (http://api:3001); on a split host (Render etc.)
# pass the api's public URL instead, e.g. --build-arg API_URL=https://<api>.
ARG API_URL=http://api:3001
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build --filter=!@gridwatch/web
# The Next standalone proxy target is baked at build time. Turbo strips ad-hoc
# env from tasks, so build web directly (no turbo) with API_URL set.
RUN cd apps/web && API_URL=$API_URL pnpm run build
# Stage the Next standalone server and its static assets into a known location.
RUN mkdir -p /app/apps/web/.next/standalone/apps/web/.next \
  && cp -r /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/static \
  && if [ -d /app/apps/web/public ]; then cp -r /app/apps/web/public /app/apps/web/.next/standalone/apps/web/public; fi

# Runtime image used by both the API and the console services (different CMDs).
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
RUN chmod +x /app/entrypoint.sh
EXPOSE 3000 3001
# GW_APP switches between the api (default) and web standalone server so one
# image can serve both Render services.
CMD ["sh", "entrypoint.sh"]