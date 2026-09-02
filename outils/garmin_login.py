#!/usr/bin/env python3
"""
Genere les tokens Garmin Connect depuis TON PC et les envoie au serveur.

Pourquoi : Garmin bloque (erreur 429) les connexions par mot de passe qui
viennent des IP de datacenter comme Railway. Depuis ta connexion internet
personnelle, le login passe sans probleme. Une fois les tokens envoyes, le
serveur les reutilise et n'a plus jamais besoin de ton mot de passe.

Utilisation (depuis n'importe quel dossier) :
    python "C:\\Users\\Stef\\garmin_app\\garmin_app\\outils\\garmin_login.py"

Le script te demande ton mot de passe (et le code MFA si Garmin en envoie un).
Rien n'est ecrit en clair sur le disque, rien n'est affiche a l'ecran.
"""
import getpass
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

SERVER = os.environ.get(
    "DASHBOARD_URL",
    "https://garmin-dashboard-production-1236.up.railway.app",
).rstrip("/")

PROJECT_DIR = Path(__file__).resolve().parent.parent


def _fix_console_encoding():
    """La console Windows est en cp1252 : force l'UTF-8 pour les accents."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _get_secret():
    """Recupere TOKEN_UPLOAD_SECRET : variable d'env, puis Railway CLI, puis saisie."""
    secret = os.environ.get("TOKEN_UPLOAD_SECRET", "").strip()
    if secret:
        print("Secret d'envoi : pris dans la variable d'environnement.")
        return secret

    # Confort : le lire directement depuis Railway si le CLI est connecte.
    # which() applique PATHEXT sous Windows (railway.cmd), contrairement
    # a un simple subprocess.run(["railway", ...]).
    try:
        railway_exe = shutil.which("railway")
        if not railway_exe:
            raise FileNotFoundError
        out = subprocess.run(
            [railway_exe, "variables", "--json"],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=60,
        )
        if out.returncode == 0:
            data = json.loads(out.stdout)
            secret = (data.get("TOKEN_UPLOAD_SECRET") or "").strip()
            if secret:
                print("Secret d'envoi : recupere automatiquement depuis Railway.")
                return secret
    except Exception:
        pass

    print("\nLe secret est dans Railway > service garmin-dashboard > Variables")
    print("  > TOKEN_UPLOAD_SECRET  (copie-colle sa valeur)")
    return getpass.getpass("Secret d'envoi (la saisie reste invisible) : ").strip()


def _ask_mfa():
    """Garmin demande un code a usage unique (email / SMS / application)."""
    print("\nGarmin demande une validation en deux etapes.")
    return input("Code recu de Garmin : ").strip()


def main():
    _fix_console_encoding()

    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit(
            "Module 'garminconnect' introuvable pour ce Python.\n"
            f"Python utilise : {sys.executable}\n"
            "Installe-le avec :\n"
            f'  "{sys.executable}" -m pip install garminconnect'
        )

    print("=== Generation des tokens Garmin Connect ===\n")
    print("Ton mot de passe reste sur ce PC : il sert uniquement a obtenir")
    print("les tokens, et n'est ni enregistre ni transmis au serveur.\n")

    email = input("Email Garmin : ").strip()
    if not email:
        sys.exit("Email requis.")
    print("Mot de passe (la saisie reste invisible, tape puis Entree) :")
    password = getpass.getpass("> ")
    if not password:
        sys.exit("Mot de passe requis.")

    tokens_dir = Path(tempfile.mkdtemp(prefix="garmin_tokens_"))
    try:
        print("\nConnexion a Garmin Connect...")
        try:
            client = Garmin(email=email, password=password, prompt_mfa=_ask_mfa)
        except TypeError:
            # Versions plus anciennes de garminconnect, sans prompt_mfa
            client = Garmin(email=email, password=password)
        try:
            # garminconnect 0.3.x enregistre lui-meme les tokens dans ce dossier
            client.login(str(tokens_dir))
        except Exception as e:
            detail = f"{type(e).__name__}: {e}"
            if "429" in detail or "TooManyRequests" in detail or "rate limit" in detail.lower():
                sys.exit(
                    "\nGarmin limite les connexions depuis ce PC aussi (429).\n"
                    "Attends 2 a 3 heures SANS reessayer, puis relance ce fichier.\n"
                    "Chaque tentative pendant le blocage prolonge le blocage."
                )
            sys.exit(f"\nEchec de la connexion : {detail}")

        # Filet : 0.2.x expose .garth, 0.3.x expose .client
        if not list(tokens_dir.glob("*.json")):
            for attr in ("client", "garth"):
                obj = getattr(client, attr, None)
                if obj is not None and hasattr(obj, "dump"):
                    try:
                        obj.dump(str(tokens_dir))
                        break
                    except Exception:
                        pass

        files = {p.name: p.read_text(encoding="utf-8") for p in tokens_dir.glob("*.json")}
        if not files:
            sys.exit(
                "Aucun token genere : la connexion n'a pas abouti.\n"
                "Si des messages 429 sont apparus ci-dessus, attends 2 a 3 h puis reessaie."
            )

        # Verifier que les tokens fonctionnent vraiment avant de les envoyer
        try:
            client.get_full_name()
            print("Connexion verifiee aupres de Garmin.")
        except Exception as e:
            sys.exit(
                f"Les tokens ont ete ecrits mais Garmin refuse encore les appels "
                f"({type(e).__name__}). Attends 2 a 3 h puis relance ce fichier."
            )
        print(f"Tokens generes : {', '.join(sorted(files))}")

        secret = _get_secret()
        if not secret:
            sys.exit("Secret requis pour l'envoi.")

        print(f"\nEnvoi vers {SERVER} ...")
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
            body = e.read().decode("utf-8", "replace")
            if e.code == 403:
                sys.exit("Secret refuse par le serveur : verifie TOKEN_UPLOAD_SECRET dans Railway.")
            sys.exit(f"Refus du serveur ({e.code}) : {body}")
        except urllib.error.URLError as e:
            sys.exit(f"Serveur injoignable : {e.reason}")

        if result.get("ok"):
            print(f"\nOK - tokens installes sur le serveur : {', '.join(result['written'])}")
            print("Lance maintenant la sync depuis l'app (bouton 'Sync Garmin Connect').")
        else:
            sys.exit(f"Echec : {result.get('error')}")
    finally:
        # Ne jamais laisser trainer de tokens sur le disque
        for p in tokens_dir.glob("*"):
            try:
                p.unlink()
            except OSError:
                pass
        try:
            tokens_dir.rmdir()
        except OSError:
            pass


if __name__ == "__main__":
    main()
