{{/* Names */}}
{{- define "modus.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "modus.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "modus.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Labels */}}
{{- define "modus.selectorLabels" -}}
app.kubernetes.io/name: {{ include "modus.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "modus.labels" -}}
helm.sh/chart: {{ include "modus.chart" . }}
{{ include "modus.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: modus
{{- end -}}

{{- define "modus.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "modus.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "modus.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end -}}

{{/* The enabled deployments, by name. */}}
{{- define "modus.enabledDeployments" -}}
{{- range $name, $d := .Values.deployments }}{{ if $d.enabled }}{{ $name }} {{ end }}{{ end -}}
{{- end -}}

{{/*
Refuse values the server can't honour today. One process holds the live state
(in memory, or stored in Postgres but not yet shared), so more than one pod
would split it.
*/}}
{{- define "modus.validate" -}}
{{- $enabled := include "modus.enabledDeployments" . | trim | splitList " " | compact -}}
{{- if eq (len $enabled) 0 -}}
{{- fail "Enable at least one entry in deployments." -}}
{{- end -}}
{{- $serving := false -}}
{{- range $name, $d := .Values.deployments }}{{ if and $d.enabled (has "api" $d.roles) }}{{ $serving = true }}{{ end }}{{ end -}}
{{- if not $serving -}}
{{- fail "At least one enabled deployment needs the api role." -}}
{{- end -}}
{{- /* Every dialect in this build keeps the live state in one process (Postgres stores it, it does not share it yet). */ -}}
{{- $why := ternary "database.dialect=memory keeps all state in one process" "this build holds the live state in one process even on a SQL store (per-item locking is planned)" (eq .Values.database.dialect "memory") -}}
{{- if gt (len $enabled) 1 -}}
{{- fail (printf "%s: enable exactly one deployment." $why) -}}
{{- end -}}
{{- range $name, $d := .Values.deployments -}}
{{- if and $d.enabled (gt (int $d.replicas) 1) -}}
{{- fail (printf "deployments.%s.replicas must be 1: %s." $name $why) -}}
{{- end -}}
{{- end -}}
{{- if .Values.autoscaling.enabled -}}
{{- fail (printf "keep autoscaling.enabled=false: %s." $why) -}}
{{- end -}}
{{- if and (ne .Values.database.dialect "memory") (not .Values.database.existingSecret) -}}
{{- fail (printf "database.existingSecret (a Secret holding %s) is required for database.dialect=%s." .Values.database.urlKey .Values.database.dialect) -}}
{{- end -}}
{{- end -}}
