{{/*
Expand the name of the chart.
*/}}
{{- define "kph-agent.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "kph-agent.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "kph-agent.labels" -}}
helm.sh/chart: {{ include "kph-agent.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Resolve image reference for a component.
Usage: {{ include "kph-agent.image" (dict "component" .Values.operator "global" .Values.global) }}
*/}}
{{- define "kph-agent.image" -}}
{{- $registry := .component.image.registry | default .global.image.registry -}}
{{- $repository := .component.image.repository | default .global.image.repository -}}
{{- $tag := .component.image.tag | default .global.image.tag -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Resolve image pull policy for a component.
Usage: {{ include "kph-agent.imagePullPolicy" (dict "component" .Values.operator "global" .Values.global) }}
*/}}
{{- define "kph-agent.imagePullPolicy" -}}
{{- .component.image.pullPolicy | default .global.image.pullPolicy -}}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "kph-agent.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
