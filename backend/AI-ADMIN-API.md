# ShikshaSetu — AI and Institution Administration API

This API reference describes the existing academic AI capability and the new human institution-admin controls. The Weka academic-risk model is separate from the chatbot analytics system. None of the model outputs should make consequential decisions without human review.

## Authentication

All routes require a valid bearer session unless explicitly noted in `backend/README.md`. Authenticate with `POST /api/auth/login` and include `Authorization: Bearer <token>` on every protected request.

`SUPER_ADMIN` may access platform institution controls and model-training operations. `INSTITUTION_ADMIN` may access AI Admin student data and reporting only within the administrator's institution. Students cannot access `/api/ai-admin/**`, `/api/fairness/**`, `/api/dashboard`, or import endpoints.

## Existing AI Admin routes

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/ai/status` | Authenticated | Reports actual AI capability/model status |
| GET | `/api/ai-admin/overview` | Institution Admin / Super Admin | Tenant-scoped counts and student registry |
| GET | `/api/ai-admin/students` | Institution Admin / Super Admin | Tenant-scoped student summaries |
| GET | `/api/ai-admin/students/{studentId}` | Institution Admin / Super Admin | Student assessment history, dated academic records, warnings, mentor feedback and manual interpretations |
| GET | `/api/ai-admin/interpretations` | Institution Admin / Super Admin | Tenant-scoped manual interpretations |
| GET | `/api/ai-admin/students/{studentId}/interpretations` | Institution Admin / Super Admin | One student's interpretation history |
| POST | `/api/ai-admin/students/{studentId}/interpretations` | Institution Admin / Super Admin | Save a contextual interpretation and assessment snapshot |
| PUT | `/api/ai-admin/students/{studentId}/interpretations/{interpretationId}` | Institution Admin / Super Admin | Update a manual interpretation |
| DELETE | `/api/ai-admin/students/{studentId}/interpretations/{interpretationId}` | Institution Admin / Super Admin | Delete a manual interpretation |

Existing academic model routes include `GET /api/ai/model/status`, `POST /api/ai/model/train` (Super Admin only), `POST /api/ai/students/{studentId}/assessment`, and `GET /api/ai/students/{studentId}/history`. Student routes remain institution-scoped.

## Institution management API

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/api/super-admin/institutions` | Super Admin | List institution workspaces and account counts |
| POST | `/api/super-admin/institutions` | Super Admin | Create institution and first administrator |
| PATCH | `/api/super-admin/institutions/{id}/status` | Super Admin | Activate/suspend institution |
| GET | `/api/institution-admin/overview` | Institution Admin | Tenant dashboard overview |
| GET | `/api/institution-admin/enrollment-requests` | Institution Admin | List pending student requests |
| POST | `/api/institution-admin/enrollment-requests/{userId}/decision` | Institution Admin | Approve/reject pending student |
| GET | `/api/institution-admin/students` | Institution Admin | List student accounts in own institution |
| PATCH | `/api/institution-admin/students/{userId}/status` | Institution Admin | Activate/suspend an enrolled student |
| GET | `/api/institution-admin/settings` | Institution Admin | Read tenant settings and access code |
| PUT | `/api/institution-admin/settings` | Institution Admin | Update institution name/settings |
| GET | `/api/institution-admin/progress` | Institution Admin | Central progress feed across its students |
| POST | `/api/institution-admin/progress/{studentId}` | Institution Admin | Record administrator progress check-in |
| GET | `/api/institution-admin/audit-logs` | Institution Admin | Read tenant audit events |

## Chat analytics and transcript review

| Method | Route | Permission | Purpose |
|---|---|---|---|
| POST | `/api/chat/interactions` | Authenticated; Student consent required | Send a message, receive supportive response and persist the interaction |
| GET | `/api/chat/my-analytics` | Student | Own last-30-day topic and usage summary |
| GET | `/api/chat/my-interactions` | Student | Own retained chatbot interactions |
| GET | `/api/institution-admin/chat-analytics?days=30` | Institution Admin | Tenant-only aggregate topics, tone cues, daily usage and Weka activity groups |
| GET | `/api/institution-admin/chat-interactions?reason=<10-300 chars>` | Institution Admin | Review up to 500 retained conversations for own institution |
| GET | `/api/institution-admin/chat-interactions?studentId=12&reason=<10-300 chars>` | Institution Admin | Review one student's retained interactions, if the ID belongs to own institution |

Conversation text is not included in the aggregate analytics response. Transcript review requires a reason and creates an audit entry. The student registration/privacy screen discloses potential institutional monitoring. Students can inspect their own history. Withdrawing monitoring consent pauses chatbot use; it does not automatically erase previously retained interactions. Expired conversations are removed by the scheduled retention job (`CHAT_RETENTION_DAYS`, default 90; configured range 7–365 days).

## Chat analytics interpretation

- Topic and sentiment/tone fields are heuristic estimates produced by transparent keyword cues. They are not clinical or psychological diagnoses.
- Weka `SimpleKMeans` clusters students using interaction frequency, active days, topic breadth and average message length. It excludes message body text from its feature vectors. The result is an activity grouping, not ability, mental health, academic risk or student quality.
- At least three students with retained interaction history are needed to fit activity clusters. Otherwise, the dashboard marks the cohort as insufficient for clustering.
- The existing Random Forest is a separate academic deterioration model. It requires approved labelled longitudinal CSV data and should be interpreted with human oversight.

## Example: create manual interpretation

`POST /api/ai-admin/students/1/interpretations`

```json
{
  "reviewStatus": "Reviewed with student",
  "interpretation": "The student explained that a timetable change affected attendance. Consider this context alongside the recorded indicators; the data does not establish the cause.",
  "evidence": "Discussed the timetable and checked the latest dated attendance record."
}
```

## Tenant-isolation behavior

An institution administrator is always scoped using the institution ID from the authenticated server session, never a client-submitted institution ID. A student can access only their own student ID and own `/api/my/**` resources. Cross-tenant student record lookups return not found. Keep these checks in place when adding new endpoints; do not rely on hiding UI elements as access control.
