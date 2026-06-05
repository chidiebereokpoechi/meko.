#!/usr/bin/env bash
# Build and (re)start the meko. API production stack.
# Usage: ./deploy-api.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/api"

ENV_FILE="deploy/.env"
COMPOSE_FILE="deploy/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found. Copy and fill it before deploying." >&2
  exit 1
fi

echo "==> Building and starting prod stack"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build

echo "==> Status"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
