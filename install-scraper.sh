#!/bin/bash
# install-scraper.sh
# Installeert de WWSpeur scraper bestanden vanuit ~/Downloads/claude
#
# Gebruik: bash install-scraper.sh

PROJECT_DIR="$HOME/OneDrive/src/WWspeur"
ZIP_FILE="$HOME/Downloads/claude/wwspeur-scraper.zip"

# Check of zip bestaat
if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Zip niet gevonden: $ZIP_FILE"
    exit 1
fi

# Check of projectmap bestaat
if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ Projectmap niet gevonden: $PROJECT_DIR"
    exit 1
fi

echo "📦 Installeren naar: $PROJECT_DIR"
echo ""

# Uitpakken met overschrijven, behoud mapstructuur
unzip -o "$ZIP_FILE" -d "$PROJECT_DIR"

echo ""
echo "✅ Geïnstalleerd! Nieuwe/gewijzigde bestanden:"
echo "   - backend/app/collectors/scraper.py  (HTML spider + data extractie)"
echo "   - backend/app/services/scan_service.py (scan orchestratie)"
echo "   - backend/app/api/scans.py (API endpoint met background tasks)"
echo ""
echo "🧪 Test de scraper standalone:"
echo "   cd $PROJECT_DIR/backend"
echo "   pip install requests beautifulsoup4 lxml"
echo "   python -m app.collectors.scraper https://example.com 10"
