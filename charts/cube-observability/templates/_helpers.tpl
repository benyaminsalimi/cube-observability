{{/*
Helpers shared by the scrape objects and rules.
*/}}

{{- define "cube-observability.namespace" -}}
{{- default .Release.Namespace .Values.cube.namespace -}}
{{- end -}}

{{- define "cube-observability.name" -}}
{{- printf "%s-cube-observability" .Release.Name -}}
{{- end -}}

{{- define "cube-observability.labels" -}}
app.kubernetes.io/name: cube-observability
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/*
matchLabels for a Cube component: the user-supplied selector labels plus the component
label. Kept in one helper so API and worker monitors cannot drift apart.
*/}}
{{- define "cube-observability.matchLabels" -}}
{{- $ctx := index . 0 -}}
{{- $component := index . 1 -}}
{{- range $key, $value := $ctx.Values.cube.selectorLabels }}
{{ $key }}: {{ $value | quote }}
{{- end }}
{{ $ctx.Values.cube.componentLabelKey }}: {{ $component | quote }}
{{- end -}}
