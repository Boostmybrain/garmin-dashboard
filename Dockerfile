FROM python:3.11-slim

WORKDIR /app

# Installer unrar pour les exports Garmin en .rar
RUN apt-get update && apt-get install -y unrar-free && rm -rf /var/lib/apt/lists/*

# Installer les dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copier le projet
COPY . .

# Créer le dossier de données persistant
RUN mkdir -p /data/meals

EXPOSE 8080

CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT:-8080} --workers 2 --timeout 120"]
