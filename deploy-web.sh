#!/usr/bin/env bash
# Build and (re)start the meko. web (frontend) production container.
# Usage: ./deploy-web.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/web"

ENV_FILE="deploy/.env"
COMPOSE_FILE="deploy/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found. Copy and fill it before deploying." >&2
  exit 1
fi

echo "==> Building and starting web stack"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo "==> Status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
