<div align="center">

<img src="frontend/public/logo.png" alt="PlasticWatch Logo" width="200" />

# PlasticWatch
### AI-GIS Detection & Ethical Prioritisation of Plastic-Waste Hotspots

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Render-10b981?style=for-the-badge&logo=render&logoColor=white)](https://plasticwatch-1.onrender.com)
[![CI](https://img.shields.io/badge/CI-Passing-2ea44f?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/ayus0109/PlasticWatch/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com)
[![React 19](https://img.shields.io/badge/React%2019-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgis.net/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)

[**Explore Live Demo »**](https://plasticwatch-1.onrender.com) · [Report Bug](https://github.com/ayus0109/PlasticWatch/issues) · [Request Feature](https://github.com/ayus0109/PlasticWatch/issues) · [API Documentation](https://plasticwatch-1.onrender.com/docs)

</div>

---

## 📖 Overview

**PlasticWatch** is an open-source, eco-GIS environmental intelligence platform that pinpoints, ranks, and tracks plastic waste hotspots in real time.

By combining lightweight Computer Vision (trained on the open [TACO](https://tacodataset.org/) dataset with OpenCV fallback) and PostGIS spatial clustering, citizen photos fuse into unified geographical hotspots ranked by ecological urgency (proximity to storm drains, water bodies, and amenities).

> [!IMPORTANT]
> **Core Ethical Law:** Reports show waste is present — **never who is responsible**. Nothing is verified or resolved until a human authority confirms evidence. The AI model guides prioritization; it never has the final word.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph Citizen["📱 Citizen (Locals)"]
        A[Capture Photo + Geotag] --> B[Client Auto-Compression]
        B --> C[Submit Report]
    end

    subgraph AI["🧠 AI Detection & GIS Pipeline"]
        C --> D[YOLOv8 + OpenCV Saliency Detector]
        D --> E[Classify likely plastic: Bottle, Film, Cup, Frag]
        E --> F[PostGIS Spatio-Temporal Clustering]
        F --> G[Rank Hotspot by Proximity to Drains & Water]
    end

    subgraph Gov["🛡️ Authority (Government)"]
        G --> H[Live GIS Tactical Map & KPI Dashboard]
        H --> I[Human Verification Gate]
        I --> J[Dispatch Cleanup Task & Route Optimization]
        J --> K[After-Photo Quality Review]
        K --> L{Human Decision}
        L -->|Approved| M[Hotspot Resolved]
        L -->|Rejected| N[Re-dispatch Cleanup]
    end

    style Citizen fill:#f0fdf4,stroke:#16a34a,stroke-width:1.5px
    style AI fill:#f8fafc,stroke:#0284c7,stroke-width:1.5px
    style Gov fill:#f0fdfa,stroke:#0d9488,stroke-width:1.5px
```

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **📸 Citizen Reporting** | Fast, mobile-first photo upload with auto GPS tagging, client-side EXIF reading, and instant bounding-box inference. |
| **🧠 Dual-Engine AI Detection** | YOLOv8 neural network mapped to standardized plastic categories with OpenCV contour/saliency fallback for crushed and fragmented waste. |
| **🗺️ Spatio-Temporal GIS Clustering** | Merges duplicate proximate reports into a single living hotspot using PostGIS spatial algorithms (`ST_DWithin`, GiST indexing). |
| **🌊 Eco-Impact Ranking** | Scores each hotspot automatically by distance to waterways, storm drains, schools, and civic amenities. |
| **🛡️ Tactical Authority Dashboard** | High-performance interactive Leaflet GIS map, prioritized triage queue, cleanup dispatch with route optimization, and human verification gates. |
| **🌗 Adaptive Theme Engine** | Eco-GIS palette engineered for bright outdoor field sunlight (Light Mode) and low-light control rooms (Dark Mode). |

---

## 🌐 UN Sustainable Development Goals (SDGs)

PlasticWatch directly contributes to three UN Sustainable Development Goals:
- **SDG 11: Sustainable Cities and Communities** — Reducing urban plastic accumulation and preventing drain blockages.
- **SDG 12: Responsible Consumption and Production** — Monitoring real-world single-use packaging leakage.
- **SDG 14: Life Below Water** — Intercepting plastic waste at urban drain corridors before it reaches oceans and rivers.

---

## 🛠️ Tech Stack

### Frontend
- **Framework:** React 19 + TypeScript + Vite
- **Styling:** Tailwind CSS + Lucide Icons + Eco-GIS Design System
- **Mapping:** Leaflet + React-Leaflet with custom vector canvas markers
- **State & Networking:** Lightweight resilient fetch client with exponential backoff & auto-reauth

### Backend & AI
- **Framework:** FastAPI (Python 3.11)
- **Database:** PostgreSQL 16 + PostGIS 3.4 (SQLAlchemy Core, async connection pool)
- **Computer Vision:** Ultralytics YOLOv8 + OpenCV Saliency Engine
- **Spatial Routing:** OpenRouteService API integration for cleanup dispatch optimization

### Infrastructure & DevOps
- **Deployment:** Render (Blueprint-as-Code via `render.yaml`)
- **Containers:** Docker Compose (Multi-container PostGIS + FastAPI stack)
- **CI / Quality:** GitHub Actions automated typecheck, build, and Ruff linter

---

## 🚀 Quickstart

### Option 1: Docker (Recommended)

Requires **Docker Desktop** installed and running.

```bash
# 1. Clone repository
git clone https://github.com/ayus0109/PlasticWatch.git
cd PlasticWatch

# 2. Configure environment
cp .env.example .env

# 3. Launch database and API
docker compose up -d --build

# 4. Verify API health
curl http://localhost:8000/health
# Expected: {"status":"ok","postgis":true}
```

Interactive API documentation available at: **<http://localhost:8000/docs>**

### Option 2: Local Frontend Development

```bash
cd frontend
npm install
npm run dev
# App will run at http://localhost:5173
```

---

## 📂 Repository Structure

```
PlasticWatch/
├── .github/                  # GitHub Actions CI workflows & issue templates
├── backend/
│   ├── app/
│   │   ├── routers/          # FastAPI API route handlers (auth, hotspots, reports)
│   │   ├── services/         # AI detector, GIS clustering, impact scorer
│   │   ├── sql/              # Schema & spatial migrations (schema.sql)
│   │   ├── config.py         # Type-safe environment settings
│   │   └── schemas.py        # Pydantic data models & frozen API contracts
│   └── tests/                # Automated pytest contract & unit tests
├── frontend/
│   ├── src/
│   │   ├── api/              # Resilient HTTP client & hooks
│   │   ├── components/       # UI design system (Shell, Map, Icons, Cards)
│   │   ├── pages/            # Login, Report, MyReports, Authority Dashboard
│   │   └── lib/              # Eco-GIS palette & status formatting
│   └── public/               # Favicons, vector brand assets, 404 fallback
├── gis/                      # Overpass OSM downloaders & spatial seed scripts
├── ml/                       # TACO dataset prep, converter & evaluation scripts
├── docs/                     # Technical specifications, user journeys & demo guide
├── docker-compose.yml        # Multi-container PostGIS + API orchestration
├── render.yaml               # Infrastructure blueprint for automated cloud deploy
└── CLAUDE.md                 # Architectural constitution & core project tenets
```

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before submitting pull requests.

```bash
# Run frontend checks
cd frontend && npm run build

# Run backend linter
ruff check backend/app
```

---

## 🔒 Security

For responsible disclosure of security vulnerabilities, please refer to [SECURITY.md](SECURITY.md).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Geo data © [OpenStreetMap](https://www.openstreetmap.org/) contributors.
Detection trained on open [TACO](https://tacodataset.org/) annotations.
