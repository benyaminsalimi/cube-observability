# Exporter image.
#
# Two sources, because they answer different questions:
#
#   registry (default) — install the published package at the version that mirrors the base
#                        image tag. This is what a consumer gets:
#                          cubejs/cube:v1.8.26  ->  cube-prometheus@1.8.26
#
#   local              — copy the package from packages/cube-prometheus (the submodule) and
#                        install its dependencies. Used by this repository's e2e so the
#                        suite can run before a version exists on the registry.
#
#   docker build -f images/exporter/Dockerfile --build-arg CUBE_VERSION=v1.8.25 -t cube-exporter:v1.8.25 .
#   docker build -f images/exporter/Dockerfile --build-arg EXPORTER_PACKAGE_SOURCE=local -t cube-exporter:dev .
#
# Overrides for a release candidate:
#   --build-arg EXPORTER_VERSION=1.8.25-rc.1
#   --build-arg EXPORTER_PACKAGE=cube-prometheus@1.8.26-rc.1

ARG CUBE_VERSION=v1.8.25
FROM cubejs/cube:${CUBE_VERSION}

ARG CUBE_VERSION
ARG EXPORTER_VERSION=""
ARG EXPORTER_PACKAGE=""
ARG EXPORTER_PACKAGE_SOURCE=registry

LABEL org.opencontainers.image.title="cube-exporter" \
      org.opencontainers.image.description="Cube (OSS) with Prometheus metrics and NDJSON logs" \
      org.opencontainers.image.base.name="docker.io/cubejs/cube:${CUBE_VERSION}"

WORKDIR /cube/conf

# Present in every build; used only in local mode.
COPY packages/cube-prometheus/package.json /tmp/exporter/package.json
COPY packages/cube-prometheus/src /tmp/exporter/src

RUN set -eux; \
    if [ "${EXPORTER_PACKAGE_SOURCE}" = "local" ]; then \
      mkdir -p node_modules/cube-prometheus; \
      cp -R /tmp/exporter/. node_modules/cube-prometheus/; \
      cd node_modules/cube-prometheus; \
      npm install --omit=dev --no-audit --no-fund; \
    else \
      version="${EXPORTER_VERSION:-${CUBE_VERSION#v}}"; \
      package="${EXPORTER_PACKAGE:-cube-prometheus@${version}}"; \
      if [ -z "${package##*@}" ]; then \
        echo "could not derive a package version: set EXPORTER_VERSION or CUBE_VERSION" >&2; \
        exit 1; \
      fi; \
      echo "installing ${package}"; \
      npm install --omit=dev --no-audit --no-fund "${package}"; \
    fi; \
    npm cache clean --force; \
    node -e "require('cube-prometheus'); console.log('exporter loadable')"

# Default configuration. Mount your own /cube/conf/cube.js to override it.
COPY images/exporter/cube.js /cube/conf/cube.js

EXPOSE 9464
