SHELL := /bin/sh
ENV_FILE := .env.production
COMPOSE := docker compose --env-file $(ENV_FILE) -f docker-compose.yml -f compose.osiris.yaml

.PHONY: up down logs ps migrate seed backup restart check-env

check-env:
	@if [ ! -f "$(ENV_FILE)" ]; then echo "Error: $(ENV_FILE) is missing. Copy .env.production.example to .env.production and set the required values." >&2; exit 1; fi
	@for key in ATLAS_ADMIN_PASSWORD BETTER_AUTH_SECRET POSTGRES_PASSWORD DOMAIN; do \
	  value=$$(sed -n "s/^$$key=//p" "$(ENV_FILE)" | tail -n 1); \
	  case "$$value" in \
	    ""|replace_with_*) echo "Error: $$key is unset or still a placeholder in $(ENV_FILE)." >&2; exit 1 ;; \
	  esac; \
	done

up: check-env
	$(COMPOSE) up --build -d

down: check-env
	$(COMPOSE) down

logs: check-env
	$(COMPOSE) logs -f --tail=100

ps: check-env
	$(COMPOSE) ps

migrate: check-env
	$(COMPOSE) run --rm migrate pnpm exec drizzle-kit migrate

seed: check-env
	$(COMPOSE) run --rm migrate pnpm db:seed

backup: check-env
	@mkdir -p backups
	@stamp=$$(date -u +%Y%m%dT%H%M%SZ); \
	  $(COMPOSE) exec -T postgres pg_dump -U atlas -d atlas_portal > "backups/atlas_portal-$$stamp.sql" && \
	  echo "Backup written to backups/atlas_portal-$$stamp.sql"

restart: check-env
	$(COMPOSE) restart app prober alert-engine
