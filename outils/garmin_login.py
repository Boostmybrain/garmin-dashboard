#!/usr/bin/env python3
"""
Génère les tokens Garmin Connect depuis TON PC et les envoie au serveur.

Pourquoi : Garmin bloque (erreur 429) les connexions par mot de passe qui
viennent des IP de datacenter comme Railway. Depuis ta connexion internet
personnelle, le login passe sans problème. Une fois les tokens envoyés, le
serveur les réutilise et n'a plus jamais besoin de ton mot de passe.

Utilisation :
    pip install garminconnect
    python outils/garmin_login.py

Le script te demande ton mot de passe (et le code MFA si Garmin en envoie un).
Rien n'est écrit sur le disque en clair, rien n'est affiché à l'écran.
"""
import getpass
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

SERVER = os.environ.get(
    "DASHBOARD_URL",
    "https://garmin-dashboard-production-1236.up.railway.app",
).rstrip("/")


def main():
    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit("Module manquant. Lance d'abord :  pip install garminconnect")

    print("=== Génération des tokens Garmin Connect ===\n")
    email = input("Email Garmin : ").strip()
    if not email:
        sys.exit("Email requis.")
    password = getpass.getpass("Mot de passe Garmin (invisible) : ")
    if not password:
        sys.exit("Mot de passe requis.")

    tokens_dir = Path(tempfile.mkdtemp(prefix="garmin_tokens_"))
    try:
        print("\nConnexion à Garmin Connect…")
        client = Garmin(email=email, password=password, prompt_mfa=_ask_mfa)
        client.login()
        client.garth.dump(str(tokens_dir))

        files = {p.name: p.read_text(encoding="utf-8") for p in tokens_dir.glob("*.json")}
        if not files:
            sys.exit("Aucun token généré — la connexion a probablement échoué.")
        print(f"Tokens générés : {', '.join(sorted(files))}")

        secret = os.environ.get("TOKEN_UPLOAD_SECRET") or getpass.getpass(
            "\nSecret d'envoi (TOKEN_UPLOAD_SECRET, invisible) : "
        )
        if not secret:
            sys.exit("Secret requis pour l'envoi.")

        print(f"Envoi vers {SERVER} …")
        req = urllib.request.Request(
            f"{SERVER}/api/garmin-tokens",
            data=json.dumps({"files": files}).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Upload-Secret": secret},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.load(resp)
        except urllib.error.HTTPError as e:
            sys.exit(f"Refus du serveur ({e.code}) : {e.read().decode('utf-8', 'replace')}")

        if result.get("ok"):
            print(f"\n✅ Tokens installés sur le serveur : {', '.join(result['written'])}")
            print("Tu peux maintenant lancer la sync depuis l'app (onglet Planning).")
        else:
            sys.exit(f"Échec : {result.get('error')}")
    finally:
        # Ne jamais laisser traîner de tokens sur le disque
        for p in tokens_dir.glob("*"):
            try:
                p.unlink()
            except OSError:
                pass
        try:
            tokens_dir.rmdir()
        except OSError:
            pass


def _ask_mfa():
    """Garmin demande un code à usage unique (email/SMS/app)."""
    return input("Code MFA reçu de Garmin : ").strip()


if __name__ == "__main__":
    main()
