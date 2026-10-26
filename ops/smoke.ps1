# Smoke-Test im Test-Stack «patchwork-test»: setzt Datenbank und Ablage der Test-Instanz zurück, startet sie neu und
# führt backend/test/smoke.mjs aus. -Upload lädt vorher die Testskripte aus dem Arbeitsstand in den Runner (sonst gilt
# der Stand von GitHub). Die vollständige Ausgabe steht danach in ops/out/smoke-output.txt.
param([switch]$Upload)
. "$PSScriptRoot\portainer.ps1"
$outFile = Join-Path $OutDir 'smoke-output.txt'

# Ablage leeren (sonst bleiben Zertifikat und Dateien des letzten Laufs), Datenbank neu anlegen, Instanz neu starten
Invoke-Portainer -Method POST -Path "$Base/containers/patchwork-test-patchwork-1/start" | Out-Null
Start-Sleep -Seconds 2
$clear = Invoke-DockerExec -Container 'patchwork-test-patchwork-1' -Cmd @('sh', '-c', 'rm -rf /data/tls /data/files') -TimeoutSec 60
"Ablage geleert: Exit-Code $($clear.ExitCode)"
$reset = Invoke-DockerExec -Container 'patchwork-test-testdb-1' -Cmd @('psql', '-U', 'patchwork', '-d', 'postgres', '-q', '-c', 'drop database patchwork with (force)', '-c', 'create database patchwork owner patchwork') -TimeoutSec 60
"Datenbank zurückgesetzt: Exit-Code $($reset.ExitCode) $($reset.Output.Trim())"
$restart = Invoke-Portainer -Method POST -Path "$Base/containers/patchwork-test-patchwork-1/restart?t=5" -TimeoutSec 120
"Neustart: HTTP $($restart.Status)"

if ($Upload) {
  $tests = Join-Path $OutDir 'tests.tar'
  & $Tar -cf $tests -C (Join-Path $RepoRoot 'backend\test') smoke.mjs smoke ldap-smoke.mjs ad-smoke.mjs ad-role-sync.mjs ldap-seed.ldif
  $up = Invoke-PortainerUpload -Method PUT -Path "$Base/containers/patchwork-test-runner-1/archive?path=%2Fapp%2Ftest" -File $tests -TimeoutSec 120
  "Testskripte hochgeladen: HTTP $($up.Status)"
}
"Bereitschaft: $(Wait-TestInstance '"setupRequired":true')"

$sw = [Diagnostics.Stopwatch]::StartNew()
$s = Invoke-DockerExec -Container 'patchwork-test-runner-1' -Cmd @('node', 'test/smoke.mjs', 'http://localhost:8080') -TimeoutSec 1200
[IO.File]::WriteAllText($outFile, $s.Output, $Utf8)
$lines = $s.Output -split "`n" | Where-Object { $_.Trim() }
$steps = @($lines | Where-Object { $_.StartsWith([string][char]0x2022) })
$failed = @($steps | Where-Object { -not $_.TrimEnd().EndsWith(' ok') })
"Smoke-Test: Exit-Code $($s.ExitCode), Laufzeit $([int]$sw.Elapsed.TotalSeconds) s, Schritte: $($steps.Count), fehlgeschlagen: $($failed.Count)"
# Fehlgeschlagene Schritte mit Meldung (der Test läuft nach einem Fehler weiter), sonst die Zusammenfassung
if ($failed.Count) {
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($failed -contains $lines[$i]) { $lines[$i]; $lines | Select-Object -Skip ($i + 1) -First 6 | Where-Object { -not $_.StartsWith([string][char]0x2022) } }
  }
} else { $lines | Select-Object -Last 2 }
$log = ((Invoke-Portainer -Path "$Base/containers/patchwork-test-patchwork-1/logs?stdout=1&stderr=1&tail=400").Content -replace '[\x00-\x08]', '')
$errors = @(($log -split "`n") | Where-Object { $_ -match ' ERROR ' })
"Fehler im Log der Test-Instanz: $($errors.Count)"
$errors | Select-Object -First 10
