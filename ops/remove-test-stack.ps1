# Entfernt den Test-Stack «patchwork-test» samt Volumes. Ohne -KeepImages auch die Test-Images (patchwork:dev,
# GreenMail, OpenLDAP, Samba, Playwright) und die ungetaggten Patchwork-Builds; postgres:17-alpine bleibt (Produktion),
# andere Images auf dem Server ebenso.
param([switch]$KeepImages)
. "$PSScriptRoot\portainer.ps1"
$filter = '%7B%22label%22%3A%5B%22com.docker.compose.project%3Dpatchwork-test%22%5D%7D'
$stack = (Get-PortainerJson '/api/stacks') | Where-Object { $_.Name -eq 'patchwork-test' }
if ($stack) {
  $vols = (Get-PortainerJson "$Base/containers/json?all=1&filters=$filter") | ForEach-Object { $_.Mounts } | Where-Object { $_.Type -eq 'volume' } | ForEach-Object { $_.Name } | Sort-Object -Unique
  $d = Invoke-Portainer -Method DELETE -Path "/api/stacks/$($stack.Id)?endpointId=$EndpointId" -TimeoutSec 300
  "Test-Stack entfernt: HTTP $($d.Status)"
  $ok = 0; foreach ($v in $vols) { if ((Invoke-Portainer -Method DELETE -Path "$Base/volumes/$v").Status -eq 204) { $ok++ } }
  "Volumes entfernt: $ok von $(@($vols).Count)"
} else { 'Kein Test-Stack vorhanden' }
if ($KeepImages) { return }
$used = (Get-PortainerJson "$Base/containers/json?all=1") | ForEach-Object { $_.ImageID }
$tags = 'patchwork:dev', 'greenmail/standalone:2.1.3', 'osixia/openldap:1.5.0', 'smblds/smblds:latest', 'mcr.microsoft.com/playwright:v1.63.0-noble'
$targets = (Get-PortainerJson "$Base/images/json") | Where-Object {
  $tagged = @($_.RepoTags | Where-Object { $_ -and $_ -ne '<none>:<none>' })
  $tagged | Where-Object { $tags -contains $_ }
} | Where-Object { $used -notcontains $_.Id }
foreach ($i in $targets) {
  $r = Invoke-Portainer -Method DELETE -Path "$Base/images/$($i.Id.Substring(7))" -TimeoutSec 120
  '{0} {1}: HTTP {2}' -f $i.Id.Substring(7, 12), (@($i.RepoTags) -join ','), $r.Status
}
& "$PSScriptRoot\cleanup-images.ps1"
