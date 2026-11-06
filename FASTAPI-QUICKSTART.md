# ShikshaSetu FastAPI integration — VS Code on Windows

FastAPI is the active backend used by the existing frontend. The existing Spring Boot source in `backend/` is retained and is not deleted, renamed or rewritten.

## Quick start

1. Install Python 3.11 or newer.
2. Open the **project root** in VS Code (the folder containing `index.html`).
3. Start the backend by double-clicking `START-SHIKSHASETU-FASTAPI.bat`, or open a PowerShell terminal in VS Code and run:

   ```powershell
   .\backend-fastapi\run-fastapi.ps1
   ```

4. On first run, the launcher creates `backend-fastapi/.env` from the safe example file, creates `backend-fastapi/.venv`, installs the Python requirements, and prompts for the initial Super Admin email if it is not already configured. That verified Google email becomes the Super Admin login identity.
5. Complete the one-time Firebase setup in `FIREBASE-SETUP.md`, then restart the backend. Keep the backend terminal running. FastAPI listens at `http://localhost:8000`.
6. Open a second VS Code terminal in the project root and start the frontend:

   ```powershell
   python -m http.server 5500
   ```

7. Open `http://localhost:5500/index.html` in your browser.

## One-time Firebase Google sign-in setup

Follow the steps in `FIREBASE-SETUP.md`. From a VS Code PowerShell terminal at the project root, run `.\backend-fastapi\configure-firebase.ps1` to launch the guided configuration wizard. The frontend obtains the Firebase Web App configuration from FastAPI, signs in with the Firebase JavaScript SDK, and sends the Firebase ID token to FastAPI. The backend verifies the token with Firebase Admin SDK and enforces the existing account role, institution and approval rules. The Google buttons become active only after both the browser configuration and server credentials pass the backend readiness check; the login screen explains any missing setting and includes a **Check again** control.

## Manual PowerShell startup

From the project root:

```powershell
cd backend-fastapi
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:BOOTSTRAP_SUPER_ADMIN_EMAIL = "your-real-super-admin-email@example.com"
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Before manual startup, create `backend-fastapi/.env` from `.env.example` and enter your real Firebase Web App settings plus the Firebase Admin service-account path. The PowerShell launcher performs the first-run `.env` creation and loads it automatically.

Then, in a second terminal from the project root:

```powershell
python -m http.server 5500
```

Health check: `http://localhost:8000/api/health`. Interactive API documentation in development: `http://localhost:8000/api/docs`.

## Database and configuration

The default database is a persistent SQLite file at `backend-fastapi/data/shikshasetu-fastapi.db`. The service creates the required tables at startup. Production deployments must use a managed PostgreSQL database through `DATABASE_URL`; SQLite is intended for local development only.

Optional environment settings:

- `SESSION_HOURS` — session lifetime (1–24 hours; default 8).
- `AI_CHAT_RETENTION_DAYS` — chatbot record retention (1–365 days; default 90).
- `CORS_ORIGINS` — comma-separated frontend origin allowlist.
- `SHIKSHASETU_ENV=production` — disables interactive API documentation.

The initial Super Admin is created only when the bootstrap email does not already exist. Keep its email address; that same verified Google email is used for Super Admin sign-in. Password-based API login and registration endpoints are disabled; use Firebase Google sign-in only. The Super Admin creates institutions and their first Institution Admins using the administrator's Google email; no temporary password is required. Institution Admins and existing students enter their registered email and Institution / Organization ID, then sign in with the matching Google account. New students enter their email and institution ID, verify the same Google account, submit an enrollment request, and wait for approval. Super Admins use their Google email without an institution ID.

## FastAPI responsibilities and limits

- Firebase ID tokens are verified server-side with the Firebase Admin SDK, including provider and revocation checks. Only verified Google email identities can use the new browser sign-in flow. Random bearer tokens are issued to browser sessions; token hashes are stored server-side.
- Institution Admin requests are scoped to that administrator's institution. Students can access only their own student profile and progress.
- Student and administrator progress check-ins use the same central database table.
- Chatbot monitoring consent is separate from acknowledging the institutional privacy notice. The chatbot is unavailable until the student opts in.
- Chat topic and tone indicators are keyword-based cues, not a trained emotion classifier or mental-health assessment.
- KMeans engagement bands use activity metadata only and are descriptive; they must not be used for grades, discipline, or automated student decisions.
- The academic classifier is a separate scikit-learn Random Forest research prototype. It requires an approved labelled CSV and human review. It is not trained on chatbot transcripts.

## Previous Spring Boot backend

The original Spring Boot project remains under `backend/` for preservation and legacy development. The frontend now defaults to FastAPI on port 8000. `api-config.js` migrates a previously saved local `localhost:8080` setting to port 8000 once, while respecting a custom API URL.

For production, deploy FastAPI behind HTTPS, use strong database credentials and a managed database, configure exact trusted CORS origins, protect backups, and establish appropriate institution-specific retention and privacy policies. The local Uvicorn launcher is intended for development, not direct public-internet exposure.
