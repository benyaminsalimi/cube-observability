#!/usr/bin/env bash
#
# Renders the chart and asserts the objects it must (and must not) produce.
# Uses .tools/helm when available; skips with a clear message otherwise.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELM="${HELM:-$ROOT/.tools/helm}"
CHART="$ROOT/charts/cube-observability"

if [ ! -x "$HELM" ]; then
  echo "  skip chart rendering (run: make tools)"
  exit 0
fi

pass=0
fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n         %s\n' "$1" "${2:-}"; }

# Count occurrences without a short-circuiting `grep -q`: under `pipefail`, grep exiting at
# the first match sends SIGPIPE to the producer and the pipeline reports failure.
count() { printf '%s' "$1" | grep -c -- "$2" || true; }

"$HELM" lint "$CHART" >/tmp/cube-helm-lint.log 2>&1 \
  && ok "helm lint" \
  || bad "helm lint" "$(tail -5 /tmp/cube-helm-lint.log)"

DEFAULT="$("$HELM" template cube-observability "$CHART" --namespace cube 2>/tmp/cube-helm-template.log)"
if [ $? -ne 0 ]; then
  bad "helm template" "$(tail -5 /tmp/cube-helm-template.log)"
  printf '\n%d passed, %d failed\n' "$pass" "$fail"
  exit 1
fi

for object in "kind: PodMonitor" "kind: PrometheusRule" "kind: ConfigMap"; do
  if [ "$(count "$DEFAULT" "$object")" -gt 0 ]; then ok "renders $object"; else bad "renders $object"; fi
done

if [ "$(count "$DEFAULT" 'kind: PodMonitor')" -eq 2 ]; then
  ok "renders one PodMonitor per Cube component (api + worker)"
else
  bad "renders one PodMonitor per Cube component (api + worker)"
fi

if [ "$(count "$DEFAULT" 'targetPort: 9464')" -gt 0 ]; then
  ok "scrapes by targetPort, so no chart fork is required"
else
  bad "scrapes by targetPort, so no chart fork is required"
fi

if [ "$(count "$DEFAULT" 'kind: ServiceMonitor')" -eq 0 ]; then
  ok "ServiceMonitor is off by default"
else
  bad "ServiceMonitor is off by default"
fi

if [ "$(count "$DEFAULT" '__NAMESPACE__')" -eq 0 ]; then
  ok "rule namespace placeholders are substituted"
else
  bad "rule namespace placeholders are substituted"
fi

if [ "$(count "$DEFAULT" 'grafana_dashboard: "1"')" -eq 4 ]; then
  ok "renders four dashboard ConfigMaps for the Grafana sidecar"
else
  bad "renders four dashboard ConfigMaps for the Grafana sidecar"
fi

DISABLED="$("$HELM" template cube-observability "$CHART" --namespace cube \
  --set scrape.api.podMonitor.enabled=false \
  --set scrape.worker.podMonitor.enabled=false \
  --set alerts.enabled=false \
  --set dashboards.enabled=false)"

if [ "$(count "$DISABLED" 'kind: PodMonitor')" -eq 0 ] \
  && [ "$(count "$DISABLED" 'kind: PrometheusRule')" -eq 0 ] \
  && [ "$(count "$DISABLED" 'kind: ConfigMap')" -eq 0 ]; then
  ok "everything can be switched off"
else
  bad "everything can be switched off"
fi

if [ "$(count "$DISABLED" 'monitoring.coreos.com')" -eq 0 ]; then
  ok "a cluster without CRDs can install with the CRD objects disabled"
else
  bad "a cluster without CRDs can install with the CRD objects disabled"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
