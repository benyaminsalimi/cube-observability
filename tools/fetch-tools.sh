#!/usr/bin/env bash
#
# Fetches the CLI tools the checks need into .tools/, without touching the system.
# Safe to re-run: existing binaries are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/.tools"
mkdir -p "$BIN"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="amd64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

HELM_VERSION=${HELM_VERSION:-v3.16.3}
PROM_VERSION=${PROM_VERSION:-v3.1.0}

fetch_helm() {
  if [ -x "$BIN/helm" ]; then echo "helm: already present"; return; fi
  local url="https://get.helm.sh/helm-${HELM_VERSION}-${os}-${arch}.tar.gz"
  echo "helm: downloading ${url}"
  curl -fsSL "$url" -o /tmp/helm.tar.gz
  tar -xzf /tmp/helm.tar.gz -C /tmp
  mv "/tmp/${os}-${arch}/helm" "$BIN/helm"
  chmod +x "$BIN/helm"
  "$BIN/helm" version --short
}

fetch_promtool() {
  if [ -x "$BIN/promtool" ]; then echo "promtool: already present"; return; fi
  local url="https://github.com/prometheus/prometheus/releases/download/${PROM_VERSION}/prometheus-${PROM_VERSION#v}.${os}-${arch}.tar.gz"
  echo "promtool: downloading ${url}"
  curl -fsSL "$url" -o /tmp/prometheus.tar.gz
  tar -xzf /tmp/prometheus.tar.gz -C /tmp
  mv "/tmp/prometheus-${PROM_VERSION#v}.${os}-${arch}/promtool" "$BIN/promtool"
  chmod +x "$BIN/promtool"
  "$BIN/promtool" --version | head -1
}

fetch_helm || echo "helm: download failed; chart rendering tests will skip" >&2
fetch_promtool || echo "promtool: download failed; rule parsing tests will skip" >&2
