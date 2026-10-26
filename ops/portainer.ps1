# Gemeinsame Teile der Betriebsskripte: Konfiguration (ops/config.ps1) und Aufrufe der Portainer-API.
# Das Token wird nur eingelesen, nie ausgegeben. JSON geht über Dateien an curl.exe, weil Windows PowerShell 5.1
# Anführungszeichen in Argumenten verstümmelt.
$ErrorActionPreference = 'Stop'
$configFile = Join-Path $PSScriptRoot 'config.ps1'
if (-not (Test-Path $configFile)) { throw "ops/config.ps1 fehlt: Vorlage ops/config.example.ps1 kopieren und anpassen" }
. $configFile

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Docker-API des Servers über Portainer
$Base = "/api/endpoints/$EndpointId/docker"
# Ausgaben (Bildschirmfotos, Protokolle, Archive) und Zwischendateien, nicht im Repo
$OutDir = Join-Path $PSScriptRoot 'out'
$ApiTmp = Join-Path $OutDir 'api'
New-Item -ItemType Directory -Force $ApiTmp | Out-Null
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Tar = "$env:SystemRoot\System32\tar.exe"

function Invoke-Portainer {
  param(
    [string]$Method = 'GET',
    [Parameter(Mandatory = $true)][string]$Path,
    $Body,
    [int]$TimeoutSec = 120
  )
  $token = ([IO.File]::ReadAllText($TokenFile)).Trim()
  $out = Join-Path $ApiTmp ([guid]::NewGuid().ToString() + '.out')
  $curlArgs = @('-sk', '--max-time', "$TimeoutSec", '-X', $Method, '-H', "X-API-Key: $token", '-o', $out, '-w', '%{http_code}')
  $bodyFile = $null
  if ($null -ne $Body) {
    $json = if ($Body -is [string]) { $Body } else { ConvertTo-Json -InputObject $Body -Depth 20 -Compress }
    $bodyFile = Join-Path $ApiTmp ([guid]::NewGuid().ToString() + '.json')
    [IO.File]::WriteAllText($bodyFile, $json, $Utf8)
    $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$bodyFile")
  }
  $status = & curl.exe @curlArgs "$PortainerUrl$Path"
  $content = if (Test-Path $out) { [IO.File]::ReadAllText($out, [Text.Encoding]::UTF8) } else { '' }
  Remove-Item $out -ErrorAction SilentlyContinue
  if ($bodyFile) { Remove-Item $bodyFile -ErrorAction SilentlyContinue }
  [pscustomobject]@{ Status = [int]$status; Content = $content }
}

# Lädt eine Datei als Rohdaten hoch (z.B. ein Build-Kontext oder Testskripte als tar)
function Invoke-PortainerUpload {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$File,
    [string]$Method = 'POST',
    [string]$ContentType = 'application/x-tar',
    [int]$TimeoutSec = 1200
  )
  $token = ([IO.File]::ReadAllText($TokenFile)).Trim()
  $out = Join-Path $ApiTmp ([guid]::NewGuid().ToString() + '.out')
  $status = & curl.exe -sk --max-time "$TimeoutSec" -X $Method -H "X-API-Key: $token" -H "Content-Type: $ContentType" --data-binary "@$File" -o $out -w '%{http_code}' "$PortainerUrl$Path"
  $content = if (Test-Path $out) { [IO.File]::ReadAllText($out, [Text.Encoding]::UTF8) } else { '' }
  Remove-Item $out -ErrorAction SilentlyContinue
  [pscustomobject]@{ Status = [int]$status; Content = $content }
}

# Lädt eine Datei vom Server herunter (z.B. ein Archiv mit Bildschirmfotos aus einem Container)
function Save-PortainerFile {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$File, [int]$TimeoutSec = 300)
  $token = ([IO.File]::ReadAllText($TokenFile)).Trim()
  & curl.exe -sk --max-time "$TimeoutSec" -H "X-API-Key: $token" -o $File -w '%{http_code}' "$PortainerUrl$Path"
}

function Get-PortainerJson {
  param([Parameter(Mandatory = $true)][string]$Path)
  $r = Invoke-Portainer -Path $Path
  if ($r.Status -ne 200) { throw "GET $Path -> $($r.Status): $($r.Content)" }
  $r.Content | ConvertFrom-Json
}

# Führt einen Befehl in einem Container aus und liefert Ausgabe und Exit-Code
function Invoke-DockerExec {
  param(
    [Parameter(Mandatory = $true)][string]$Container,
    [Parameter(Mandatory = $true)][string[]]$Cmd,
    [string[]]$Env = @(),
    [int]$TimeoutSec = 900
  )
  $create = Invoke-Portainer -Method POST -Path "$Base/containers/$Container/exec" -Body @{ AttachStdout = $true; AttachStderr = $true; Tty = $true; Cmd = $Cmd; Env = $Env }
  if ($create.Status -ne 201) { throw "exec in $Container -> $($create.Status): $($create.Content)" }
  $id = ($create.Content | ConvertFrom-Json).Id
  $start = Invoke-Portainer -Method POST -Path "$Base/exec/$id/start" -Body @{ Detach = $false; Tty = $true } -TimeoutSec $TimeoutSec
  $info = Get-PortainerJson "$Base/exec/$id/json"
  [pscustomobject]@{ Output = (($start.Content -replace "`r", '') -replace '\x1b\[[0-9;]*m', ''); ExitCode = $info.ExitCode; HttpStatus = $start.Status }
}

# Baut das Image patchwork:dev auf dem Server aus dem Arbeitsstand (ohne Abhängigkeiten, Ausgaben und Geheimnisse)
function Build-DevImage {
  $ctx = Join-Path $OutDir 'context.tar'
  Remove-Item $ctx -ErrorAction SilentlyContinue
  & $Tar -cf $ctx --exclude=node_modules --exclude=dist --exclude=.git --exclude=data --exclude=.env --exclude=coverage `
    --exclude=ad-test-tls --exclude='*.log' --exclude=portainer-token.txt --exclude=./deploy/tls --exclude=./ops/out `
    --exclude=./ops/config.ps1 -C $RepoRoot .
  $list = & $Tar -tf $ctx
  if (@($list | Where-Object { $_ -match 'portainer-token|\.env$|/\.git/|deploy/tls|ops/config\.ps1' }).Count) { throw 'Heikle Dateien im Build-Kontext – Abbruch' }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-PortainerUpload -Path "$Base/build?t=patchwork%3Adev&rm=1&forcerm=1" -File $ctx -TimeoutSec 1500
  $lines = $r.Content -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ }
  $errors = $lines | Where-Object { $_.error }
  if ($errors) {
    'FEHLER beim Build:'
    $errors | ForEach-Object { $_.error }
    $lines | Where-Object { $_.stream } | Select-Object -Last 40 | ForEach-Object { $_.stream.TrimEnd() }
    throw 'Build fehlgeschlagen'
  }
  "Build: $([int]$sw.Elapsed.TotalSeconds) s"
}

# Stack «patchwork-test» (deploy/test-stack.yml) mit einem Image neu ausrollen bzw. anlegen
function Deploy-TestStack {
  param([string]$Image = 'patchwork:dev')
  $content = [IO.File]::ReadAllText((Join-Path $RepoRoot 'deploy\test-stack.yml'), [Text.Encoding]::UTF8)
  $stackEnv = @(@{ name = 'PATCHWORK_IMAGE'; value = $Image }, @{ name = 'TEST_REF'; value = 'main' })
  $stack = (Get-PortainerJson '/api/stacks') | Where-Object { $_.Name -eq 'patchwork-test' }
  if ($stack) {
    $r = Invoke-Portainer -Method PUT -Path "/api/stacks/$($stack.Id)?endpointId=$EndpointId" -Body @{ stackFileContent = $content; env = $stackEnv; prune = $false; pullImage = $false } -TimeoutSec 900
  } else {
    $r = Invoke-Portainer -Method POST -Path "/api/stacks/create/standalone/string?endpointId=$EndpointId" -Body @{ name = 'patchwork-test'; stackFileContent = $content; env = $stackEnv } -TimeoutSec 900
  }
  if ($r.Status -ne 200) { throw "Test-Stack ausrollen -> $($r.Status): $($r.Content)" }
  "Test-Stack mit $Image ausgerollt"
}

# Wartet, bis der Runner des Test-Stacks bereit ist und die Test-Instanz antwortet (Ausgabe von /api/public/info)
function Wait-TestInstance {
  param([string]$Expect = '"setupRequired"')
  $probe = "fetch('http://localhost:8080/api/public/info').then(r => r.json()).then(j => console.log('INFO ' + JSON.stringify(j))).catch(e => { console.log('ERR ' + e.message); process.exit(1); })"
  $out = ''
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 5
    $log = ((Invoke-Portainer -Path "$Base/containers/patchwork-test-runner-1/logs?stdout=1&stderr=1&tail=5").Content -replace '[\x00-\x08]', '')
    if ($log -notmatch 'Testdateien bereit') { continue }
    $out = (Invoke-DockerExec -Container 'patchwork-test-runner-1' -Cmd @('node', '-e', $probe) -TimeoutSec 30).Output.Trim()
    if ($out -match $Expect) { return $out }
  }
  throw "Test-Instanz nicht bereit: $out"
}

# SQL in der Datenbank des Test-Stacks, Ergebnis als eine Zeile
function Invoke-TestSql([string]$Query) {
  (Invoke-DockerExec -Container 'patchwork-test-testdb-1' -Cmd @('psql', '-U', 'patchwork', '-d', 'patchwork', '-t', '-A', '-c', $Query) -TimeoutSec 60).Output.Trim() -replace "`n", ' || '
}
