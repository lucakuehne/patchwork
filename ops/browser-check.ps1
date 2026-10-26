# Prüfung im Browser: vorübergehender Container mit Playwright (Chromium) im Netz des Test-Stacks, führt ein Skript aus
# ops/ui (Standard ui-check.mjs) gegen die Test-Instanz aus und holt die Bildschirmfotos nach ops/out/<ShotsDir>.
# Der Container wird danach entfernt. Läuft nach dem Smoke-Test (braucht dessen Daten).
param([string]$Script = 'ui-check.mjs', [string]$ShotsDir = 'shots')
. "$PSScriptRoot\portainer.ps1"
$image = 'mcr.microsoft.com/playwright:v1.63.0-noble'
$name = 'patchwork-test-browser'

$network = (Get-PortainerJson "$Base/networks") | Where-Object { $_.Name -like 'patchwork-test*' } | Select-Object -First 1
if (-not $network) { throw 'Kein Netz des Test-Stacks' }
"Netz: $($network.Name)"

if (-not ((Get-PortainerJson "$Base/images/json") | Where-Object { $_.RepoTags -contains $image })) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $pull = Invoke-Portainer -Method POST -Path "$Base/images/create?fromImage=mcr.microsoft.com%2Fplaywright&tag=v1.63.0-noble" -TimeoutSec 1800
  "Image geholt: HTTP $($pull.Status), $([int]$sw.Elapsed.TotalSeconds) s"
}

Invoke-Portainer -Method DELETE -Path "$Base/containers/$name`?force=1" | Out-Null
$create = Invoke-Portainer -Method POST -Path "$Base/containers/create?name=$name" -Body @{
  Image = $image
  Cmd = @('sleep', 'infinity')
  WorkingDir = '/work'
  Env = @('COREPACK_ENABLE_DOWNLOAD_PROMPT=0')
  HostConfig = @{ NetworkMode = $network.Name; Memory = 2147483648; ShmSize = 536870912 }
}
if ($create.Status -ne 201) { throw "Container anlegen -> $($create.Status): $($create.Content)" }
Invoke-Portainer -Method POST -Path "$Base/containers/$name/start" | Out-Null
try {
  $install = Invoke-DockerExec -Container $name -Cmd @('sh', '-c', 'mkdir -p /work && cd /work && corepack pnpm init >/dev/null && corepack pnpm add playwright@1.63.0 2>&1 | tail -n 1') -TimeoutSec 600
  "Playwright installiert: Exit $($install.ExitCode)"

  $scriptTar = Join-Path $OutDir 'ui-script.tar'
  & $Tar -cf $scriptTar -C (Join-Path $PSScriptRoot 'ui') $Script
  $up = Invoke-PortainerUpload -Method PUT -Path "$Base/containers/$name/archive?path=%2Fwork" -File $scriptTar -TimeoutSec 120
  "Skript hochgeladen: HTTP $($up.Status)"

  $run = Invoke-DockerExec -Container $name -Cmd @('node', $Script, 'http://net:8080') -TimeoutSec 900
  "Prüfung: Exit $($run.ExitCode)"
  $run.Output.Trim()

  # Bildschirmfotos holen
  $shotsTar = Join-Path $OutDir 'shots.tar'
  $status = Save-PortainerFile -Path "$Base/containers/$name/archive?path=%2Fwork%2Fshots" -File $shotsTar
  $dest = Join-Path $OutDir $ShotsDir
  $extract = Join-Path $OutDir 'extract'
  Remove-Item $dest, $extract -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $extract | Out-Null
  & $Tar -xf $shotsTar -C $extract
  Move-Item (Join-Path $extract 'shots') $dest
  Remove-Item $extract -Recurse -Force
  "Bilder geholt: HTTP $status, $(@(Get-ChildItem $dest -Filter *.png).Count) Dateien in $dest"
} finally {
  Invoke-Portainer -Method DELETE -Path "$Base/containers/$name`?force=1" | Out-Null
  'Browser-Container entfernt'
}
