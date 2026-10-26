# LDAP- und AD-Tests im Test-Stack nach dem Smoke-Test (Admin ada@test.local aus dem Smoke-Test): OpenLDAP und
# Samba-AD befüllen, backend/test/ldap-smoke.mjs und ad-smoke.mjs, im Browser «Benutzer aus dem AD vorab anlegen»
# (ops/ui/ui-ad.mjs) und «Rolle aus AD-Gruppen nachziehen» (backend/test/ad-role-sync.mjs).
. "$PSScriptRoot\portainer.ps1"
function Exec([string]$container, [string[]]$cmd, [int]$timeout = 300) {
  $r = Invoke-DockerExec -Container $container -Cmd $cmd -TimeoutSec $timeout
  [pscustomobject]@{ ExitCode = $r.ExitCode; Output = $r.Output.Trim() }
}
function Summary($text) {
  $lines = $text -split "`n" | Where-Object { $_.Trim() }
  $steps = @($lines | Where-Object { $_.StartsWith([string][char]0x2022) })
  $ok = @($steps | Where-Object { $_.TrimEnd().EndsWith(' ok') })
  "ok $($ok.Count) von $($steps.Count)"
  $first = 0
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].StartsWith([string][char]0x2022) -and -not $lines[$i].TrimEnd().EndsWith(' ok')) { $first = $i; break } }
  if ($ok.Count -ne $steps.Count) { $lines | Select-Object -Skip $first -First 25 }
}

# Aktuelle Testdaten (mit smoke.ps1 -Upload nach /app/test geladen) dorthin, wo OpenLDAP sie liest
$copy = Exec 'patchwork-test-runner-1' @('sh', '-c', 'cp /app/test/ldap-seed.ldif /testfiles/ldap-seed.ldif && grep -c givenName /testfiles/ldap-seed.ldif')
"Testdaten kopiert: Exit $($copy.ExitCode), Einträge mit givenName: $($copy.Output)"
# OpenLDAP: vorhandene Testdaten entfernen (sie können sich geändert haben), dann neu befüllen
$clear = Exec 'patchwork-test-openldap-1' @('sh', '-c', 'for dn in $(ldapsearch -x -H ldap://localhost -D cn=admin,dc=test,dc=local -w admin-pw -LLL -s one -b dc=test,dc=local dn | sed -n "s/^dn: //p"); do ldapdelete -x -H ldap://localhost -D cn=admin,dc=test,dc=local -w admin-pw -r "$dn"; done; echo geleert')
"OpenLDAP geleert: Exit $($clear.ExitCode)"
$seed = Exec 'patchwork-test-openldap-1' @('ldapadd', '-x', '-H', 'ldap://localhost', '-D', 'cn=admin,dc=test,dc=local', '-w', 'admin-pw', '-f', '/testfiles/ldap-seed.ldif')
"OpenLDAP befüllt: Exit $($seed.ExitCode)"
$ldap = Exec 'patchwork-test-runner-1' @('node', 'test/ldap-smoke.mjs', 'http://localhost:8080', 'ada@test.local', 'geheim-geheim') 900
"LDAP-Test: Exit $($ldap.ExitCode)"
Summary $ldap.Output

# Samba-AD: Zertifikat einspielen, neu starten, Testkonten und Gruppen anlegen (wie backend/test/ad-setup.sh)
$tls = Exec 'patchwork-test-samba-1' @('sh', '-c', 'cp /testfiles/tls/ca.pem /testfiles/tls/cert.pem /testfiles/tls/key.pem /var/lib/samba/private/tls/ && chown root:root /var/lib/samba/private/tls/*.pem && chmod 600 /var/lib/samba/private/tls/key.pem && chmod 644 /var/lib/samba/private/tls/ca.pem /var/lib/samba/private/tls/cert.pem')
"Zertifikat eingespielt: Exit $($tls.ExitCode)"
Invoke-Portainer -Method POST -Path "$Base/containers/patchwork-test-samba-1/restart?t=10" -TimeoutSec 120 | Out-Null
$ready = $false
for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
  Start-Sleep -Seconds 3
  $ready = (Exec 'patchwork-test-samba-1' @('sh', '-c', 'ldapsearch -H ldaps://localhost -x -s base -b "" >/dev/null 2>&1 && echo bereit') 30).Output -match 'bereit'
}
"Samba bereit: $ready"
$accounts = @'
# Konten und Gruppen eines früheren Laufs entfernen (der Samba-Container bleibt bei einem Neuaufbau des Stacks bestehen)
for u in svc-patchwork lena otto nina sam dora nomail ida iris jan; do samba-tool user delete "$u" >/dev/null 2>&1 || true; done
for g in patchwork-it patchwork-admin it-team patchwork-portal; do samba-tool group delete "$g" >/dev/null 2>&1 || true; done
set -e
samba-tool user create svc-patchwork 'Svc-Passw0rd!' --description="Patchwork Dienstkonto" >/dev/null
samba-tool user create lena 'Lena-Passw0rd!' --given-name=Lena --surname=Lind --mail-address=lena@test.patchwork >/dev/null
samba-tool user create otto 'Otto-Passw0rd!' --given-name=Otto --surname=Ober --mail-address=otto@test.patchwork >/dev/null
samba-tool user create nina 'Nina-Passw0rd!' --given-name=Nina --surname=Nested --mail-address=nina@test.patchwork >/dev/null
samba-tool user create sam 'Sam-Passw0rd!' --given-name=Sam --surname=Standard --mail-address=sam@test.patchwork >/dev/null
samba-tool user create dora 'Dora-Passw0rd!' --given-name=Dora --surname=Deaktiviert --mail-address=dora@test.patchwork >/dev/null
samba-tool user create nomail 'Nomail-Passw0rd!' --given-name=Nora --surname=Ohnemail >/dev/null
samba-tool user disable dora >/dev/null
samba-tool group add patchwork-it >/dev/null
samba-tool group add patchwork-admin >/dev/null
samba-tool group add it-team >/dev/null
samba-tool group add patchwork-portal >/dev/null
samba-tool group addmembers patchwork-it lena,it-team,dora >/dev/null
samba-tool group addmembers patchwork-admin otto >/dev/null
samba-tool group addmembers it-team nina >/dev/null
samba-tool group addmembers patchwork-portal sam >/dev/null
for entry in "Lena Lind" "Otto Ober" "Nina Nested" "Sam Standard" "Dora Deaktiviert"; do
  printf 'dn: CN=%s,CN=Users,DC=test,DC=patchwork\nchangetype: modify\nreplace: displayName\ndisplayName: %s\n' "$entry" "$entry" | ldbmodify -H /var/lib/samba/private/sam.ldb >/dev/null
done
echo Konten angelegt
'@
$setup = Exec 'patchwork-test-samba-1' @('sh', '-c', ($accounts -replace "`r", ''))
"AD eingerichtet: Exit $($setup.ExitCode) $($setup.Output)"
$ad = Exec 'patchwork-test-runner-1' @('node', 'test/ad-smoke.mjs', 'http://localhost:8080', 'ada@test.local', 'geheim-geheim', '/testfiles/tls/ca.pem') 900
"AD-Test: Exit $($ad.ExitCode)"
Summary $ad.Output

# Im Browser: Benutzer aus dem AD vorab anlegen, mit dem Konto «iris» (IT)
$iris = @'
samba-tool user create iris 'Iris-Passw0rd!' --given-name=Iris --surname=Imhof --mail-address=iris@test.patchwork >/dev/null 2>&1 || true
samba-tool group addmembers patchwork-it iris >/dev/null 2>&1 || true
printf 'dn: CN=Iris Imhof,CN=Users,DC=test,DC=patchwork\nchangetype: modify\nreplace: displayName\ndisplayName: Iris Imhof\n' | ldbmodify -H /var/lib/samba/private/sam.ldb >/dev/null
echo iris bereit
'@
"AD-Konto: $((Exec 'patchwork-test-samba-1' @('sh', '-c', ($iris -replace "`r", ''))).Output)"
& "$PSScriptRoot\browser-check.ps1" -Script ui-ad.mjs -ShotsDir shots-ad
"AD aufgeräumt: $((Exec 'patchwork-test-samba-1' @('sh', '-c', 'samba-tool user delete iris >/dev/null 2>&1; samba-tool user delete ida >/dev/null 2>&1; echo iris entfernt')).Output)"

# Rolle «Aus AD-Gruppen» wird beim Speichern nachgezogen: jan (IT) anlegen, im AD aus der IT-Gruppe nehmen, prüfen
$jan = @'
samba-tool user create jan 'Jan-Passw0rd!' --given-name=Jan --surname=Jost --mail-address=jan@test.patchwork >/dev/null 2>&1 || true
samba-tool group addmembers patchwork-it jan >/dev/null 2>&1 || true
echo jan im AD
'@
"AD: $((Exec 'patchwork-test-samba-1' @('sh', '-c', ($jan -replace "`r", ''))).Output)"
$create = Exec 'patchwork-test-runner-1' @('node', 'test/ad-role-sync.mjs', 'anlegen')
"Rolle nachziehen, anlegen: Exit $($create.ExitCode) $($create.Output)"
"AD: $((Exec 'patchwork-test-samba-1' @('sh', '-c', 'samba-tool group removemembers patchwork-it jan >/dev/null && echo jan nicht mehr in patchwork-it')).Output)"
$check = Exec 'patchwork-test-runner-1' @('node', 'test/ad-role-sync.mjs', 'pruefen')
"Rolle nachziehen, prüfen: Exit $($check.ExitCode) $($check.Output)"
"AD aufgeräumt: $((Exec 'patchwork-test-samba-1' @('sh', '-c', 'samba-tool user delete jan >/dev/null 2>&1; echo jan entfernt')).Output)"
