# Entfernt Images ohne Namen aus früheren Patchwork-Builds (vorheriges patchwork:dev und Build-Stufen), die kein
# Container nutzt. Andere Images auf dem Server bleiben unberührt (Zuordnung über die Build-Geschichte). Nötig nach
# Builds, sonst läuft die Platte voll (am 21.10.2026 passiert, die Produktionsdatenbank stürzte ab).
. "$PSScriptRoot\portainer.ps1"
$images = Get-PortainerJson "$Base/images/json?all=0&filters=%7B%22dangling%22%3A%5B%22true%22%5D%7D"
$removed = 0
$bytes = 0
foreach ($img in $images) {
  if ($img.Containers -gt 0) { continue }
  try { $hist = Get-PortainerJson "$Base/images/$($img.Id)/history" } catch { continue }
  $text = ($hist | ForEach-Object { $_.CreatedBy }) -join ' | '
  if ($text -notmatch 'pnpm --filter backend deploy|FRONTEND_DIR=/app/public') { continue }
  $d = Invoke-Portainer -Method DELETE -Path "$Base/images/$($img.Id.Replace('sha256:', ''))?force=false&noprune=false" -TimeoutSec 120
  if ($d.Status -eq 200) { $removed++; $bytes += $img.Size }
}
"Alte Patchwork-Images entfernt: $removed ($([math]::Round($bytes / 1GB, 1)) GB)"
# Freier Platz, gemessen in einem Container des Test-Stacks (fehlt er, entfällt die Angabe)
try {
  $df = Invoke-DockerExec -Container 'patchwork-test-testdb-1' -Cmd @('sh', '-c', 'df -h / | tail -1') -TimeoutSec 60
  "Platz auf dem Server: $(($df.Output -split '\s+')[3]) frei"
} catch {
  'Platz auf dem Server: unbekannt (kein Test-Stack)'
}
