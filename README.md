# ShikshaSetu — Institution-Controlled AI Student Workspace

The existing vanilla HTML/CSS/JavaScript interface, moss/forest assets, academic workspace and previous Spring Boot source are preserved. **FastAPI is now the active backend connected to the frontend.**

## Start here
- `index.html` — login and student enrollment request.
- `dashboard.html` — existing student / academic workspace.
- `institution-admin.html` — institution administrator console.
- `super-admin.html` — platform institution provisioning and academic model management.
- `privacy-notice.html` — student data and chatbot monitoring notice.
- `backend-fastapi/` — active FastAPI backend, SQLAlchemy persistence, authentication, tenant isolation, chatbot records and ML endpoints.
- `backend/` — preserved Spring Boot backend source; it is no longer the frontend's default API.
- `campus-visual-polish.css` and `assets/card-edge-leaves.svg` — additive glass / edge foliage theme refinement.

## Run in VS Code on Windows

1. Install Python 3.11 or newer.
2. Open the project root in VS Code.
3. Run `START-SHIKSHASETU-FASTAPI.bat` from File Explorer or follow [FASTAPI-QUICKSTART.md](FASTAPI-QUICKSTART.md).
4. In a second terminal, from the project root, run `python -m http.server 5500`.
5. Open `http://localhost:5500/index.html`.

FastAPI runs at `http://localhost:8000`; health is at `/api/health` and development API docs at `/api/docs`. The first run prompts for a Super Admin email and a unique password of at least 14 characters. The default local database is `backend-fastapi/data/shikshasetu-fastapi.db`.

## Backend and data flow

The frontend defaults to `http://localhost:8000`. `api-config.js` updates a saved local `localhost:8080` API URL to the FastAPI port once, while respecting custom URLs. The existing `backend/` source is kept intact and may still be run separately if required, but do not start both services on the same API port.

The FastAPI service provides platform Super Admin, Institution Admin and Student roles. Institution admins only query their own tenant; students access their own student profile and progress. Enrollment is approval-gated. Student and administrator progress check-ins share a central database table. Session tokens are random bearer tokens whose hashes are stored server-side; passwords use Argon2.

Chatbot use requires explicit monitoring consent separate from accepting the institutional privacy notice. Topic and emotional-tone cues are transparent keyword estimates, not clinical/psychological diagnoses. Admin transcript review requires a reason and is audited. Chat records expire under `AI_CHAT_RETENTION_DAYS` (90 days by default). KMeans engagement groups use usage metadata only and are descriptive, not ability, wellbeing or academic-risk labels. The separate scikit-learn Random Forest is a research prototype requiring institution-approved labelled training data and human review. It is not trained on chatbot conversations.

## Theme update

The existing layout and design components are retained. The new last-loaded stylesheet makes card surfaces translucent and confines leaf illustrations to card edges, leaving the central text area clean. Light mode uses a richer emerald / mint palette and contrast hierarchy while dark mode retains its forest-emerald character.

## Verification

- FastAPI end-to-end test: institution setup, student enrollment approval, student progress synchronization, chatbot consent, analytics and cross-tenant isolation.
- JavaScript syntax, HTML parsing and local asset references are checked for the frontend.
- The former Spring backend source is retained; FastAPI is the active API for this release.

For production, deploy behind HTTPS, set a strong database URL/credential, configure exact `CORS_ORIGINS`, protect database backups, and establish institution-specific retention and privacy policies. The bundled local Uvicorn command is for development, not an internet-facing production server.


Authentication: Firebase Google sign-in setup is documented in `FIREBASE-SETUP.md`.

## FastAPI backend hardening

See [`FASTAPI-BACKEND-HARDENING.md`](FASTAPI-BACKEND-HARDENING.md) for the API security controls, migration lifecycle, local setup, production deployment requirements and remaining operational limits. Firebase Google sign-in readiness is checked by FastAPI and reported on the login card.
