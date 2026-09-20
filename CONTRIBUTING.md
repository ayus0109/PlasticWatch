# Contributing to PlasticWatch

Thank you for your interest in contributing to **PlasticWatch**! We are committed to building an honest, ethical, and high-impact AI-GIS platform for tackling plastic waste hotspots.

---

## 📜 Code of Conduct & Core Ethics

Before contributing, please note the non-negotiable principles governing this repository:

1. **Human-in-the-Loop:** AI models detect and prioritize; they never have the final word. Hotspots and cleanup gates require human verification.
2. **Zero Blame Attribution:** The platform identifies the *presence* of waste, never *who* deposited it.
3. **Honest Data Semantics:** Simulated vs. real telemetry must always be clearly distinguished. Never fabricate ground truth.

---

## 🛠️ Getting Started

### Prerequisites
- **Node.js**: >= 20.x
- **Python**: >= 3.11
- **Docker & Docker Compose** (for running PostGIS & the API backend)

### Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ayus0109/PlasticWatch.git
   cd PlasticWatch
   ```

2. **Backend Setup:**
   ```bash
   cp .env.example .env
   # Start the database and API services
   docker compose up -d --build
   # Verify health check
   curl http://localhost:8000/health
   ```

3. **Frontend Setup:**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---

## 🌿 Branching & Commit Conventions

- Create feature branches off `main`:
  ```bash
  git checkout -b feat/your-feature-name
  ```
- We follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat(scope): ...` for new features
  - `fix(scope): ...` for bug fixes
  - `docs(scope): ...` for documentation changes
  - `refactor(scope): ...` for code structure improvements without behavior change

---

## 🧪 Testing & Verification

Before submitting a Pull Request, ensure all checks pass:

- **Frontend Build & Types:**
  ```bash
  cd frontend
  npm run build
  ```
- **Backend Linting:**
  ```bash
  ruff check backend/app
  ```

---

## 📬 Submitting a Pull Request

1. Push your branch to GitHub.
2. Open a Pull Request against `main`.
3. Complete the PR template checklist.
4. CI checks will run automatically to verify builds and linting.
