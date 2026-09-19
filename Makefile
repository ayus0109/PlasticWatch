# PlasticWatch — targets are frozen in CLAUDE.md §6.
# On Windows without GNU make, run the docker compose command shown in each recipe
# directly; README.md lists the equivalent for every target.

.PHONY: up down schema seed reset-demo test lint logs psql

# PRIMARY dev entrypoint: postgres+postgis + api
up:
	docker compose up -d --build

down:
	docker compose down

# Apply backend/app/sql/schema.sql (also runs automatically on API startup).
schema:
	docker compose exec -T db psql -U $${POSTGRES_USER:-plasticwatch} -d $${POSTGRES_DB:-plasticwatch} \
		< backend/app/sql/schema.sql

# NOTE: seed/seed_demo.py lands in Stage 10 — these fail until then.
seed:
	docker compose exec api python seed/seed_demo.py

reset-demo:
	docker compose exec api python seed/seed_demo.py --reset

test:
	docker compose exec api pytest -q

lint:
	docker compose exec api ruff check .

logs:
	docker compose logs -f api

psql:
	docker compose exec db psql -U $${POSTGRES_USER:-plasticwatch} -d $${POSTGRES_DB:-plasticwatch}
