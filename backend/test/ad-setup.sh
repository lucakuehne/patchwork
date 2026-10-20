#!/usr/bin/env bash
# Richtet den Samba-AD-Testserver für test/ad-smoke.mjs ein:
# eigene Test-CA mit Zertifikat für «localhost», Container «patchwork-ad» (Ports 11389/11636),
# Testkonten und Gruppen. Ein bestehender Container dieses Namens wird ersetzt.
#
#   bash test/ad-setup.sh [Verzeichnis für Zertifikate]      (Standard: ./ad-test-tls)
#
# Danach: node test/ad-smoke.mjs <Test-Instanz> <Admin-E-Mail> <Admin-Passwort> <Verzeichnis>/ca.pem
set -euo pipefail

DIR="${1:-./ad-test-tls}"
CONTAINER=patchwork-ad
# Git Bash unter Windows: «/CN=…» und «container:/pfad» nicht als Windows-Pfad umschreiben (unter Linux wirkungslos)
export MSYS2_ARG_CONV_EXCL="/CN;${CONTAINER}:"
mkdir -p "$DIR"

echo "Zertifikate erzeugen in $DIR …"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$DIR/ca.key" -out "$DIR/ca.pem" -days 30 \
  -subj "/CN=Patchwork Test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout "$DIR/key.pem" -out "$DIR/server.csr" -subj "/CN=localhost" 2>/dev/null
printf "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n" >"$DIR/ext.cnf"
openssl x509 -req -in "$DIR/server.csr" -CA "$DIR/ca.pem" -CAkey "$DIR/ca.key" -CAcreateserial \
  -out "$DIR/cert.pem" -days 30 -extfile "$DIR/ext.cnf" 2>/dev/null

# Wartet, bis der LDAP-Dienst im Container antwortet
wait_for_samba() {
  for _ in $(seq 1 90); do
    if docker exec "$CONTAINER" sh -c 'ldapsearch -H ldaps://localhost -x -s base -b "" >/dev/null 2>&1'; then
      return 0
    fi
    sleep 2
  done
  echo "Samba antwortet nicht" >&2
  exit 1
}

echo "Container $CONTAINER starten …"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -p 11389:389 -p 11636:636 \
  -e REALM=TEST.PATCHWORK -e DOMAIN=TESTPW -e ADMINPASS='Adm1n-Passw0rd!' smblds/smblds:latest >/dev/null
wait_for_samba

echo "Zertifikat einspielen …"
for f in ca.pem cert.pem key.pem; do
  docker cp "$DIR/$f" "$CONTAINER:/var/lib/samba/private/tls/$f"
done
docker exec "$CONTAINER" sh -c 'chown root:root /var/lib/samba/private/tls/*.pem &&
  chmod 600 /var/lib/samba/private/tls/key.pem &&
  chmod 644 /var/lib/samba/private/tls/ca.pem /var/lib/samba/private/tls/cert.pem'
docker restart "$CONTAINER" >/dev/null
wait_for_samba

echo "Testkonten und Gruppen anlegen …"
docker exec -i "$CONTAINER" sh <<'EOF'
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
  printf 'dn: CN=%s,CN=Users,DC=test,DC=patchwork\nchangetype: modify\nreplace: displayName\ndisplayName: %s\n' "$entry" "$entry" |
    ldbmodify -H /var/lib/samba/private/sam.ldb >/dev/null
done
EOF

echo "Fertig. CA-Zertifikat: $DIR/ca.pem"
