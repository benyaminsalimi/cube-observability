# Exporter image.
#
# The exporter is installed from the npm registry as the published package, at the
# version that mirrors the Cube release in the base image:
#
#   cubejs/cube:v1.8.25  ->  @cube_oss/cube-prometheus@1.8.25
#
# The package is released independently from
# https://github.com/benyaminsalimi/cube-prometheus; this repository does not publish it.
#
#   docker build -f images/exporter/Dockerfile --build-arg CUBE_VERSION=v1.8.25 -t cube-exporter:v1.8.25 .
#
# Overrides, for testing a release candidate or a different package version:
#
#   --build-arg EXPORTER_VERSION=1.8.25-rc.1
#   --build-arg EXPORTER_PACKAGE=@cube_oss/cube-prometheus@1.8.25-rc.1

ARG CUBE_VERSION=v1.8.25
FROM cubejs/cube:${CUBE_VERSION}

ARG CUBE_VERSION
ARG EXPORTER_VERSION=""
ARG EXPORTER_PACKAGE=""
LABEL org.opencontainers.image.title="cube-exporter" \
      org.opencontainers.image.description="Cube (OSS) with Prometheus metrics and NDJSON logs" \
      org.opencontainers.image.base.name="docker.io/cubejs/cube:${CUBE_VERSION}"

WORKDIR /cube/conf

# The npm version mirrors the base image tag, so an upgrade moves both together.
RUN set -eux; \
    version="${EXPORTER_VERSION:-${CUBE_VERSION#v}}"; \
    package="${EXPORTER_PACKAGE:-@cube_oss/cube-prometheus@${version}}"; \
    if [ -z "${package##*@}" ]; then \
      echo "could not derive a package version: set EXPORTER_VERSION or CUBE_VERSION" >&2; \
      exit 1; \
    fi; \
    echo "installing ${package}"; \
    npm install --omit=dev --no-audit --no-fund "${package}"; \
    npm cache clean --force; \
    node -e "require('@cube_oss/cube-prometheus'); console.log('exporter loadable')"

# Default configuration. Mount your own /cube/conf/cube.js to override it.
COPY images/exporter/cube.js /cube/conf/cube.js

EXPOSE 9464
