#!/bin/bash

# Script pour exécuter les tests de charge JMeter
# Usage: ./run-load-test.sh [light|moderate|heavy] [with-report]

# Configuration
TEST_FILE="load-test-jmeter.jmx"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_DIR="load-test-results"
RESULTS_FILE="$RESULTS_DIR/results_$TIMESTAMP.jtl"
LOG_FILE="$RESULTS_DIR/jmeter_$TIMESTAMP.log"
REPORT_DIR="$RESULTS_DIR/report_$TIMESTAMP"

# Créer le répertoire des résultats
mkdir -p "$RESULTS_DIR"

# Paramètres par défaut
TEST_SCENARIO="moderate"
GENERATE_REPORT=0

# Analyser les arguments
case "$1" in
    light)
        TEST_SCENARIO="light"
        ;;
    moderate)
        TEST_SCENARIO="moderate"
        ;;
    heavy)
        TEST_SCENARIO="heavy"
        ;;
    help)
        show_help
        exit 0
        ;;
esac

if [[ "$2" == "report" || "$2" == "with-report" ]]; then
    GENERATE_REPORT=1
fi

# Fonction pour afficher l'aide
show_help() {
    cat << EOF

Usage: ./run-load-test.sh [scenario] [rapport]

Scénarios:
   light      - Test léger (10 utilisateurs)
   moderate   - Test modéré (50 utilisateurs, par défaut)
   heavy      - Test de stress (100+ utilisateurs)

Options:
   with-report   - Générer un rapport HTML (plus lent)
   help          - Afficher cet aide

Exemples:
   ./run-load-test.sh                    (test modéré, sans rapport)
   ./run-load-test.sh light with-report  (test léger avec rapport)
   ./run-load-test.sh heavy with-report  (test de stress avec rapport)

EOF
}

# Afficher le titre
echo ""
echo "============================================"
echo "   Toftal Clip - Test de Charge JMeter"
echo "============================================"
echo ""
echo "Configuration:"
echo "- Scénario: $TEST_SCENARIO"
echo "- Fichier test: $TEST_FILE"
echo "- Résultats: $RESULTS_FILE"
echo "- Rapport: $GENERATE_REPORT"
echo ""

# Vérifier que le backend est accessible
echo "Vérification de la connexion au backend..."
if ! curl -s http://localhost:4000/api/v1/auth/me > /dev/null 2>&1; then
    echo "ERREUR: Le backend n'est pas accessible sur http://localhost:4000"
    echo "Veuillez démarrer le backend avant de lancer le test."
    echo ""
    exit 1
fi
echo "✓ Backend est accessible"

# Vérifier que JMeter est installé
if ! command -v jmeter &> /dev/null; then
    echo "ERREUR: JMeter n'est pas installé ou n'est pas dans le PATH"
    echo "Installez JMeter: https://jmeter.apache.org/download_jmeter.cgi"
    echo ""
    exit 1
fi
echo "✓ JMeter est installé"
echo ""

echo "Lancement du test..."
echo ""

# Exécuter le test
if [[ $GENERATE_REPORT -eq 1 ]]; then
    # Avec rapport HTML
    jmeter -n -t "$TEST_FILE" -l "$RESULTS_FILE" -j "$LOG_FILE" -e -o "$REPORT_DIR"
else
    # Sans rapport HTML (plus rapide)
    jmeter -n -t "$TEST_FILE" -l "$RESULTS_FILE" -j "$LOG_FILE"
fi

echo ""
echo "============================================"
echo "   Test Terminé"
echo "============================================"
echo ""
echo "Résultats:"
echo "- Fichier JTL: $RESULTS_FILE"
echo "- Log: $LOG_FILE"

if [[ $GENERATE_REPORT -eq 1 ]]; then
    echo "- Rapport HTML: $REPORT_DIR/index.html"
    echo ""

    # Ouvrir le rapport si possible
    if command -v xdg-open &> /dev/null; then
        echo "Ouverture du rapport..."
        xdg-open "$REPORT_DIR/index.html" &
    elif command -v open &> /dev/null; then
        echo "Ouverture du rapport..."
        open "$REPORT_DIR/index.html" &
    fi
fi

echo ""
echo "Résumé des résultats:"
echo "====================="
echo ""

# Extraire et afficher quelques statistiques
if [[ -f "$RESULTS_FILE" ]]; then
    echo "Nombre total de requêtes: $(grep -c "success" "$RESULTS_FILE")"

    # Si les résultats contiennent des données
    if grep -q "\"true\"" "$RESULTS_FILE"; then
        SUCCESS_COUNT=$(grep -o "\"true\"" "$RESULTS_FILE" | wc -l)
        FAIL_COUNT=$(grep -o "\"false\"" "$RESULTS_FILE" | wc -l)
        TOTAL=$((SUCCESS_COUNT + FAIL_COUNT))

        if [[ $TOTAL -gt 0 ]]; then
            ERROR_RATE=$(echo "scale=2; $FAIL_COUNT * 100 / $TOTAL" | bc)
            echo "Requêtes réussies: $SUCCESS_COUNT ($((100 - ${ERROR_RATE%.*}))%)"
            echo "Requêtes échouées: $FAIL_COUNT (${ERROR_RATE}%)"
        fi
    fi
fi

echo ""
echo "Pour analyser les résultats en détail:"
if [[ $GENERATE_REPORT -eq 1 ]]; then
    echo "- Ouvrir le rapport HTML: $REPORT_DIR/index.html"
fi
echo "- Ou utiliser JMeter GUI: jmeter -t $TEST_FILE"
echo ""

exit 0
