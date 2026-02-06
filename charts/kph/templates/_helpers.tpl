{{/*
Expand the name of the chart.
*/}}
{{- define "kph.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this.
*/}}
{{- define "kph.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "kph.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "kph.labels" -}}
helm.sh/chart: {{ include "kph.chart" . }}
{{ include "kph.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "kph.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kph.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "kph.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "kph.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
App image reference
*/}}
{{- define "kph.app.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" -}}
{{- $repository := .Values.app.image.repository -}}
{{- $tag := .Values.app.image.tag | default .Chart.AppVersion -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Database image reference
*/}}
{{- define "kph.database.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" -}}
{{- $repository := .Values.database.embedded.image.repository -}}
{{- $tag := .Values.database.embedded.image.tag -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Database URL
Returns the database connection URL based on configuration.
*/}}
{{- define "kph.databaseUrl" -}}
{{- if .Values.database.external.enabled -}}
{{- if .Values.database.external.url -}}
{{- .Values.database.external.url -}}
{{- else -}}
{{- /* URL will come from secret */ -}}
{{- end -}}
{{- else if .Values.database.embedded.enabled -}}
{{- $host := printf "%s-db" (include "kph.fullname" .) -}}
{{- $port := "5432" -}}
{{- $user := .Values.database.embedded.auth.username -}}
{{- $db := .Values.database.embedded.auth.database -}}
{{- printf "postgresql://%s:$(DATABASE_PASSWORD)@%s:%s/%s?sslmode=disable" $user $host $port $db -}}
{{- end -}}
{{- end }}

{{/*
Database secret name
*/}}
{{- define "kph.databaseSecretName" -}}
{{- if .Values.database.external.enabled -}}
{{- if .Values.database.external.existingSecret -}}
{{- .Values.database.external.existingSecret -}}
{{- else -}}
{{- printf "%s-db-external" (include "kph.fullname" .) -}}
{{- end -}}
{{- else if .Values.database.embedded.enabled -}}
{{- if .Values.database.embedded.auth.existingSecret -}}
{{- .Values.database.embedded.auth.existingSecret -}}
{{- else -}}
{{- printf "%s-db" (include "kph.fullname" .) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Auth secret name
*/}}
{{- define "kph.authSecretName" -}}
{{- if eq .Values.auth.provider "clerk" -}}
{{- if .Values.auth.clerk.existingSecret -}}
{{- .Values.auth.clerk.existingSecret -}}
{{- else -}}
{{- printf "%s-auth" (include "kph.fullname" .) -}}
{{- end -}}
{{- else if eq .Values.auth.provider "oidc" -}}
{{- if .Values.auth.oidc.existingSecret -}}
{{- .Values.auth.oidc.existingSecret -}}
{{- else -}}
{{- printf "%s-auth" (include "kph.fullname" .) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
LLM secret name
*/}}
{{- define "kph.llmSecretName" -}}
{{- if .Values.llm.existingSecret -}}
{{- .Values.llm.existingSecret -}}
{{- else -}}
{{- printf "%s-llm" (include "kph.fullname" .) -}}
{{- end -}}
{{- end }}
