SHELL := /bin/bash
.DEFAULT_GOAL := help

# The package version IS the Cube version. Do not hardcode one here.
CUBE_VERSION ?= $(shell node tools/cube-version.mjs)
CUBE_REPO ?= ../cube
HELM := $(CURDIR)/.tools/helm
PROMTOOL := $(CURDIR)/.tools/promtool
IMAGE ?= cube-exporter:$(CUBE_VERSION)
# Defaults to the CUBE_VERSION with the leading v stripped (cube v1.8.26 ->
# cube-prometheus@1.8.26). Override to test an unpublished package.
EXPORTER_VERSION ?=
EXPORTER_PACKAGE ?=

.PHONY: help tools gen test test-unit test-gen test-contract test-static test-render test-e2e image e2e grafana clean

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

tools: ## Fetch helm and promtool into .tools/
	@./tools/fetch-tools.sh

gen: ## Regenerate dashboards, alert rules and the metric reference
	@node tools/gen.mjs

test: test-unit test-gen test-contract test-static test-render ## Everything that needs no cluster

test-unit: ## Exporter unit and package tests
	@cd packages/cube-prometheus && npm test

test-gen: ## Fail if generated files are stale
	@node tools/gen.mjs --check

test-contract: ## Verify Cube assumptions against $(CUBE_REPO)
	@node tools/contract-check.mjs --cube $(CUBE_REPO)

test-static: ## Validate dashboards, rule references and (with promtool) rule syntax
	@node tools/validate.mjs $(if $(wildcard $(PROMTOOL)),--promtool $(PROMTOOL),)

test-render: ## Render the chart and assert the scrape objects
	@HELM=$(HELM) ./tools/render-test.sh

image: ## Build the exporter image
	@docker build -f images/exporter/Dockerfile \
	  --build-arg CUBE_VERSION=$(CUBE_VERSION) \
	  --build-arg EXPORTER_VERSION=$(EXPORTER_VERSION) \
	  --build-arg EXPORTER_PACKAGE=$(EXPORTER_PACKAGE) \
	  -t $(IMAGE) .

e2e: ## Full end-to-end test: real Cube, real Postgres, real scrape
	@CUBE_VERSION=$(CUBE_VERSION) ./e2e/run.sh

grafana: ## End-to-end plus Grafana: every dashboard panel queried through Grafana
	@CUBE_VERSION=$(CUBE_VERSION) ./e2e/grafana.sh

clean: ## Remove local build artifacts
	@rm -rf .tools packages/cube-prometheus/node_modules
