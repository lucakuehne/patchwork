# Standardprüfung vor einem Commit: baut patchwork:dev aus dem Arbeitsstand auf dem Server, rollt den Test-Stack damit
# aus (legt ihn an, falls er fehlt), räumt alte Images weg, führt den Smoke-Test mit den aktuellen Testskripten und die
# Prüfung im Browser aus. -SkipBrowser lässt die Prüfung im Browser weg.
param([switch]$SkipBrowser)
. "$PSScriptRoot\portainer.ps1"
Build-DevImage
Deploy-TestStack 'patchwork:dev'
# Läuft die Test-Instanz noch mit dem alten Image (Portainer erstellt den Container nicht immer neu), neu erstellen
$dev = (Get-PortainerJson "$Base/images/patchwork:dev/json").Id
$running = (Get-PortainerJson "$Base/containers/patchwork-test-patchwork-1/json").Image
if ($running -ne $dev) {
  Invoke-Portainer -Method DELETE -Path "$Base/containers/patchwork-test-patchwork-1?force=true" -TimeoutSec 120 | Out-Null
  Deploy-TestStack 'patchwork:dev'
  "Test-Instanz mit neuem Image erstellt: $((Get-PortainerJson "$Base/containers/patchwork-test-patchwork-1/json").Image -eq $dev)"
}
Wait-TestInstance | Out-Null
& "$PSScriptRoot\cleanup-images.ps1"
& "$PSScriptRoot\smoke.ps1" -Upload
$health = (Get-PortainerJson "$Base/containers/patchwork-test-patchwork-1/json").State.Health.Status
"Healthcheck der Test-Instanz: $health"
if (-not $SkipBrowser) { & "$PSScriptRoot\browser-check.ps1" }
