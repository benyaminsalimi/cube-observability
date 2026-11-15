# Exporter image.
#
# Two ways to get @cube_oss/cube-prometheus in:
#   * default            — copy the package from this repository (used by the monorepo's own e2e)
#   * EXPORTER_PACKAGE=… — install the published tarball from the registry, which is exactly
#                          what a consumer gets. Use this to verify a release.
#
#   docker build -f images/exporter/Dockerfile --build-arg CUBE_VERSION=v1.8.25 -t cube-exporter:v1.8.25 .
#   docker build -f images/exporter/Dockerfile --build-arg CUBE_VERSION=v1.8.25 \
#     --build-arg EXPORTER_PACKAGE=@cube_oss/cube-prometheus@0.1.0 -t cube-exporter:v1.8.25 .

ARG CUBE_VERSION=v1.8.25
FROM cubejs/cube:${CUBE_VERSION}

ARG CUBE_VERSION
ARG EXPORTER_PACKAGE=""
LABEL org.opencontainers.image.title="cube-exporter" \
      org.opencontainers.image.description="Cube (OSS) with Prometheus metrics and NDJSON logs" \
      org.opencontainers.image.base.name="docker.io/cubejs/cube:${CUBE_VERSION}"

WORKDIR /cube/conf

COPY packages/cube-prometheus/package.json /tmp/exporter/package.json
COPY packages/cube-prometheus/src /tmp/exporter/src

RUN set -eux; \
    if [ -n "${EXPORTER_PACKAGE}" ]; then \
      npm install --omit=dev --no-audit --no-fund "${EXPORTER_PACKAGE}"; \
    else \
      mkdir -p node_modules/@cube_oss/cube-prometheus; \
      cp -R /tmp/exporter/. node_modules/@cube_oss/cube-prometheus/; \
      cd node_modules/@cube_oss/cube-prometheus; \
      npm install --omit=dev --no-audit --no-fund; \
    fi; \
    npm cache clean --force; \
    node -e "require('@cube_oss/cube-prometheus'); console.log('exporter loadable')"

# Default configuration. Mount your own /cube/conf/cube.js to override it.
COPY images/exporter/cube.js /cube/conf/cube.js

EXPOSE 9464
