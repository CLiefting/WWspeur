# Webwinkel Investigator

Onderzoek malafide webwinkels door automatisch gegevens te verzamelen en te analyseren.

## Tech Stack

- **Frontend:** React + Vite + TailwindCSS
- **Backend:** Python + FastAPI
- **Database:** PostgreSQL
- **ORM:** SQLAlchemy 2.0

## Project Structuur

```
webwinkel-investigator/
├── backend/
│   ├── app/
│   │   ├── api/            # API endpoints (routes)
│   │   ├── collectors/     # Data verzamel modules (WHOIS, SSL, scraping, KvK)
│   │   ├── core/           # Config, database, security
│   │   ├── models/         # SQLAlchemy database modellen
│   │   ├── schemas/        # Pydantic request/response schemas
│   │   ├── services/       # Business logica
│   │   └── main.py         # FastAPI app entry point
│   ├── database/           # SQL migratie scripts
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   └── src/
│       ├── components/     # Herbruikbare UI componenten
│       ├── pages/          # Pagina componenten
│       ├── services/       # API client services
│       ├── hooks/          # Custom React hooks
│       └── utils/          # Hulpfuncties
└── README.md
```

## Database Schema

### Tabellen
- **users** — Gebruikers met login/authenticatie
- **shops** — Webwinkels die onderzocht worden
- **scans** — Individuele scan-runs per webwinkel
- **whois_records** — WHOIS domeinregistratie gegevens
- **ssl_records** — SSL-certificaat informatie
- **scrape_records** — Gescrapete website gegevens (emails, telefoon, adressen, etc.)
- **kvk_records** — KvK bedrijfsregistratie gegevens

### Elk record bevat:
- **Wat** er gevonden is (de data zelf)
- **Waar** het gevonden is (`source` veld)
- **Wanneer** het gevonden is (`collected_at` veld)

## Setup

### Vereisten
- Python 3.11+
- PostgreSQL 15+
- Node.js 18+

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
cp .env.example .env      # Configureer je .env
```

### Database

```bash
# Maak database aan
createdb webwinkel_investigator

# Voer migratie uit
psql webwinkel_investigator < database/001_initial_schema.sql
```

### Start de backend

```bash
uvicorn app.main:app --reload --port 8000
```

API documentatie beschikbaar op: http://localhost:8000/docs

## Bouwfasen

- [x] Fase 1: Project setup + database schema
- [ ] Fase 2: Backend API basis + authenticatie
- [ ] Fase 3: Webwinkel invoer (URL + CSV)
- [ ] Fase 4: Data collector: WHOIS
- [ ] Fase 5: Data collector: SSL-certificaat
- [ ] Fase 6: Data collector: HTML scraper
- [ ] Fase 7: Data collector: KvK API
- [ ] Fase 8: Risico-score engine
- [ ] Fase 9: Frontend: dashboard + resultaten
- [ ] Fase 10: Frontend: detail-pagina per shop
