#!/bin/sh
# Entrypoint for the shared image.
#
# Render deploys ONE web service (free tier sleeps independently, so two
# services double the cold-start window). In the default "both" mode the api
# runs on 3001 and the web standalone server on $PORT; the web proxies /api and
# /events to http://localhost:3001 (baked via the API_URL build arg).
#
# docker compose overrides the CMD per service, so it never hits this file.
set -e
WEB_DIR=apps/web/.next/standalone
if [ "$GW_APP" = "web" ]; then
  cd /app/$WEB_DIR
  exec node apps/web/server.js
fi
if [ "$GW_APP" = "api" ]; then
  exec node apps/api/dist/index.js
fi
# Both: api in the background, web as the foreground process so Render's
# process manager and health checks track the right one.
PORT=3001 node apps/api/dist/index.js &
cd /app/$WEB_DIR
exec node apps/web/server.js
