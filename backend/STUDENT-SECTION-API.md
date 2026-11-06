# ShikshaSetu Backend — Student Section

The Student workspace uses the shared Spring Boot API and central institution database. Student accounts are not active immediately after registration: an institution administrator must approve the enrollment request before the student can sign in.

## Sign-in, institution enrollment and authorization

1. The student registers with their institution access code using `POST /api/auth/register`.
2. The backend creates a `STUDENT` account with `PENDING` status; no student record/dashboard access is granted yet.
3. An administrator reviews the request. Approval creates the central Student record, links it to the account and activates access.
4. After login, the frontend stores the bearer token in the current browser session and sends `Authorization: Bearer <token>` with protected API requests.

Students can read/update their own account profile, view their own academic records, submit self-reported progress, and view their own retained chatbot usage/history. Students cannot create or edit official academic marks/trend records, view other students' data, access institution analytics or change account roles.

## Student self-service API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Authenticate and receive bearer session (public route) |
| GET | `/api/auth/me` | Resolve authenticated profile and role |
| PUT | `/api/auth/profile` | Update display name and AI companion name |
| POST | `/api/auth/logout` | Revoke current session |
| GET | `/api/my/profile` | Read own linked student profile |
| PUT | `/api/my/profile` | Update permitted own profile details |
| GET | `/api/my/academic-records` | Read own official academic records |
| GET | `/api/my/progress` | Read own progress check-ins |
| POST | `/api/my/progress` | Save a self-reported progress check-in to the central database |
| PUT | `/api/my/privacy-consent` | Grant/withdraw chatbot monitoring consent |
| POST | `/api/chat/interactions` | Send a chatbot message and store interaction metadata/transcript |
| GET | `/api/chat/my-analytics` | Read personal usage summary for the previous 30 days |
| GET | `/api/chat/my-interactions` | Read own retained conversations |

Example protected request:

```http
GET /api/my/profile HTTP/1.1
Host: localhost:8080
Authorization: Bearer <token>
Accept: application/json
```

## Student-to-admin synchronization

`POST /api/my/progress` stores each check-in in the shared `student_progress_checkins` table with institution, student and submitting account IDs. The same saved record appears in the institution administrator's `GET /api/institution-admin/progress` feed. Administrators can add an institutional progress check-in for a student using `POST /api/institution-admin/progress/{studentId}`; that data is linked to the same student and institution. The student sees their own feed through `GET /api/my/progress`.

These progress check-ins are not silently converted into official exam marks. Official subject marks and dated academic-trend records remain separate records that an authorised institution administrator enters through the existing academic APIs. Student editing of official marks/trends is denied server-side.

## Existing academic/student endpoints

The legacy student-specific API remains available with server-side role and tenant checks:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/students` | Student sees only their linked row; admin sees own institution; Super Admin sees platform rows |
| GET | `/api/students/{id}` | Read permitted student row |
| POST | `/api/students/{id}/assess` | Save/view assessment only for permitted row |
| GET | `/api/students/{id}/risk-history` | Risk assessment history |
| GET | `/api/students/{id}/early-warnings` | Rule-based academic trend warnings |
| GET | `/api/students/{id}/academic-records` | Official dated academic record list |

Institution administrators additionally use the existing academic record, trend, mentor feedback and CSV import APIs. Students cannot write official academic records/trends or mentor feedback.

## Chat companion and privacy

The registration screen links to the privacy notice and informs students that chatbot interactions may be monitored by authorised institution administrators. Chat use requires the monitoring-consent flag. A student can review their own interaction history and analytics, and can withdraw consent in account settings; withdrawing pauses companion access but does not automatically erase records already retained. Transcript retention is configurable (`CHAT_RETENTION_DAYS`, default 90 days; allowed range 7–365 days), after which the scheduled cleanup removes expired rows.

The companion uses a supportive, empathetic response service with rule-based topic and emotional-tone cues. It is not an LLM and does not diagnose a student's mental health. The institution dashboard shows aggregate usage trends and Weka metadata-based activity groups; administrators can open transcript text only through the separate reason-required review endpoint, and that access is audited.

## ML boundaries

The existing academic Random Forest model is distinct from chat engagement analytics. It is trained only with institution-approved labelled longitudinal CSV data, when such a dataset has been supplied and a valid model artifact trained. The chatbot sentiment/topic estimates are simple keyword cues. Weka activity clustering groups usage metadata for descriptive purposes only; it is not a score for academic performance, ability or wellbeing.

## Local development

Requirements: JDK 21+ and Maven 3.9+. Run from `backend/`:

```powershell
mvn clean test
mvn spring-boot:run "-Dspring-boot.run.profiles=dev"
```

The `dev` profile uses persistent H2 at `./data/shikshasetu`. The default profile uses MySQL; configure `DB_URL`, `DB_USERNAME` and `DB_PASSWORD` for that profile. Serve the project root containing `index.html` using Live Server or another static web server. The frontend API base defaults to `http://localhost:8080`.

## Deployment caution

The application now enforces bearer authentication, roles, institution scoping, audit logging and configurable chat retention, but this is not a production security certification. Before real deployment, use HTTPS, strong secret management, restricted CORS, a secured database with encryption-at-rest and backups, rate limiting, secure account recovery/email verification, and a formal institution privacy/security review. Never put real credentials in source files or distribute the bootstrap admin password in a public channel.
