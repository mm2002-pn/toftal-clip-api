#!/bin/bash

# Script pour créer les utilisateurs de test en production via Cloud SQL Proxy
# Usage: ./scripts/create-test-users-prod.sh

echo "🚀 Création des utilisateurs de test en production"
echo "=================================================="
echo ""

# Variables Cloud SQL (à adapter)
PROJECT_ID="toftal-clip-api"
INSTANCE_NAME="toftal-clip-db"  # Remplacer par le nom de votre instance
REGION="europe-west1"           # Remplacer par votre région

# Connection string format for Cloud SQL Proxy
INSTANCE_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${INSTANCE_NAME}"

echo "📍 Instance Cloud SQL: ${INSTANCE_CONNECTION_NAME}"
echo ""

# Vérifier si cloud-sql-proxy est installé
if ! command -v cloud-sql-proxy &> /dev/null; then
    echo "❌ cloud-sql-proxy n'est pas installé"
    echo "Installation:"
    echo "  wget https://dl.google.com/cloudsql/cloud_sql_proxy.linux.amd64 -O cloud-sql-proxy"
    echo "  chmod +x cloud-sql-proxy"
    echo "  sudo mv cloud-sql-proxy /usr/local/bin/"
    exit 1
fi

# Démarrer le proxy en arrière-plan
echo "🔌 Démarrage du Cloud SQL Proxy..."
cloud-sql-proxy --port=5433 ${INSTANCE_CONNECTION_NAME} &
PROXY_PID=$!

echo "✅ Proxy démarré (PID: ${PROXY_PID})"
echo "⏳ Attente de la connexion..."
sleep 5

# Exécuter le script avec la connexion proxy
echo "📝 Création des utilisateurs..."
echo ""

# Remplacer DATABASE_URL pour utiliser le proxy (port 5433)
export DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5433/DATABASE_NAME?schema=public"
export ALLOW_TEST_USERS_IN_PROD=true
export NODE_ENV=production

npx ts-node scripts/create-test-users.ts

# Arrêter le proxy
echo ""
echo "🛑 Arrêt du proxy..."
kill $PROXY_PID

echo "✅ Terminé!"
