#!/usr/bin/env bash
# One-time owner setup for Luma Android TV stable signing, in your trusted Codespace.
set -euo pipefail
set +x
umask 077
REPO="cj42izzle/Luma-Media-Center"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_DIR="$ROOT/.luma-private"
KEYFILE="$PRIVATE_DIR/luma-tv-release.p12"
ALIAS="luma-android-tv"
required=(LUMA_ANDROID_KEYSTORE_B64 LUMA_ANDROID_KEYSTORE_PASSWORD LUMA_ANDROID_KEY_ALIAS LUMA_ANDROID_KEY_PASSWORD)

echo ""
echo "LUMA ANDROID TV — ONE-TIME OWNER SIGNING"
echo "No password or signing key is committed to GitHub or sent to ChatGPT."
for cmd in gh keytool openssl base64; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing $cmd. Open this repository in a full GitHub Codespace with Java installed."
    exit 1
  fi
done
echo "Checking access to GitHub Actions secrets..."
if ! existing="$(gh secret list -R "$REPO" --app actions 2>&1)"; then
  echo "Your Codespace login cannot access Actions repository secrets."
  echo "Run this command in the Codespaces terminal to authorize your own account:"
  echo "  unset GH_TOKEN GITHUB_TOKEN; gh auth login -h github.com --web --scopes repo"
  echo "Complete authorization in GitHub, then rerun: bash android-tv/setup-signing.sh"
  exit 1
fi
already=0
for secret in "${required[@]}"; do
  if printf '%s\n' "$existing" | grep -Eq "^${secret}[[:space:]]"; then
    already=$((already+1))
  fi
done
if [ "$already" -eq 4 ]; then
  echo "All four Actions signing secrets are already configured."
  echo "Refusing to replace or rotate your signing key."
  echo "Run the existing Android TV APK Preview workflow from GitHub Actions on main."
  exit 0
elif [ "$already" -gt 0 ]; then
  echo "There are $already of 4 existing signing secrets."
  echo "Stopping so an existing signing identity is not accidentally replaced."
  echo "Finish or recover those secrets in GitHub Settings > Secrets and variables > Actions."
  exit 1
fi

mkdir -p "$PRIVATE_DIR"
chmod 700 "$PRIVATE_DIR"
if [ -e "$KEYFILE" ]; then
  echo "Existing local keystore found; it will NOT be replaced."
  read -r -s -p "Enter its saved signing password: " password
  printf '\n'
  if [ -z "$password" ]; then echo "Password required."; exit 1; fi
else
  password="$(openssl rand -hex 24)"
  echo ""
  echo "SAVE THIS SIGNING PASSWORD IN YOUR PRIVATE IPHONE PASSWORDS APP:"
  echo "$password"
  echo "You must retain it for future app updates. It is shown only here."
  read -r -p "After saving the password, type PASSWORD_SAVED: " answer
  if [ "$answer" != "PASSWORD_SAVED" ]; then
    echo "Cancelled. No keystore or GitHub secrets were created."
    exit 1
  fi
  export LUMA_SETUP_PASSWORD="$password"
  keytool -genkeypair -keystore "$KEYFILE" -storetype PKCS12 \
    -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
    -dname "CN=Luma Android TV, OU=Media Center, O=Personal, C=US" \
    -storepass:env LUMA_SETUP_PASSWORD -keypass:env LUMA_SETUP_PASSWORD -noprompt >/dev/null
  unset LUMA_SETUP_PASSWORD
  chmod 600 "$KEYFILE"
fi
export LUMA_SETUP_PASSWORD="$password"
if ! keytool -list -keystore "$KEYFILE" -storetype PKCS12 \
  -alias "$ALIAS" -storepass:env LUMA_SETUP_PASSWORD >/dev/null 2>&1; then
  unset LUMA_SETUP_PASSWORD
  echo "The local keystore password or alias is incorrect. No secrets were changed."
  exit 1
fi
unset LUMA_SETUP_PASSWORD

echo ""
echo "REQUIRED BACKUP (before writing ANY GitHub secrets):"
echo "In Codespaces Explorer find .luma-private/luma-tv-release.p12"
echo "Download the file and save it to your PRIVATE iCloud Drive or other secure backup."
echo "Store its password separately in the iPhone Passwords app."
echo "Never commit or share the .p12 signing key."
read -r -p "After confirming the keystore backup, type BACKUP_SAVED: " backup
if [ "$backup" != "BACKUP_SAVED" ]; then
  echo "Setup stopped without changing repository secrets."
  echo "Your key remains in .luma-private/. Rerun this script after making a backup."
  exit 1
fi

echo "Encrypting and setting all four GitHub Actions secrets..."
# The dotenv values are sent to gh via stdin and never saved in a repository file.
if ! {
  printf 'LUMA_ANDROID_KEYSTORE_B64=%s\n' "$(base64 -w 0 "$KEYFILE")"
  printf 'LUMA_ANDROID_KEYSTORE_PASSWORD=%s\n' "$password"
  printf 'LUMA_ANDROID_KEY_ALIAS=%s\n' "$ALIAS"
  printf 'LUMA_ANDROID_KEY_PASSWORD=%s\n' "$password"
} | gh secret set --app actions -R "$REPO" -f -; then
  echo "GitHub rejected the secret update. Keep your backup and rerun with the SAME key."
  exit 1
fi
unset password
echo "Checking saved secret names (GitHub never reveals the values)..."
saved="$(gh secret list --app actions -R "$REPO")"
for secret in "${required[@]}"; do
  if ! printf '%s\n' "$saved" | grep -Eq "^${secret}[[:space:]]"; then
    echo "Missing: $secret"
    exit 1
  fi
done
echo "All four signing secrets are set."
echo "Requesting a new owner-signed Android TV build..."
if gh workflow run android-tv-apk.yml --ref main -R "$REPO"; then
  echo "Workflow requested."
else
  echo "Open https://github.com/$REPO/actions/workflows/android-tv-apk.yml"
  echo "Select Run workflow > main to publish the first owner-signed release."
fi
echo "Check: https://github.com/$REPO/actions/workflows/android-tv-apk.yml"
echo ""
echo "The CURRENT debug-signed preview cannot be overwritten with a different certificate."
echo "Export your on-device Luma data, uninstall the old preview, and install the"
echo "FIRST owner-signed APK one time. Later releases use the same key to upgrade."
echo "Keep your iCloud keystore backup and private password permanently."
echo "Delete the temporary Codespace when finished to remove its local copy."
