#!/bin/sh
set -eu

# Database migrations must complete before API workers start.
alembic upgrade head

exec uvicorn app:app \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
