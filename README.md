# Mon Coach – Tableau de bord Garmin

Dashboard web qui lit vos exports Garmin Connect (ZIP/RAR) et affiche
sommeil, activités, stress et fréquence cardiaque.

---

## Installation rapide

### 1. Prérequis système

**Ubuntu / Debian**
```bash
sudo apt install libarchive13 python3 python3-pip
```

**macOS (Homebrew)**
```bash
brew install libarchive python
```

**Windows**
- Installez Python 3.10+ depuis python.org
- Téléchargez `libarchive` via vcpkg ou installez 7-Zip (qui fournit `libarchive.dll`)

---

### 2. Installer les dépendances Python

```bash
cd garmin_app
pip install -r requirements.txt
```

---

### 3. Lancer le serveur

```bash
python app.py
```

Puis ouvrir **http://localhost:5000** dans votre navigateur.

---

## Utilisation

1. Allez sur **Garmin Connect** → Profil → Paramètres → Données & Confidentialité → **Exporter mes données**
2. Téléchargez le fichier `.zip` ou `.rar` reçu par e-mail
3. Dans le dashboard, cliquez **Importer ZIP / RAR** et déposez le fichier
4. Le tableau de bord se met à jour automatiquement avec vos vraies données

---

## Structure du projet

```
garmin_app/
├── app.py              ← Backend Flask (parseur Garmin + API)
├── requirements.txt
├── README.md
└── templates/
    └── index.html      ← Frontend (HTML + Chart.js)
```

---

## Données lues depuis l'export Garmin

| Fichier | Données extraites |
|---|---|
| `DI-Connect-Aggregator/UDSFile_*.json` | Pas, calories, FC min/max, stress |
| `DI-Connect-Fitness/*_summarizedActivities.json` | Course, vélo, yoga… |
| `DI-Connect-Wellness/*_sleepData.json` | Sommeil profond/léger/REM/éveil |
| `customer_data/customer.json` | Prénom, date de naissance |

---

## Notes

- Tout le traitement est **local** : aucun fichier n'est envoyé sur internet.
- Le fichier RAR est lu via **libarchive** (ctypes, sans binaire externe).
- Les fichiers ZIP sont lus nativement avec le module `zipfile` de Python.
