> **Backend update:** The current delivery adds `backend-fastapi/` as the active API and points the existing frontend to port 8000. The Spring Boot source described in this historical design note remains preserved under `backend/`. Current startup instructions are in `FASTAPI-QUICKSTART.md`.

# ShikshaSetu — Institutional Campus Portal Upgrade

## What changed

This upgrade retains the existing vanilla HTML/CSS/JavaScript workspace and Java 21 / Spring Boot 3.5.6 / Spring Data JPA / MySQL-H2 / Weka stack. It adds an institution-controlled tenant layer rather than replacing the application.

### Roles and workspace lifecycle

- **Super Admin** provisions institutions, creates each institution's first administrator, activates/suspends tenants, and controls the existing platform-level Weka academic model.
- **Institution Admin** sees only their institution's records, approves/rejects enrollment, suspends/restores student accounts, edits institution settings, views progress and chatbot analytics, and may review retained conversations. Review events are audited.
- **Student** registers with an institutional access code. Registration creates a pending account; access is unavailable until the Institution Admin approves the request and the server creates the linked student record.

An institution is a logically isolated tenant/workspace in the shared application and database. This is not a separately provisioned physical server or container for each college. Tenant scoping is enforced by server-side role/session checks and institution IDs on records.

### Central data and synchronization

Student progress check-ins are saved through `POST /api/my/progress` into `student_progress_checkins`, with institution, student and submitting user relationships. Institution dashboards read the same central rows through `/api/institution-admin/progress`; they refresh on demand, focus and a 30-second polling interval. The main dashboard refreshes server data after actions and periodically. Profile changes update both the portal account and linked Student record. Academic records and approved administrative updates remain in the existing central tables.

Student-submitted progress is self-reported. Official academic marks and dated academic trends remain administrator-controlled so self-reported values cannot silently become institutional academic records or model labels.

### Emotion-friendly chatbot and privacy

The student companion now calls the authenticated backend (`POST /api/chat/interactions`). It responds with supportive templates for confused, frustrated, stressed and positive language, plus academic-topic guidance. This is a transparent keyword-rule system, not a generative LLM or a clinically validated emotion classifier. It does not diagnose mental health conditions.

Students acknowledge the institutional privacy notice during registration. Separately, chatbot monitoring consent is optional: a student may register and enter the campus workspace without enabling the chatbot. Chatbot access remains paused until the student opts in, and withdrawing consent from the profile pauses subsequent chatbot use. Administrators can review retained transcripts only within their own institution. Opening the transcript review records an audit event. Chat rows are automatically deleted at `expires_at`; default retention is 90 days and the application setting is clamped to 7–365 days. The new `privacy-notice.html` explains the current behavior.

### ML analytics

- The existing Weka Random Forest academic-deterioration model remains separate and unchanged in purpose. Training remains restricted to Super Admin.
- A second Weka component uses `SimpleKMeans` to group student chatbot activity from interaction count, active days, topic breadth and average message length. It does not use transcript text or sentiment labels as clustering features. It requires at least three active student accounts in the institution and period; otherwise the result is `INSUFFICIENT_COHORT_DATA`.
- Chat topics and emotional-tone cues are keyword estimates, not trained classifiers. Usage activity bands are descriptive and must not be used as ability, wellbeing or risk labels.

## Files added

- `institution-admin.html`, `institution-admin.js`, `super-admin.html`, `super-admin.js`, `institution-portal.css`
- `privacy-notice.html`
- New model, repository, portal, service and controller classes under `backend/src/main/java/com/shikshasetu/`
- `backend/src/test/java/com/shikshasetu/portal/PortalPasswordHasherTest.java`
- `backend/src/test/java/com/shikshasetu/service/EmpatheticChatServiceTest.java`

Existing project files, theme resources, images, dashboards and Weka training code are retained. Existing controllers were changed only where needed for tenant scoping, authenticated access and deletion integrity.

## Local setup (Windows PowerShell)

1. Extract the project ZIP. Open the extracted project root in VS Code.
2. Configure the initial platform Super Admin **before first startup**. Use a unique password with at least 14 characters:

```powershell
$env:BOOTSTRAP_SUPER_ADMIN_EMAIL = "platform-admin@example.edu"
$env:BOOTSTRAP_SUPER_ADMIN_PASSWORD = "Use-A-Unique-Long-Password-Here"
```

3. Start the backend from the `backend` directory:

```powershell
mvn clean test
mvn spring-boot:run "-Dspring-boot.run.profiles=dev"
```

The `dev` profile uses a persistent H2 file at `backend/data/shikshasetu.mv.db`. The default profile uses MySQL; configure `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD` first.

4. Serve the project root with VS Code Live Server or:

```powershell
python -m http.server 5500
```

5. Open `http://localhost:5500/index.html`, sign in with the bootstrapped Super Admin, create an institution and its first administrator, and securely deliver the temporary administrator password and institution access code. The student registers using that code and waits for approval.

Bootstrap happens only when the configured Super Admin email does not already exist. There are no hard-coded default credentials. If no bootstrap email and password are supplied, the platform does not create a Super Admin automatically.

## Existing data migration

At startup the tenant migration creates an inactive `LEGACY-RECORDS` institution and assigns existing students without an institution ID to it. This prevents older unscoped records from appearing in a newly created college workspace. Super Admin can still inspect platform-wide records. Moving legacy students into a new institution requires a deliberate data migration; the portal does not automatically guess which college owns an old record.

Hibernate `ddl-auto=update` creates the new tables/relationships for this project. For production deployments, replace automatic schema updates with a reviewed migration process.

## Configuration

| Environment variable | Purpose | Default |
|---|---|---|
| `DB_URL` | MySQL JDBC URL | `jdbc:mysql://localhost:3306/shikshasetu?createDatabaseIfNotExist=true` |
| `DB_USERNAME` | Database username | `root` |
| `DB_PASSWORD` | Database password | `root` |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | Initial platform administrator | empty (disabled) |
| `BOOTSTRAP_SUPER_ADMIN_PASSWORD` | Initial platform administrator password; 14+ characters | empty (disabled) |
| `PORTAL_SESSION_HOURS` | Absolute session lifetime (1–24 hours) | 8 |
| `CHAT_RETENTION_DAYS` | Chat retention (7–365 days) | 90 |
| `PORTAL_ALLOWED_ORIGINS` | Comma-separated trusted frontend origin patterns | loopback development origins |

CORS defaults to loopback development origins. Configure `PORTAL_ALLOWED_ORIGINS` as a comma-separated explicit allowlist of trusted frontend origins before deployment (for example, `https://portal.college.edu`).

## Security and production limitations

This is an application upgrade and development baseline, not a production security certification. Before handling real student records, an institution must deploy HTTPS, database encryption at rest and encrypted backups, secret management, production CORS allowlists, rate limiting / abuse controls, reviewed schema migrations, operational monitoring, incident response, privacy/legal review, data-subject request processes and tested backup/restore procedures. The app hashes passwords and opaque session tokens, checks role and tenant ownership on API requests, revokes sessions on suspension, logs sensitive administrative actions and applies chat retention, but these controls do not replace the deployment measures above.

The app has no email verification, self-service password reset, SMS/OTP MFA, staffed emergency response or generative LLM integration. The local keyword-based supportive companion must not be presented as professional mental-health care. The Weka Random Forest is a research prototype; its training guardrails are not evidence of statistical sufficiency, and it needs temporal/external validation, calibration, subgroup/fairness review and human governance before operational use.

## Verification performed for this package

The package is checked for retention of all source archive entries, JavaScript syntax, HTML structure, local references, and selected JDK-only password-hasher behavior. Backend Maven tests and a full Spring/Hibernate integration run must be executed in an environment with Maven and dependency-repository access; they are not claimed as passed by this delivery.
