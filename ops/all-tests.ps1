# Alle Prüfungen: Build und Test-Stack, Smoke-Test, Browser, danach LDAP und AD (siehe build-test.ps1, ldap-ad-test.ps1).
. "$PSScriptRoot\portainer.ps1"
& "$PSScriptRoot\build-test.ps1"
'=== LDAP und AD ==='
& "$PSScriptRoot\ldap-ad-test.ps1"
