#!/bin/sh
set -e

# Миграции схемы БД применяются при каждом старте: идемпотентно.
alembic upgrade head

# Начальные данные: справочники, каталог организатора, демо-учётки и демо-проекты.
if [ "${SEED_ON_STARTUP:-true}" = "true" ]; then
  python -m app.seed
fi

exec "$@"
