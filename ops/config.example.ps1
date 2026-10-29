# Vorlage für ops/config.ps1: Zugang zum Docker-Server über die Portainer-API. Kopieren nach ops/config.ps1 und
# anpassen. ops/config.ps1 und das Token stehen nicht im Repo (.gitignore), weil das Repo öffentlich ist.
$PortainerUrl = 'https://portainer.example.local:9443'
# Umgebung (Endpoint) des Docker-Servers in Portainer
$EndpointId = 1
# Stack «patchwork» der Produktion (Stacks → patchwork, die Zahl in der Adresse)
$ProductionStackId = 1
# Adresse von Patchwork, zur Prüfung nach dem Rollout
$PublicUrl = 'https://patchwork.example.local'
# Access Token von Portainer (Benutzer → My account → Access tokens), eine Zeile
$TokenFile = Join-Path $PSScriptRoot '..\deploy\portainer-token.txt'
# Optional, nur zum Auswerten vor dem Import: HelpSpot (Adresse ohne /api) und API-Schlüssel eines Kontos, das alle
# Tickets lesen darf (HelpSpot: Profil → API-Token; Admin → Settings → Web Services API muss die Private API erlauben)
$HelpSpotUrl = 'https://helpspot.example.local'
$HelpSpotKey = ''
