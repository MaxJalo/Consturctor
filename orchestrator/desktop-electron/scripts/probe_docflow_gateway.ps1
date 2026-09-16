# Quick probe: POST onec.docflow_tasks to gateway (no secrets in output).
# Usage: .\scripts\probe_docflow_gateway.ps1 [-BackendUrl http://192.168.1.157:7812] [-Fio "Фамилия Имя"]
param(
  [string]$BackendUrl = $env:BACKEND_URL,
  [string]$Fio = $env:ONEC_PROBE_FIO,
  [string]$Password = $env:ONEC_PROBE_PASSWORD,
  [string]$Token = $env:ORCH_TOKEN
)
if (-not $BackendUrl) { $BackendUrl = "http://192.168.1.157:7812" }
if (-not $Fio -or -not $Password) {
  Write-Host "Set ONEC_PROBE_FIO and ONEC_PROBE_PASSWORD (and optional ORCH_TOKEN) — passwords are not echoed."
  exit 2
}
$body = @{
  tool = "onec.docflow_tasks"
  arguments = @{
    fio = $Fio
    username = $Fio
    password = $Password
    limit = 5
    only_open = $true
  }
} | ConvertTo-Json -Depth 5
$headers = @{ "Content-Type" = "application/json" }
if ($Token) { $headers["Authorization"] = "Bearer $Token" }
try {
  $resp = Invoke-WebRequest -Uri "$BackendUrl/api/v1/tools/invoke" -Method POST -Headers $headers -Body $body -TimeoutSec 120
  $json = $resp.Content | ConvertFrom-Json
  $count = $json.result.count
  $source = $json.result.source
  $warn = $json.result.docflow_warning
  Write-Host "HTTP $($resp.StatusCode) ok=$($json.ok) count=$count source=$source"
  if ($warn) { Write-Host "docflow_warning: $warn" }
} catch {
  Write-Host "Request failed: $($_.Exception.Message)"
  exit 1
}
