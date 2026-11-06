# ShikshaSetu FastAPI backend — engineering and operations notes

This release keeps the existing FastAPI API, SQLAlchemy data model, institution roles and browser workspaces. It adds a safer local setup path, explicit Firebase readiness checks, database migration tooling and production deployment scaffolding.

## Runtime layout

- `backend-fastapi/app.py` — FastAPI routes, request schemas, tenant-aware authorization, SQLAlchemy models and lifecycle.
- `backend-fastapi/.env` — local secrets and environment-specific configuration; generated from `.env.example` and excluded from the archive/Git.
- `backend-fastapi/data/` — local SQLite database and model artifacts. Do not delete this directory when preserving local records.
- `backend-fastapi/migrations/` — Alembic migration environment and baseline adoption migration.
- `backend-fastapi/tests/` — API integration and configuration-readiness tests.
- `backend-fastapi/Dockerfile` and root `docker-compose.yml` — non-root API container, PostgreSQL service, startup migration and health checks.

## Controls implemented

### Identity and authorization

- Firebase ID tokens are verified by the Firebase Admin SDK with revocation checks.
- Only verified Google-provider identities are accepted.
- A verified email is matched to the existing ShikshaSetu account; the Firebase UID is linked once and protected by a unique index.
- Students and Institution Admins must supply the access code for the same institution already assigned to their account. Super Admins are platform-wide and do not supply an institution code.
- Roles come from the database, never from a browser role selector. Student approvals and tenant isolation continue to be enforced by the API.
- Browser sessions use opaque random bearer tokens; only token hashes are stored in the database. Logout revokes the server-side session.

### Request and data handling

- Pydantic request models reject unexpected fields and enforce length/range limits.
- Validation errors do not echo submitted field values, which could contain private data.
- Each request receives an `X-Request-ID`; API responses use no-store caching and security headers.
- CSV uploads are size-bounded, row-count-bounded, decoded as UTF-8, validated before insertion and committed atomically. Invalid imports do not leave a partly imported class list.
- Database sessions are request-scoped and roll back when a request fails.
- SQLite uses foreign-key enforcement, WAL mode and a busy timeout for local development.

### Abuse resistance and configuration

- Authentication and bulk-import routes use rate limits. The built-in limiter is process-local; it is suitable for the local single-worker setup, not a substitute for a shared Redis/API-gateway limiter in a multi-worker deployment.
- Firebase readiness checks reject example/placeholder values, require the Firebase Admin SDK and check that the service-account file is structurally valid and belongs to the same Firebase project as the Web App configuration.
- Firebase readiness responses expose only public Web App values and boolean/field diagnostics. They never return service-account secrets or private-key contents.
- Production mode requires PostgreSQL, explicit CORS origins, an explicit host allowlist and completed Firebase readiness; API interactive docs are disabled.

## Database lifecycle

Local development uses SQLite at `backend-fastapi/data/shikshasetu-fastapi.db`. Keep that file to preserve user and institution data.

Production uses PostgreSQL and `alembic upgrade head` before Uvicorn starts. The initial `0001_baseline` migration creates missing tables and adopts an existing database without dropping application rows; it adds the nullable Firebase UID field and unique index when needed. Future schema changes must be added as new forward Alembic revisions. Do not rewrite a migration that has already been applied to a shared database.

Before an upgrade, take a database backup and test the migration against a recent backup. Test restore procedures as well as backup creation.

## Local run

From the project root in PowerShell:

```powershell
.\backend-fastapi\run-fastapi.ps1
```

The launcher creates `.env` from `.env.example` if needed, builds `.venv`, installs the pinned dependency ranges, loads environment values and starts the API on `http://localhost:8000`. Configure Firebase before relying on Google sign-in. In a second terminal:

```powershell
python -m http.server 5500
```

Open `http://localhost:5500/index.html`. The login card reports why Google sign-in is not ready and provides a **Check again** action. The diagnostic endpoint is `http://localhost:8000/api/auth/firebase/config`.

## Production deployment requirements

1. Set `SHIKSHASETU_ENV=production` and use PostgreSQL. Do not use the local SQLite file as a multi-instance production database.
2. Set exact `CORS_ORIGINS` and `ALLOWED_HOSTS`; do not use wildcard origins/hosts.
3. Supply Firebase Admin credentials through a managed secret or workload identity. Never commit or upload the service-account JSON to the repository.
4. Terminate TLS at a trusted reverse proxy/load balancer and set trusted proxy headers/forwarded IPs correctly.
5. Use a shared rate limiter (for example Redis or an API gateway) before adding multiple API workers/replicas.
6. Configure structured log collection, uptime/readiness monitoring, error alerting, database backups, restore drills and retention controls.
7. Review the organisation's privacy policy, institutional agreements, retention schedule and access audit process before onboarding real student records.
8. Run dependency scanning, security testing and an independent penetration review before exposing the service publicly.

## What this does not claim

This is a stronger engineering baseline, not a certification or guarantee of production security. It has not undergone an independent penetration test, and the in-process rate limiter is not distributed. Firebase provider enablement, authorised domains, real service-account validity and Google sign-in must be verified against the institution's own Firebase project before release.
