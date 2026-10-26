# Rollout in die Produktion: wartet, bis GitHub Actions das Image zum Commit gebaut hat, rollt dann den Stack
# «patchwork» neu aus (Variablen bleiben, Image neu holen) und prüft Revision, HTTPS, Healthcheck und Fehler im Log.
# -Dump legt vorher einen Datenbank-Dump im Volume der Datenbank ab (Ordner «sicherungen»), z.B. vor Migrationen.
param([Parameter(Mandatory = $true)][string]$Sha, [switch]$Dump)
. "$PSScriptRoot\portainer.ps1"
$full = (git -C $RepoRoot rev-parse $Sha).Trim()
$headers = @{ 'User-Agent' = 'patchwork-deploy'; Accept = 'application/vnd.github+json' }
$deadline = (Get-Date).AddMinutes(25)
$run = $null
do {
  Start-Sleep -Seconds 20
  try {
    $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/lucakuehne/patchwork/actions/runs?head_sha=$full" -Headers $headers -TimeoutSec 30
    $run = $runs.workflow_runs | Select-Object -First 1
  } catch { "Abfrage fehlgeschlagen: $($_.Exception.Message)" }
} while ((-not $run -or $run.status -ne 'completed') -and (Get-Date) -lt $deadline)
if (-not $run) { throw 'Kein Lauf von GitHub Actions gefunden' }
"GitHub Actions: $($run.conclusion)"
if ($run.conclusion -ne 'success') { throw 'GitHub Actions nicht erfolgreich – kein Rollout' }

if ($Dump) {
  $name = "vor-$($Sha.Substring(0, 7))-$(Get-Date -Format 'yyyyMMdd-HHmm').dump"
  $d = Invoke-DockerExec -Container 'patchwork-db-1' -Cmd @('sh', '-c', "mkdir -p /var/lib/postgresql/data/sicherungen && pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -Fc -f /var/lib/postgresql/data/sicherungen/$name && ls -la /var/lib/postgresql/data/sicherungen/$name") -TimeoutSec 600
  if ($d.ExitCode -ne 0) { throw "Dump fehlgeschlagen: $($d.Output)" }
  "Dump: $($d.Output.Trim())"
}

$oldImage = (Get-PortainerJson "$Base/containers/patchwork-patchwork-1/json").Image
$s = Get-PortainerJson "/api/stacks/$ProductionStackId"
$stackEnv = @($s.Env | ForEach-Object { @{ name = $_.name; value = $_.value } })
$r = Invoke-Portainer -Method PUT -Path "/api/stacks/$ProductionStackId/git/redeploy?endpointId=$EndpointId" -Body @{ repositoryReferenceName = 'refs/heads/main'; repositoryAuthentication = $false; env = $stackEnv; prune = $false; pullImage = $true } -TimeoutSec 900
"Redeploy: HTTP $($r.Status)"
if ($r.Status -ne 200) { throw "Redeploy fehlgeschlagen: $($r.Content)" }
$deadline = (Get-Date).AddMinutes(3)
do {
  Start-Sleep -Seconds 5
  $log = ((Invoke-Portainer -Path "$Base/containers/patchwork-patchwork-1/logs?stdout=1&stderr=1&tail=80").Content -replace '[\x00-\x08]', '') -replace '\x1b\[[0-9;]*m', ''
} while ($log -notmatch 'HTTPS auf Port|HTTPS nicht gestartet' -and (Get-Date) -lt $deadline)
$c = Get-PortainerJson "$Base/containers/patchwork-patchwork-1/json"
$img = Get-PortainerJson "$Base/images/$($c.Image)/json"
"Container: $($c.State.Status), Revision $($img.Config.Labels.'org.opencontainers.image.revision'.Substring(0, 7))"
"HTTPS gestartet: $($log -match 'HTTPS auf Port'), Fehler im Log: $(@($log -split "`n" | Where-Object { $_ -match 'ERROR' }).Count)"
"public/info: $(& curl.exe -s --max-time 15 "$PublicUrl/api/public/info")"
"Healthcheck: $(& curl.exe -s --max-time 15 "$PublicUrl/api/health")"
if ($oldImage -ne $c.Image) {
  $inUse = (Get-PortainerJson "$Base/containers/json?all=1") | Where-Object { $_.ImageID -eq $oldImage }
  if (-not $inUse) {
    $d = Invoke-Portainer -Method DELETE -Path "$Base/images/$($oldImage.Replace('sha256:', ''))" -TimeoutSec 120
    "Altes Image entfernt: HTTP $($d.Status)"
  }
}
