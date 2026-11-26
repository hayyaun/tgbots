COMPOSE ?= docker compose

run:
	@echo ".> Fetching..."
	git pull
	@echo ".> Building app..."
	$(COMPOSE) build app
	@echo ".> Recreating app..."
	$(COMPOSE) up -d --no-deps --no-build --force-recreate app

clean: stop
	@echo ".> Cleaning..."
	-$(COMPOSE) down

stop:
	@echo ".> Stopping..."
	-$(COMPOSE) stop

logs:
	@echo ".> Listening..."
	$(COMPOSE) logs -f app