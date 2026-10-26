# Update-Test für Migrationen: baut patchwork:dev, legt den Test-Stack neu mit der veröffentlichten Version
# (ghcr latest = Stand der Produktion) an, füllt ihn mit dem Smoke-Test dieser Version (Stand GitHub), stellt dann auf
# patchwork:dev um, damit die neuen Migrationen auf echten Daten laufen. Danach frische Datenbank, neuer Smoke-Test und
# Prüfung im Browser. -Sql zeigt vor und nach dem Update das Ergebnis einer Abfrage (z.B. betroffene Tabellen).
param([string]$Sql = '')
. "$PSScriptRoot\portainer.ps1"
Build-DevImage

# Bestehenden Test-Stack samt Volumes entfernen (Images bleiben)
& "$PSScriptRoot\remove-test-stack.ps1" -KeepImages
Deploy-TestStack 'ghcr.io/lucakuehne/patchwork:latest'
"Bereit: $(Wait-TestInstance '"setupRequired":true')"
$old = Invoke-DockerExec -Container 'patchwork-test-runner-1' -Cmd @('node', 'test/smoke.mjs', 'http://localhost:8080') -TimeoutSec 1200
"Smoke-Test der alten Version: Exit $($old.ExitCode)"
$migrations = 'select count(*) from drizzle.__drizzle_migrations'
"Migrationen vorher: $(Invoke-TestSql $migrations)"
if ($Sql) { "Vorher: $(Invoke-TestSql $Sql)" }

Deploy-TestStack 'patchwork:dev'
"Bereit: $(Wait-TestInstance '"setupRequired":false')"
Start-Sleep -Seconds 5
"Migrationen nachher: $(Invoke-TestSql $migrations)"
if ($Sql) { "Nachher: $(Invoke-TestSql $Sql)" }
$log = ((Invoke-Portainer -Path "$Base/containers/patchwork-test-patchwork-1/logs?stdout=1&stderr=1&tail=300").Content -replace '[\x00-\x08]', '') -replace '\x1b\[[0-9;]*m', ''
"Fehler im Log nach dem Update: $(@(($log -split "`n") | Where-Object { $_ -match ' ERROR ' }).Count)"

& "$PSScriptRoot\cleanup-images.ps1"
& "$PSScriptRoot\smoke.ps1" -Upload
& "$PSScriptRoot\browser-check.ps1"
