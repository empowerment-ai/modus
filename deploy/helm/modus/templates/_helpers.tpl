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
Refuse values the server can't honour today. Storage is in memory in one
process, so more than one pod would split the state.
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
{{- if eq .Values.database.dialect "memory" -}}
{{- if gt (len $enabled) 1 -}}
{{- fail "database.dialect=memory keeps all state in one process: enable exactly one deployment. Splitting roles needs a SQL store (planned)." -}}
{{- end -}}
{{- range $name, $d := .Values.deployments -}}
{{- if and $d.enabled (gt (int $d.replicas) 1) -}}
{{- fail (printf "deployments.%s.replicas must be 1 while database.dialect=memory (state lives in one process)." $name) -}}
{{- end -}}
{{- end -}}
{{- if .Values.autoscaling.enabled -}}
{{- fail "autoscaling needs a SQL store (planned); keep autoscaling.enabled=false while database.dialect=memory." -}}
{{- end -}}
{{- else if not .Values.database.existingSecret -}}
{{- fail (printf "database.existingSecret (a Secret holding %s) is required for database.dialect=%s." .Values.database.urlKey .Values.database.dialect) -}}
{{- end -}}
{{- end -}}
