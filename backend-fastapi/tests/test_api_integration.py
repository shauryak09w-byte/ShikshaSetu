"""End-to-end checks for Firebase Google identity + institution-ID login."""
from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
DB_FILE = Path(tempfile.gettempdir()) / f"shikshasetu-fastapi-test-{uuid.uuid4().hex}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{DB_FILE.as_posix()}"
os.environ["BOOTSTRAP_SUPER_ADMIN_EMAIL"] = "platform-admin@shikshasetu.example.com"
os.environ["SHIKSHASETU_ENV"] = "test"

import app as fastapi_module  # noqa: E402

app = fastapi_module.app


def firebase_token(email: str, uid: str) -> str:
    """Register a deterministic fake token for this integration test only."""
    token = f"test-firebase-token-{uid}-long-enough"
    _TOKEN_CLAIMS[token] = {
        "email": email,
        "email_verified": True,
        "uid": uid,
        "name": email.split("@")[0].replace(".", " ").title(),
        "firebase": {"sign_in_provider": "google.com"},
    }
    return token


_TOKEN_CLAIMS: dict[str, dict] = {}


def auth(client: TestClient, email: str, uid: str, institution_code: str | None = None,
         **extra):
    token = firebase_token(email, uid)
    payload = {"idToken": token, "email": email, **extra}
    if institution_code is not None:
        payload["institutionCode"] = institution_code
    return client.post("/api/auth/firebase", json=payload)


def test_firebase_email_org_id_access_data_sync_and_tenant_isolation(monkeypatch):
    monkeypatch.setattr(
        fastapi_module,
        "verify_firebase_google_token",
        lambda encoded: _TOKEN_CLAIMS[encoded],
    )

    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["service"] == "ShikshaSetu FastAPI"
        assert health.json()["version"] == "2.1.0"
        assert client.get("/api/health/live").json()["status"] == "ok"
        assert client.get("/api/health/ready").json()["status"] == "ready"
        assert health.headers.get("x-request-id")
        assert health.headers.get("x-content-type-options") == "nosniff"
        assert "frame-ancestors 'none'" in health.headers.get("content-security-policy", "")

        # Unknown fields fail closed and validation responses never echo submitted secrets.
        invalid_schema = client.post("/api/auth/firebase", json={
            "idToken": "a-valid-looking-token-which-is-long-enough", "unexpected": "private-value",
        })
        assert invalid_schema.status_code == 422
        assert "private-value" not in invalid_schema.text
        assert invalid_schema.headers.get("x-request-id")

        # Super Admin uses verified Google email and does not need an org ID.
        super_login = auth(client, "platform-admin@shikshasetu.example.com", "uid-platform-admin")
        assert super_login.status_code == 200, super_login.text
        super_headers = {"Authorization": f"Bearer {super_login.json()['token']}"}

        # Legacy password auth is no longer an active login path.
        assert client.post("/api/auth/login", json={"email": "x@example.com", "password": "not-used"}).status_code == 410
        assert client.post("/api/auth/register", json={}).status_code == 410

        college_a = client.post("/api/super-admin/institutions", headers=super_headers, json={
            "institutionName": "Campus Alpha", "adminName": "Alpha Admin",
            "adminEmail": "alpha-admin@example.com",
        })
        college_b = client.post("/api/super-admin/institutions", headers=super_headers, json={
            "institutionName": "Campus Beta", "adminName": "Beta Admin",
            "adminEmail": "beta-admin@example.com",
        })
        assert college_a.status_code == college_b.status_code == 200
        code_a = college_a.json()["institutionCode"]
        code_b = college_b.json()["institutionCode"]

        # Admin email is bound to the tenant code; missing or foreign code is rejected.
        assert auth(client, "alpha-admin@example.com", "uid-alpha-admin").status_code == 422
        assert auth(client, "alpha-admin@example.com", "uid-alpha-admin", code_b).status_code == 403
        wrong_email = client.post("/api/auth/firebase", json={
            "idToken": firebase_token("alpha-admin@example.com", "uid-alpha-admin"),
            "email": "someone-else@example.com", "institutionCode": code_a,
        })
        assert wrong_email.status_code == 403

        alpha_admin_login = auth(client, "alpha-admin@example.com", "uid-alpha-admin", code_a)
        beta_admin_login = auth(client, "beta-admin@example.com", "uid-beta-admin", code_b)
        # A Firebase UID already attached to another account cannot be reused.
        assert auth(client, "beta-admin@example.com", "uid-alpha-admin", code_b).status_code == 403
        assert alpha_admin_login.status_code == beta_admin_login.status_code == 200
        alpha_admin = {"Authorization": f"Bearer {alpha_admin_login.json()['token']}"}
        beta_admin = {"Authorization": f"Bearer {beta_admin_login.json()['token']}"}

        # Google email + org ID submits a student request. Approval is still required.
        student_a = auth(
            client, "alpha-student@example.com", "uid-alpha-student", code_a,
            fullName="Alpha Student", age=20, aiMentorName="Mira",
            privacyNoticeAccepted=True, chatMonitoringConsent=True,
        )
        student_b = auth(
            client, "beta-student@example.com", "uid-beta-student", code_b,
            fullName="Beta Student", age=21, aiMentorName="Asha",
            privacyNoticeAccepted=True, chatMonitoringConsent=False,
        )
        assert student_a.status_code == student_b.status_code == 200
        assert student_a.json()["enrollmentSubmitted"] is True
        assert student_b.json()["enrollmentSubmitted"] is True

        # Existing pending students must use their own institution code and cannot enter.
        pending_login = auth(client, "alpha-student@example.com", "uid-alpha-student", code_a)
        assert pending_login.status_code == 403
        assert auth(client, "alpha-student@example.com", "uid-alpha-student", code_b).status_code == 403

        alpha_request = client.get("/api/institution-admin/enrollment-requests", headers=alpha_admin)
        beta_request = client.get("/api/institution-admin/enrollment-requests", headers=beta_admin)
        assert len(alpha_request.json()) == len(beta_request.json()) == 1
        assert alpha_request.json()[0]["email"] == "alpha-student@example.com"
        assert beta_request.json()[0]["email"] == "beta-student@example.com"

        alpha_user_id = alpha_request.json()[0]["userId"]
        beta_user_id = beta_request.json()[0]["userId"]
        alpha_approval = client.post(
            f"/api/institution-admin/enrollment-requests/{alpha_user_id}/decision",
            headers=alpha_admin, json={"decision": "APPROVE", "note": "Identity checked"},
        )
        beta_approval = client.post(
            f"/api/institution-admin/enrollment-requests/{beta_user_id}/decision",
            headers=beta_admin, json={"decision": "APPROVE", "note": "Identity checked"},
        )
        assert alpha_approval.status_code == beta_approval.status_code == 200
        alpha_student_id = alpha_approval.json()["studentId"]
        beta_student_id = beta_approval.json()["studentId"]

        alpha_student_login = auth(client, "alpha-student@example.com", "uid-alpha-student", code_a)
        beta_student_login = auth(client, "beta-student@example.com", "uid-beta-student", code_b)
        assert alpha_student_login.status_code == beta_student_login.status_code == 200
        alpha_student = {"Authorization": f"Bearer {alpha_student_login.json()['token']}"}
        beta_student = {"Authorization": f"Bearer {beta_student_login.json()['token']}"}

        # A student can only retrieve their own student record.
        assert client.get(f"/api/students/{beta_student_id}", headers=alpha_student).status_code == 404
        assert client.get(f"/api/students/{alpha_student_id}", headers=beta_admin).status_code == 404

        # Academic records are institution-admin authored and student-readable.
        academic = client.post(f"/api/students/{alpha_student_id}/academic-records", headers=alpha_admin, json={
            "subject": "Mathematics", "assessmentName": "Unit Test 1", "recordDate": "2026-10-28",
            "marksObtained": 82, "maxMarks": 100, "attendancePercent": 92,
            "absenceCount": 2, "consecutiveAbsences": 0, "repeatedFailures": 0, "notes": "On track",
        })
        assert academic.status_code == 200
        academic_rows = client.get(f"/api/students/{alpha_student_id}/academic-records", headers=alpha_student)
        assert academic_rows.status_code == 200
        assert academic_rows.json()[0]["recordDate"] == "2026-10-28"
        assert client.post(f"/api/students/{beta_student_id}/academic-records", headers=alpha_admin, json={
            "subject": "Mathematics", "recordDate": "2026-10-28",
        }).status_code == 404

        # Student check-ins and admin check-ins use one central database table.
        saved = client.post("/api/my/progress", headers=alpha_student, json={
            "attendance": 92, "assignmentsDone": 5, "assignmentsTotal": 6,
            "problems": 8, "hours": 7.5, "note": "Working steadily",
        })
        assert saved.status_code == 200
        admin_progress = client.get("/api/institution-admin/progress", headers=alpha_admin)
        beta_progress = client.get("/api/institution-admin/progress", headers=beta_admin)
        assert len(admin_progress.json()) == 1
        assert admin_progress.json()[0]["note"] == "Working steadily"
        assert len(beta_progress.json()) == 0

        # Monitoring consent is optional for portal use but required to use the chatbot.
        denied_chat = client.post("/api/chat/interactions", headers=beta_student, json={"message": "Help me revise calculus"})
        assert denied_chat.status_code == 403
        allowed_chat = client.post("/api/chat/interactions", headers=alpha_student, json={
            "message": "I am stressed and confused about my exam",
        })
        assert allowed_chat.status_code == 200
        assert "manageable" in allowed_chat.json()["reply"]
        assert allowed_chat.json()["sentiment"] == "STRESSED"

        analytics = client.get("/api/institution-admin/chat-analytics", headers=alpha_admin)
        beta_analytics = client.get("/api/institution-admin/chat-analytics", headers=beta_admin)
        assert analytics.status_code == beta_analytics.status_code == 200
        assert analytics.json()["totalInteractions"] == 1
        assert beta_analytics.json()["totalInteractions"] == 0

        # CSV import is bounded and all-or-nothing: one invalid row imports nothing.
        invalid_csv = (
            "student_code,full_name,attendance,internal_marks,assignments_completed,previous_failures,absences\n"
            "CSV-01,Test Student One,90,80,75,0,1\n"
            "CSV-01,Duplicate Student,88,70,60,1,2\n"
        )
        rejected_import = client.post("/api/import/students", headers=alpha_admin,
                                      files={"file": ("students.csv", invalid_csv, "text/csv")})
        assert rejected_import.status_code == 200
        assert rejected_import.json()["imported"] == 0
        assert rejected_import.json()["skipped"] == 1
        assert len(client.get("/api/students", headers=alpha_admin).json()) == 1

        valid_csv = (
            "student_code,full_name,attendance,internal_marks,assignments_completed,previous_failures,absences\n"
            "CSV-01,Test Student One,90,80,75,0,1\n"
            "CSV-02,Test Student Two,88,70,60,1,2\n"
        )
        accepted_import = client.post("/api/import/students", headers=alpha_admin,
                                      files={"file": ("students.csv", valid_csv, "text/csv")})
        assert accepted_import.status_code == 200
        assert accepted_import.json()["imported"] == 2
        assert len(client.get("/api/students?limit=2", headers=alpha_admin).json()) == 2
        assert client.get("/api/students?limit=2000", headers=alpha_admin).status_code == 422

        # Only platform Super Admin can manage the global institution registry/model.
        assert client.get("/api/super-admin/institutions", headers=alpha_admin).status_code == 403
        assert len(client.get("/api/super-admin/institutions", headers=super_headers).json()) == 2

        import csv
        import io
        fastapi_module.MODEL_PATH = DB_FILE.with_suffix(".model.joblib")
        fastapi_module.MODEL_META_PATH = DB_FILE.with_suffix(".model-metadata.json")
        csv_buffer = io.StringIO()
        writer = csv.writer(csv_buffer)
        writer.writerow(["student_key", *fastapi_module.MODEL_FEATURES, fastapi_module.MODEL_TARGET])
        for student_no in range(40):
            for sample_no in range(4):
                label = sample_no % 2
                writer.writerow([
                    f"pseudonym-{student_no:02d}",
                    70 + (student_no % 25), 45 + ((student_no * 2 + sample_no) % 50),
                    55 + ((student_no + sample_no) % 40), student_no % 4,
                    student_no % 8, sample_no % 4, label * 12, label * 2, label,
                ])
        trained = client.post("/api/ai/model/train", headers=super_headers,
                              files={"file": ("approved-research.csv", csv_buffer.getvalue(), "text/csv")})
        assert trained.status_code == 200, trained.text
        assert trained.json()["status"] == "TRAINED_PROTOTYPE"
        prediction = client.post(f"/api/ai/students/{alpha_student_id}/assessment", headers=alpha_admin)
        assert prediction.status_code == 200, prediction.text
        assert prediction.json()["assessmentType"] == "TRAINED_PROTOTYPE"
        assert prediction.json()["requiresHumanReview"] is True

        # Logout revokes the server-side opaque session token.
        assert client.post("/api/auth/logout", headers=super_headers).status_code == 200
        assert client.get("/api/auth/me", headers=super_headers).status_code == 401


def test_firebase_config_readiness_rejects_example_values_and_explains_missing_setup(monkeypatch, tmp_path):
    monkeypatch.setenv("FIREBASE_API_KEY", "your-firebase-web-api-key")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "your-project-id.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "your-project-id")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123456789:web:replace-with-your-app-id")
    monkeypatch.delenv("FIREBASE_SERVICE_ACCOUNT_PATH", raising=False)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.delenv("GAE_ENV", raising=False)
    monkeypatch.delenv("GCE_METADATA_HOST", raising=False)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)

    status = fastapi_module.firebase_auth_config()
    assert status["enabled"] is False
    assert status["firebase"] is None
    assert status["checks"]["webConfig"] is False
    assert status["checks"]["serverCredentials"] is False
    assert "FIREBASE_API_KEY" in status["missing"]
    assert any(item.startswith("FIREBASE_SERVICE_ACCOUNT_PATH") for item in status["missing"])
    assert "backend-fastapi/.env" in status["message"]


def test_firebase_config_readiness_enables_only_when_web_and_admin_settings_are_real(monkeypatch, tmp_path):
    credential_file = tmp_path / "firebase-admin.json"
    credential_file.write_text(
        '{"type":"service_account","project_id":"shikshasetu-test",'
        '"client_email":"firebase-adminsdk@example.iam.gserviceaccount.com",'
        '"token_uri":"https://oauth2.googleapis.com/token",'
        '"private_key_id":"test-key-id",'
        '"private_key":"-----BEGIN PRIVATE KEY-----\\nTEST-ONLY\\n-----END PRIVATE KEY-----\\n"}',
        encoding="utf-8",
    )
    monkeypatch.setenv("FIREBASE_API_KEY", "AIzaSy-realistic-test-value")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "shikshasetu-test.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "shikshasetu-test")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123456789:web:abcdef012345")
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_PATH", str(credential_file))
    monkeypatch.setattr(fastapi_module.importlib.util, "find_spec", lambda name: object() if name == "firebase_admin" else None)
    status = fastapi_module.firebase_auth_config()
    assert status["enabled"] is True
    assert status["checks"] == {"webConfig": True, "adminSdk": True, "serverCredentials": True}
    assert status["firebase"]["projectId"] == "shikshasetu-test"
    assert "private_key" not in str(status)


def test_firebase_config_readiness_rejects_cross_project_admin_credentials(monkeypatch, tmp_path):
    credential_file = tmp_path / "firebase-admin.json"
    credential_file.write_text(
        '{"type":"service_account","project_id":"different-project",'
        '"client_email":"firebase-adminsdk@example.iam.gserviceaccount.com",'
        '"token_uri":"https://oauth2.googleapis.com/token",'
        '"private_key_id":"test-key-id",'
        '"private_key":"-----BEGIN PRIVATE KEY-----\\nTEST-ONLY\\n-----END PRIVATE KEY-----\\n"}',
        encoding="utf-8",
    )
    monkeypatch.setenv("FIREBASE_API_KEY", "AIzaSy-realistic-test-value")
    monkeypatch.setenv("FIREBASE_AUTH_DOMAIN", "shikshasetu-test.firebaseapp.com")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", "shikshasetu-test")
    monkeypatch.setenv("FIREBASE_APP_ID", "1:123456789:web:abcdef012345")
    monkeypatch.setenv("FIREBASE_SERVICE_ACCOUNT_PATH", str(credential_file))
    monkeypatch.setattr(fastapi_module.importlib.util, "find_spec", lambda name: object() if name == "firebase_admin" else None)
    status = fastapi_module.firebase_auth_config()
    assert status["enabled"] is False
    assert status["checks"]["webConfig"] is True
    assert status["checks"]["serverCredentials"] is False
    assert "different projects" in status["message"]
