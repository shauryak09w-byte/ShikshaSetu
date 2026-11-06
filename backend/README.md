# ShikshaSetu Backend — Spring Boot Institutional Portal

> **Legacy backend notice:** This Spring Boot service has been retained to preserve the original project. The current frontend is configured to use the FastAPI service in `../backend-fastapi/` on port 8000. For current setup instructions, see `../FASTAPI-QUICKSTART.md`. The Spring service below remains available for legacy development and is not the active frontend API.

This backend serves the existing ShikshaSetu frontend and provides the shared persistence and authorization layer for a multi-institution campus portal.

## Stack
- Java 21
- Spring Boot 3.5.6 / Spring Web
- Spring Data JPA + Hibernate
- MySQL for the default profile
- Persistent H2 file database for local development (`dev` profile)
- Weka for the existing academic Random Forest and descriptive chat-activity clustering
- Maven

## Run locally

Requirements: JDK 21+ and Maven 3.9+.

From this `backend` directory, PowerShell:

```powershell
mvn clean test
mvn spring-boot:run "-Dspring-boot.run.profiles=dev"
```

The API listens at `http://localhost:8080`. The `dev` profile uses `./data/shikshasetu` (persistent H2). H2 console: `http://localhost:8080/h2-console`, JDBC URL `jdbc:h2:file:./data/shikshasetu`, user `sa`, blank password. H2 is for local development only.

The default profile uses MySQL. Configure `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` explicitly; do not use sample credentials for a deployment.

## First-time Super Admin setup

Set both environment variables before the first backend start:

```powershell
$env:BOOTSTRAP_SUPER_ADMIN_EMAIL = "platform-admin@example.edu"
$env:BOOTSTRAP_SUPER_ADMIN_PASSWORD = "Use-A-Unique-Secret-Of-At-Least-14-Chars"
```

The bootstrap runner creates one `SUPER_ADMIN` account only when a valid email/password are supplied and the email is not already registered. There is no hard-coded default administrator. Protect and rotate this secret through your deployment secret manager.

## Frontend connection

Serve the project root (the directory containing `index.html`) through a local development server, for example VS Code Live Server or `python -m http.server 5500`. The frontend defaults to `http://localhost:8080`; it can be overridden from the browser console:

```js
localStorage.setItem("shikshasetu-api", "http://localhost:8080");
```

CORS defaults to loopback origins (`localhost` and `127.0.0.1`, any port). For deployment, set `PORTAL_ALLOWED_ORIGINS` to a comma-separated list of trusted frontend origins such as `https://portal.college.edu`; do not use a universal wildcard.

## Authentication and roles

All `/api/**` routes require a server-issued bearer session except `GET /api/health`, `POST /api/auth/login`, and `POST /api/auth/register` (plus CORS preflight). Sign in through `/api/auth/login`, then send:

```http
Authorization: Bearer <token>
```

The raw opaque token is returned once at login; only its SHA-256 hash is stored in the database. Sessions expire after the configured duration (`PORTAL_SESSION_HOURS`, 8 by default; bounded by the server). `/api/auth/logout` revokes the current session. Passwords use PBKDF2-HMAC-SHA256 with a per-password random salt.

Roles:
- `SUPER_ADMIN`: creates and suspends/reactivates institution workspaces; sees the platform institution list; retains platform AI model training permission.
- `INSTITUTION_ADMIN`: manages only their own institution's enrollment, students, settings, activity summaries, progress and audit records.
- `STUDENT`: can access only their own student record, profile, own progress and own chatbot history/analytics. Students cannot write official academic marks/trends or access admin analytics.

Requests for unknown or cross-institution student records return not found rather than disclosing another tenant's records. A suspended institution blocks account login and authenticated requests. The portal uses institution IDs as logical tenant boundaries in a shared application/database; it does not provision separate physical servers or databases per college.

## Institution / enrollment workflow

1. The platform Super Admin creates an institution and its first institution administrator with `POST /api/super-admin/institutions`.
2. The response includes a generated institution access code. Share it only with intended students through a secure channel.
3. Students register with `POST /api/auth/register`; the account is created as `PENDING` and has no student dashboard access.
4. An institution administrator reviews requests at `GET /api/institution-admin/enrollment-requests` and approves/rejects via `POST /api/institution-admin/enrollment-requests/{userId}/decision`.
5. Approval creates the Student row and activates the account. A student can then sign in.

Legacy student records that existed before tenant setup are automatically assigned to an **inactive** `LEGACY-RECORDS` workspace at startup. This avoids exposing unassigned historical rows to a newly created college. A platform administrator should review and explicitly migrate/assign those records before institution users access them.

## Core API groups

| Group | Important routes |
|---|---|
| Health | `GET /api/health` |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `PUT /api/auth/profile`, `POST /api/auth/logout` |
| Super Admin | `GET/POST /api/super-admin/institutions`, `PATCH /api/super-admin/institutions/{id}/status` |
| Institution Admin | `/api/institution-admin/overview`, `/enrollment-requests`, `/students`, `/chat-analytics`, `/chat-interactions`, `/progress`, `/audit-logs`, `/settings` |
| Student self-service | `GET/PUT /api/my/profile`, `GET /api/my/academic-records`, `GET/POST /api/my/progress`, `PUT /api/my/privacy-consent` |
| Chat companion | `POST /api/chat/interactions`, `GET /api/chat/my-analytics`, `GET /api/chat/my-interactions` |
| Student records | `/api/students/**` (tenant and role scoped) |
| Academic AI | `/api/ai/**`, `/api/ai-admin/**` (role and tenant scoped) |
| Other legacy services | `/api/interventions`, `/api/fairness/audit`, `/api/dashboard`, `/api/import/students` (role scoped) |

Students submit self-reported progress via `POST /api/my/progress`; it is persisted centrally and appears in the institution progress feed at `GET /api/institution-admin/progress`. Official academic records and dated academic trend snapshots remain administrator-entered. Existing student, risk, mentor feedback, academic record, manual interpretation and AI assessment records are related to the central Student rows.

## Chat privacy, monitoring and retention

The registration screen links to the institutional privacy notice and explains that chatbot interactions may be reviewed by authorised institution administrators. Privacy-notice acknowledgement is required to request campus access; chatbot monitoring consent is separate and optional. A student can access the rest of the portal without chatbot consent; chatbot use remains paused until consent is granted. Students can view their own usage summaries and interactions and can withdraw consent; withdrawal pauses use of the institutional companion. Institution administrators see tenant-only aggregate analytics. Reading conversation text is a separate endpoint (`GET /api/institution-admin/chat-interactions`) and requires a 10–300 character review reason; the access is written to the institution audit log. Chat retention defaults to 90 days and is configurable with `CHAT_RETENTION_DAYS` (7–365 days). Expired conversation rows are deleted by a scheduled retention job.

The empathetic companion uses transparent keyword/topic/tone rules and supportive response templates. It is not an LLM, not a clinical/emotional diagnosis tool and does not perform crisis intervention. Sensitive/high-risk language is routed toward human support language. The Weka `SimpleKMeans` activity grouping uses metadata features (interaction count, active days, topic breadth and average message length), not message contents. Clusters are descriptive engagement bands, not grades, risk labels or wellbeing scores. The existing Weka Random Forest for academic deterioration is a separate model and requires institution-approved labelled training data.

## Existing academic functionality

- Student profile CRUD and risk assessment/history.
- Dated academic records, early warnings and academic trends.
- Mentor feedback and follow-up outcomes.
- CSV student import (institution administrator only).
- AI Admin interpretation records and fairness reporting.
- Weka Random Forest model status/training and student assessment history.

The transparent baseline risk score remains a review prompt, not a diagnosis or permanent label. The Weka Random Forest is only used when a valid trained artifact is available. Do not fabricate missing training labels or derived attendance/assignment fields.

## Deployment hardening still required

This update adds application-level bearer authentication, PBKDF2 password hashing, role checks, tenant-scoped access, audit events and configurable transcript retention. It is **not a production security certification**. Before using real student data, deploy behind HTTPS, use strong secret management, configure a trusted CORS allowlist, use a secured production database with encryption-at-rest and backups, add rate limiting and account-recovery/email-verification controls, test operational restore procedures, and complete institutional privacy/legal/security review. Secure access to the H2 console and database administration interfaces. Review consent language and retention periods with each institution.

See `INSTITUTIONAL-PORTAL-UPDATE.md`, `AI-ADMIN-API.md`, `STUDENT-SECTION-API.md`, `requests.http`, and `ai-training/README.md` for details.
