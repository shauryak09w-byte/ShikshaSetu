"""ShikshaSetu FastAPI service.

Tenant-scoped campus API for the existing ShikshaSetu frontend.
The former Spring Boot source remains untouched in ../backend; this service is
now the configured frontend API. SQLite is the local default; DATABASE_URL can
be set to a production database URL.
"""
from __future__ import annotations

import csv
import hashlib
import importlib.util
import io
import json
import logging
import os
import secrets
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional, Literal

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import (Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String,
                        Text, UniqueConstraint, create_engine, event, func, inspect, select, text, delete)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.exc import IntegrityError
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
# Local development uses the project .env as the source of truth. This also
# repairs stale shell variables from an earlier launcher run. Production keeps
# environment/secret-manager values authoritative and does not override them.
_LOCAL_ENV_OVERRIDE = os.getenv("SHIKSHASETU_ENV", "development").strip().lower() != "production"
load_dotenv(ROOT / ".env", override=_LOCAL_ENV_OVERRIDE)
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
APP_ENV = os.getenv("SHIKSHASETU_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV == "production"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(DATA_DIR / 'shikshasetu-fastapi.db').as_posix()}").strip()


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer between {minimum} and {maximum}.") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}.")
    return value


SESSION_HOURS = _bounded_env_int("SESSION_HOURS", 8, 1, 24)
CHAT_RETENTION_DAYS = _bounded_env_int("AI_CHAT_RETENTION_DAYS", 90, 1, 365)
AUTH_RATE_LIMIT = _bounded_env_int("AUTH_RATE_LIMIT", 20, 5, 200)
AUTH_RATE_WINDOW_SECONDS = _bounded_env_int("AUTH_RATE_WINDOW_SECONDS", 900, 60, 3600)
MAX_CSV_UPLOAD_BYTES = _bounded_env_int("MAX_CSV_UPLOAD_MB", 10, 1, 50) * 1024 * 1024

if IS_PRODUCTION:
    if not DATABASE_URL.startswith(("postgresql://", "postgresql+psycopg://")):
        raise RuntimeError("Production requires PostgreSQL via psycopg; SQLite is for local development only.")
    if not os.getenv("CORS_ORIGINS", "").strip():
        raise RuntimeError("Production requires an explicit CORS_ORIGINS allowlist.")
    if "*" in [item.strip() for item in os.getenv("CORS_ORIGINS", "").split(",")]:
        raise RuntimeError("Wildcard CORS is not allowed in production.")
    allowed_hosts_value = os.getenv("ALLOWED_HOSTS", "").strip()
    if not allowed_hosts_value:
        raise RuntimeError("Production requires an explicit ALLOWED_HOSTS allowlist.")
    if "*" in [item.strip() for item in allowed_hosts_value.split(",")]:
        raise RuntimeError("Wildcard ALLOWED_HOSTS is not allowed in production.")
    required_firebase = ("FIREBASE_API_KEY", "FIREBASE_AUTH_DOMAIN", "FIREBASE_PROJECT_ID", "FIREBASE_APP_ID")
    missing_firebase = [name for name in required_firebase if not os.getenv(name, "").strip()]
    if missing_firebase:
        raise RuntimeError("Production Firebase configuration is incomplete: " + ", ".join(missing_firebase))

engine_options: dict[str, Any] = {"pool_pre_ping": True, "pool_timeout": 30}
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False, "timeout": 30}
else:
    engine_options.update({"pool_size": 10, "max_overflow": 20, "pool_recycle": 1800})
engine = create_engine(DATABASE_URL, **engine_options)
if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
PASSWORDS = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
BEARER = HTTPBearer(auto_error=False)
MODEL_PATH = DATA_DIR / "academic-model.joblib"
MODEL_META_PATH = DATA_DIR / "academic-model-metadata.json"
LOGGER = logging.getLogger("shikshasetu.api")
MODEL_FEATURES = [
    "attendance_percent", "internal_marks_percent", "assignment_completion_percent",
    "previous_failures", "absence_count", "consecutive_absences",
    "recent_mark_drop", "repeated_low_results",
]
MODEL_TARGET = "next_period_deterioration"


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_token(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def make_access_code() -> str:
    return "SS-" + secrets.token_hex(4).upper()


class Base(DeclarativeBase):
    pass


class Institution(Base):
    __tablename__ = "institutions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    access_code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    enrollment_open: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class PortalUser(Base):
    __tablename__ = "portal_users"
    __table_args__ = (Index("ix_portal_user_tenant_status", "institution_id", "account_status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Firebase UID is attached after the first verified Google sign-in.
    # Nullable so all pre-existing accounts remain valid during migration.
    firebase_uid: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    role: Mapped[str] = mapped_column(String(24), nullable=False)
    account_status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
    institution_id: Mapped[Optional[int]] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), nullable=True, index=True)
    student_id: Mapped[Optional[int]] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True)
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ai_mentor_name: Mapped[str] = mapped_column(String(32), default="ShikshaSetu AI")
    chat_monitoring_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    consent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (UniqueConstraint("institution_id", "student_code", name="uq_student_tenant_code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), nullable=False, index=True)
    student_code: Mapped[str] = mapped_column(String(30), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(180), default="")
    attendance: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    internal_marks: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    assignments_completed: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    previous_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    absences: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    audit_group: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class PortalSession(Base):
    __tablename__ = "portal_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("portal_users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StudentProgress(Base):
    __tablename__ = "student_progress_checkins"
    __table_args__ = (Index("ix_progress_tenant_created", "institution_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("portal_users.id", ondelete="CASCADE"), index=True)
    attendance: Mapped[float] = mapped_column(Float)
    assignments_done: Mapped[int] = mapped_column(Integer)
    assignments_total: Mapped[int] = mapped_column(Integer)
    problems: Mapped[int] = mapped_column(Integer)
    hours: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AcademicRecord(Base):
    __tablename__ = "student_academic_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(100))
    assessment_name: Mapped[str] = mapped_column(String(120), default="")
    record_date: Mapped[date] = mapped_column(Date)
    marks_obtained: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_marks: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    attendance_percent: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    absence_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    consecutive_absences: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    repeated_failures: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(String(1500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    assessment_type: Mapped[str] = mapped_column(String(40), default="RULE_BASED_SUPPORT_SCREENING")
    risk_score: Mapped[float] = mapped_column(Float)
    risk_band: Mapped[str] = mapped_column(String(16))
    explanation: Mapped[str] = mapped_column(Text, default="")
    deterioration_probability: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    model_version: Mapped[str] = mapped_column(String(80), default="")
    features_json: Mapped[str] = mapped_column(Text, default="{}")
    signals_json: Mapped[str] = mapped_column(Text, default="[]")
    suggestions_json: Mapped[str] = mapped_column(Text, default="[]")
    assessed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class MentorFeedback(Base):
    __tablename__ = "mentor_feedback"
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mentor_name: Mapped[str] = mapped_column(String(120), default="")
    observation: Mapped[str] = mapped_column(Text)
    action_taken: Mapped[str] = mapped_column(Text, default="")
    weekly_target: Mapped[str] = mapped_column(String(500), default="")
    follow_up_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    follow_up_status: Mapped[str] = mapped_column(String(60), default="Scheduled")
    outcome_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class ManualInterpretation(Base):
    __tablename__ = "manual_interpretations"
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    author: Mapped[str] = mapped_column(String(120), default="Institution Admin")
    summary: Mapped[str] = mapped_column(Text, default="")
    context: Mapped[str] = mapped_column(Text, default="")
    next_step: Mapped[str] = mapped_column(Text, default="")
    review_status: Mapped[str] = mapped_column(String(80), default="Needs mentor context")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ChatInteraction(Base):
    __tablename__ = "chat_interactions"
    __table_args__ = (Index("ix_chat_tenant_created_expiry", "institution_id", "created_at", "expires_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[int] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("portal_users.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[Optional[int]] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True)
    topic: Mapped[str] = mapped_column(String(40))
    sentiment: Mapped[str] = mapped_column(String(24))
    user_message: Mapped[str] = mapped_column(Text)
    assistant_reply: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class PortalAuditLog(Base):
    __tablename__ = "portal_audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    institution_id: Mapped[Optional[int]] = mapped_column(ForeignKey("institutions.id", ondelete="CASCADE"), nullable=True, index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    subject_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    details: Mapped[str] = mapped_column(String(600), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ----------------------------- schemas ------------------------------------
class APIRequest(BaseModel):
    """Reject misspelled/unknown API fields instead of silently ignoring them."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class RegisterRequest(APIRequest):
    fullName: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    age: int = Field(ge=13, le=100)
    aiMentorName: str = Field(min_length=2, max_length=32)
    institutionCode: str = Field(min_length=4, max_length=20)
    privacyNoticeAccepted: bool
    chatMonitoringConsent: bool = False


class LoginRequest(APIRequest):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class FirebaseAuthRequest(APIRequest):
    idToken: str = Field(min_length=20, max_length=12000)
    # The typed email is a UX confirmation only; it is always checked against
    # the verified Firebase token before the account is accessed.
    email: Optional[EmailStr] = None
    institutionCode: Optional[str] = Field(default=None, min_length=4, max_length=20, pattern=r"^[A-Za-z0-9-]+$")
    fullName: Optional[str] = Field(default=None, min_length=2, max_length=120)
    age: Optional[int] = Field(default=None, ge=13, le=100)
    aiMentorName: Optional[str] = Field(default=None, min_length=2, max_length=32)
    privacyNoticeAccepted: bool = False
    chatMonitoringConsent: bool = False


class CreateInstitutionRequest(APIRequest):
    institutionName: str = Field(min_length=2, max_length=160)
    adminName: str = Field(min_length=2, max_length=120)
    adminEmail: EmailStr


class StudentRequest(APIRequest):
    model_config = ConfigDict(str_strip_whitespace=True)
    studentCode: str = Field(min_length=1, max_length=30)
    fullName: str = Field(min_length=2, max_length=120)
    email: Optional[str] = ""
    attendance: float = Field(ge=0, le=100)
    internalMarks: float = Field(ge=0, le=100)
    assignmentsCompleted: float = Field(ge=0, le=100)
    previousFailures: int = Field(ge=0, le=100)
    absences: int = Field(ge=0, le=365)
    auditGroup: Optional[str] = Field(default="", max_length=80)


class ProgressRequest(APIRequest):
    attendance: float = Field(ge=0, le=100)
    assignmentsDone: int = Field(ge=0, le=10000)
    assignmentsTotal: int = Field(ge=0, le=10000)
    problems: int = Field(ge=0, le=100000)
    hours: float = Field(ge=0, le=168)
    note: str = Field(default="", max_length=500)


class AcademicRecordRequest(APIRequest):
    subject: str = Field(min_length=1, max_length=100)
    assessmentName: str = Field(default="", max_length=120)
    recordDate: date
    marksObtained: Optional[float] = Field(default=None, ge=0)
    maxMarks: Optional[float] = Field(default=None, gt=0)
    attendancePercent: Optional[float] = Field(default=None, ge=0, le=100)
    absenceCount: Optional[int] = Field(default=None, ge=0)
    consecutiveAbsences: Optional[int] = Field(default=None, ge=0)
    repeatedFailures: Optional[int] = Field(default=None, ge=0)
    notes: str = Field(default="", max_length=1500)


class AcademicTrendRequest(APIRequest):
    subject: str = Field(min_length=1, max_length=100)
    previousRecordDate: date
    latestRecordDate: date
    previousMark: float = Field(ge=0, le=100)
    latestMark: float = Field(ge=0, le=100)
    previousAttendance: Optional[float] = Field(default=None, ge=0, le=100)
    consecutiveAbsences: int = Field(default=0, ge=0, le=365)
    repeatedFailures: int = Field(default=0, ge=0, le=100)
    reference: str = Field(default="", max_length=100)


class FeedbackRequest(APIRequest):
    mentorName: str = Field(min_length=1, max_length=120)
    observation: str = Field(min_length=1, max_length=10000)
    actionTaken: str = Field(default="", max_length=10000)
    weeklyTarget: str = Field(default="", max_length=500)
    followUpDate: Optional[datetime] = None


class FeedbackOutcomeRequest(APIRequest):
    status: str = Field(min_length=2, max_length=60)
    outcomeNote: str = Field(default="", max_length=10000)


class InterpretationRequest(APIRequest):
    author: str = Field(default="Institution Admin", max_length=120)
    summary: str = Field(default="", max_length=5000)
    interpretation: str = Field(default="", max_length=5000)
    context: str = Field(default="", max_length=10000)
    evidence: str = Field(default="", max_length=10000)
    nextStep: str = Field(default="", max_length=10000)
    nextAction: str = Field(default="", max_length=10000)
    reviewStatus: str = Field(default="Needs mentor context", max_length=80)


class ChatRequest(APIRequest):
    message: str = Field(min_length=1, max_length=2000)


class ConsentRequest(APIRequest):
    chatMonitoringConsent: bool


class ProfileRequest(APIRequest):
    fullName: str = Field(min_length=2, max_length=120)
    aiMentorName: str = Field(min_length=2, max_length=32)


class DecisionRequest(APIRequest):
    decision: Literal["APPROVE", "REJECT", "approve", "reject"]
    note: str = Field(default="", max_length=300)


class AccountStatusRequest(APIRequest):
    status: Literal["ACTIVE", "SUSPENDED", "active", "suspended"]


class InstitutionSettingsRequest(APIRequest):
    name: str = Field(min_length=2, max_length=160)
    enrollmentOpen: bool


class InstitutionStatusRequest(APIRequest):
    active: bool


# ----------------------------- dependencies ------------------------------
def get_db():
    """Yield one request-scoped session and always roll back failed transactions."""
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def password_matches(password: str, encoded: str) -> bool:
    try:
        return PASSWORDS.verify(encoded, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def profile_for(user: PortalUser, db: Session) -> dict[str, Any]:
    institution = db.get(Institution, user.institution_id) if user.institution_id else None
    return {
        "userId": user.id,
        "fullName": user.full_name,
        "email": user.email,
        "role": user.role,
        "status": user.account_status,
        "institutionId": user.institution_id or 0,
        "institutionName": institution.name if institution else "ShikshaSetu Platform",
        "studentId": user.student_id or 0,
        "aiMentorName": user.ai_mentor_name or "ShikshaSetu AI",
        "age": user.age or 0,
        "chatMonitoringConsent": bool(user.chat_monitoring_consent),
        "consentAt": user.consent_at.isoformat() if user.consent_at else "",
    }


def current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(BEARER),
    db: Session = Depends(get_db),
) -> PortalUser:
    raw_token = credentials.credentials if credentials else ""
    if not raw_token:
        raise HTTPException(401, "Sign-in required")
    session = db.scalar(select(PortalSession).where(PortalSession.token_hash == hash_token(raw_token)))
    if not session or session.revoked_at or session.expires_at < utcnow():
        raise HTTPException(401, "Your session has expired. Please sign in again.")
    user = db.get(PortalUser, session.user_id)
    if not user or user.account_status != "ACTIVE":
        raise HTTPException(403, "This account is not active.")
    if user.institution_id:
        institution = db.get(Institution, user.institution_id)
        if not institution or not institution.active:
            raise HTTPException(403, "This institution workspace is currently suspended.")
    request.state.actor_user_id = user.id
    return user


def require_roles(*roles: str):
    def dependency(user: PortalUser = Depends(current_user)) -> PortalUser:
        if user.role not in roles:
            raise HTTPException(403, "You do not have permission to access this resource.")
        return user
    return dependency


def audit(db: Session, user: Optional[PortalUser], action: str, details: str = "", subject_user_id: Optional[int] = None, institution_id: Optional[int] = None) -> None:
    tenant = institution_id if institution_id is not None else (user.institution_id if user else None)
    db.add(PortalAuditLog(
        institution_id=tenant,
        actor_user_id=user.id if user else None,
        subject_user_id=subject_user_id,
        action=action[:80],
        details=details[:600],
    ))


def require_student_scope(student_id: int, user: PortalUser, db: Session) -> Student:
    student = db.get(Student, student_id)
    if not student:
        raise HTTPException(404, "Student not found")
    if user.role == "SUPER_ADMIN":
        return student
    if user.role == "INSTITUTION_ADMIN" and student.institution_id == user.institution_id:
        return student
    if user.role == "STUDENT" and student.id == user.student_id and student.institution_id == user.institution_id:
        return student
    raise HTTPException(404, "Student not found")


def require_tenant_admin(user: PortalUser) -> int:
    if user.role != "INSTITUTION_ADMIN" or not user.institution_id:
        raise HTTPException(403, "Institution administrator access required")
    return user.institution_id


def student_dict(student: Student) -> dict[str, Any]:
    return {
        "id": student.id, "studentCode": student.student_code, "fullName": student.full_name,
        "email": student.email or "", "attendance": student.attendance,
        "internalMarks": student.internal_marks, "assignmentsCompleted": student.assignments_completed,
        "previousFailures": student.previous_failures, "absences": student.absences,
        "auditGroup": student.audit_group or "", "institutionId": student.institution_id,
    }


def progress_dict(row: StudentProgress, db: Session, with_name: bool = False) -> dict[str, Any]:
    result = {
        "id": row.id, "studentId": row.student_id, "attendance": row.attendance,
        "assignmentsDone": row.assignments_done, "assignmentsTotal": row.assignments_total,
        "problems": row.problems, "hours": row.hours, "note": row.note or "",
        "createdAt": row.created_at.isoformat(),
    }
    if with_name:
        student = db.get(Student, row.student_id)
        result["studentName"] = student.full_name if student else "Former student"
    return result


def academic_dict(row: AcademicRecord) -> dict[str, Any]:
    return {
        "id": row.id, "studentId": row.student_id, "subject": row.subject,
        "assessmentName": row.assessment_name or "", "recordDate": row.record_date.isoformat() if hasattr(row.record_date, "isoformat") else str(row.record_date),
        "marksObtained": row.marks_obtained, "maxMarks": row.max_marks,
        "attendancePercent": row.attendance_percent, "absenceCount": row.absence_count,
        "consecutiveAbsences": row.consecutive_absences, "repeatedFailures": row.repeated_failures,
        "notes": row.notes or "", "createdAt": row.created_at.isoformat(),
    }


def feedback_dict(row: MentorFeedback) -> dict[str, Any]:
    return {
        "id": row.id, "studentId": row.student_id, "mentorName": row.mentor_name,
        "observation": row.observation, "actionTaken": row.action_taken,
        "weeklyTarget": row.weekly_target, "followUpDate": row.follow_up_date.isoformat() if row.follow_up_date else None,
        "followUpStatus": row.follow_up_status, "outcomeNote": row.outcome_note or "",
        "createdAt": row.created_at.isoformat(), "completedAt": row.completed_at.isoformat() if row.completed_at else None,
    }


def audit_dict(row: PortalAuditLog) -> dict[str, Any]:
    return {"id": row.id, "action": row.action, "actorUserId": row.actor_user_id,
            "subjectUserId": row.subject_user_id, "details": row.details,
            "createdAt": row.created_at.isoformat()}


def app_error(message: str, status: int = 400) -> HTTPException:
    return HTTPException(status, detail=message)


# ----------------------------- AI / analytics ----------------------------
def classify_chat(message: str) -> tuple[str, str, str]:
    text = message.lower()
    if any(k in text for k in ("exam", "revision", "test", "quiz")): topic = "EXAM_PREPARATION"
    elif any(k in text for k in ("python", "java", "program", "code", "debug", "dsa")): topic = "PROGRAMMING"
    elif any(k in text for k in ("math", "calculus", "algebra", "probability", "statistics")): topic = "MATHEMATICS"
    elif any(k in text for k in ("assignment", "homework", "project", "submission")): topic = "ASSIGNMENTS"
    elif any(k in text for k in ("career", "internship", "resume", "interview")): topic = "CAREER_GUIDANCE"
    elif any(k in text for k in ("stress", "anxious", "overwhelmed", "tired", "sad", "worried", "panic")): topic = "WELLBEING_SUPPORT"
    else: topic = "GENERAL_LEARNING"
    if any(k in text for k in ("stupid", "useless", "hate", "angry", "frustrat", "can't do", "cannot do")): sentiment = "FRUSTRATED"
    elif any(k in text for k in ("stress", "anxious", "overwhelmed", "worried", "scared", "panic", "sad", "tired")): sentiment = "STRESSED"
    elif any(k in text for k in ("confus", "don't understand", "do not understand", "not clear", "lost")): sentiment = "CONFUSED"
    elif any(k in text for k in ("thank", "great", "happy", "excited", "understood", "got it")): sentiment = "POSITIVE"
    else: sentiment = "NEUTRAL"
    return topic, sentiment, text


def empathetic_reply(message: str, topic: str, sentiment: str, mentor_name: str) -> str:
    name = mentor_name or "your learning companion"
    if sentiment == "FRUSTRATED":
        opening = "I hear how frustrating this feels. You do not have to solve everything at once."
    elif sentiment == "STRESSED":
        opening = "That sounds like a lot to carry right now. Let's slow it down and make the next step manageable."
    elif sentiment == "CONFUSED":
        opening = "It is completely okay to need another explanation. Let's break the idea into smaller pieces."
    elif sentiment == "POSITIVE":
        opening = "I'm glad you're making progress. Let's build on what is working."
    else:
        opening = "Thanks for sharing that. We can work through it one step at a time."
    if topic == "PROGRAMMING":
        guidance = "For a coding question, share the exact problem statement or the part of your code that feels unclear. We can trace the input, expected output and each step together."
    elif topic == "MATHEMATICS":
        guidance = "For a maths question, tell me which step is confusing. I can explain the definition first, then solve a small example before we try the full problem."
    elif topic == "EXAM_PREPARATION":
        guidance = "For exam preparation, choose one topic and one realistic 25-minute study block. Start with the basics, solve two practice questions, then review the mistakes."
    elif topic == "ASSIGNMENTS":
        guidance = "For an assignment, let's identify the deliverable, split it into small tasks and decide what can be completed first. You can paste the brief here."
    elif topic == "WELLBEING_SUPPORT":
        guidance = "Consider taking a short pause, getting some water and speaking with someone you trust or a campus support person. I can help organise study tasks, but I am not a counsellor or emergency service."
    elif topic == "CAREER_GUIDANCE":
        guidance = "For career planning, we can start with one goal—an internship, a project or an interview—and turn it into a short action plan."
    else:
        guidance = "Tell me the subject and the outcome you are aiming for. I'll keep the explanation practical, use simple language and check each step with you."
    return f"{opening}\n\n{guidance}\n\n— {name}"


def load_model_bundle():
    if not MODEL_PATH.exists():
        return None
    try:
        import joblib
        return joblib.load(MODEL_PATH)
    except Exception:
        return None


def load_model_metadata() -> dict[str, Any]:
    try:
        return json.loads(MODEL_META_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


ML_MODEL = load_model_bundle()
ML_METADATA = load_model_metadata()


def model_status() -> dict[str, Any]:
    if ML_MODEL is None:
        return {"model": "scikit-learn Random Forest", "status": "NOT_TRAINED", "modelVersion": None,
                "trainedAt": None, "metrics": None, "target": MODEL_TARGET,
                "note": "No approved labelled model has been trained. The transparent baseline remains available."}
    return {"model": "scikit-learn Random Forest", "status": "TRAINED_PROTOTYPE",
            "modelVersion": ML_METADATA.get("modelVersion"), "trainedAt": ML_METADATA.get("trainedAt"),
            "metrics": ML_METADATA.get("metrics"), "target": MODEL_TARGET,
            "note": "Research prototype only. Human review and later-term/external validation are required."}


# ----------------------------- lifecycle ---------------------------------
def ensure_firebase_uid_schema() -> None:
    """Add the nullable Firebase UID to legacy databases without rebuilding tables."""
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("portal_users")}
    if "firebase_uid" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE portal_users ADD COLUMN firebase_uid VARCHAR(128)"))
    inspector = inspect(engine)
    indexes = inspector.get_indexes("portal_users")
    unique_constraints = inspector.get_unique_constraints("portal_users")
    has_uid_unique = any(
        index.get("unique") and index.get("column_names") == ["firebase_uid"] for index in indexes
    ) or any(
        constraint.get("column_names") == ["firebase_uid"] for constraint in unique_constraints
    )
    if not has_uid_unique:
        with engine.begin() as connection:
            connection.execute(text("CREATE UNIQUE INDEX uq_portal_users_firebase_uid ON portal_users (firebase_uid)"))


# ----------------------------- lifecycle ---------------------------------
@asynccontextmanager
async def lifespan(application: FastAPI):
    # Development creates missing tables for a frictionless first run. Production
    # uses Alembic migrations and refuses to start against an unmigrated database.
    if IS_PRODUCTION:
        firebase_status = firebase_auth_readiness()
        if not firebase_status["enabled"]:
            raise RuntimeError("Production Google authentication is not ready: " + firebase_status["message"])
        if not inspect(engine).has_table("alembic_version"):
            raise RuntimeError("Database migrations are missing. Run 'alembic upgrade head' before starting the API.")
        expected_revision = os.getenv("ALEMBIC_EXPECTED_REVISION", "0001_baseline").strip()
        with engine.connect() as connection:
            current_revision = connection.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))
        if current_revision != expected_revision:
            raise RuntimeError(
                f"Database revision {current_revision!r} does not match expected {expected_revision!r}. "
                "Run the reviewed Alembic migrations before starting the API."
            )
    else:
        Base.metadata.create_all(engine)
        ensure_firebase_uid_schema()

    with SessionLocal() as db:
        email = os.getenv("BOOTSTRAP_SUPER_ADMIN_EMAIL", "").strip().lower()
        if email:
            existing = db.scalar(select(PortalUser).where(PortalUser.email == email))
            if not existing:
                bootstrap_hash = PASSWORDS.hash(secrets.token_urlsafe(48))
                db.add(PortalUser(email=email, full_name="Platform Super Admin", password_hash=bootstrap_hash,
                                  role="SUPER_ADMIN", account_status="ACTIVE"))
                db.commit()
            elif existing.role != "SUPER_ADMIN":
                raise RuntimeError("BOOTSTRAP_SUPER_ADMIN_EMAIL already belongs to a non-Super-Admin account.")
        cutoff = utcnow()
        db.execute(delete(ChatInteraction).where(ChatInteraction.expires_at < cutoff))
        db.execute(delete(PortalSession).where(
            (PortalSession.expires_at < cutoff - timedelta(days=30)) |
            (PortalSession.revoked_at < cutoff - timedelta(days=30))
        ))
        db.commit()
    LOGGER.info("application_started environment=%s database=%s", APP_ENV,
                "sqlite" if DATABASE_URL.startswith("sqlite") else DATABASE_URL.split(":", 1)[0])
    try:
        yield
    finally:
        engine.dispose()


app = FastAPI(
    title="ShikshaSetu API",
    summary="Tenant-scoped education support platform API",
    description=(
        "API for ShikshaSetu student workspaces, institution administration, "
        "Firebase Google authentication, academic progress and support analytics. "
        "Institution-scoped endpoints enforce tenant boundaries server-side."
    ),
    version="2.1.0",
    lifespan=lifespan,
    docs_url="/api/docs" if not IS_PRODUCTION else None,
    redoc_url="/api/redoc" if not IS_PRODUCTION else None,
    openapi_url="/api/openapi.json" if not IS_PRODUCTION else None,
)

origins = [x.strip().rstrip("/") for x in os.getenv(
    "CORS_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501"
).split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)
if IS_PRODUCTION:
    allowed_hosts = [item.strip() for item in os.getenv("ALLOWED_HOSTS", "").split(",") if item.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)


class InMemoryRateLimiter:
    """Small single-process guard; use an API gateway/Redis limiter for multi-worker production."""
    def __init__(self) -> None:
        self._entries: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = self._entries[key]
            while bucket and bucket[0] <= now - window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(1, int(window_seconds - (now - bucket[0])))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please wait a moment and try again.",
                    headers={"Retry-After": str(retry_after)},
                )
            bucket.append(now)
            # Prevent the in-process limiter itself from growing without bound.
            if len(self._entries) > 10000:
                stale_before = now - max(window_seconds, 3600)
                for old_key in list(self._entries)[:1000]:
                    old_bucket = self._entries[old_key]
                    while old_bucket and old_bucket[0] <= stale_before:
                        old_bucket.popleft()
                    if not old_bucket:
                        self._entries.pop(old_key, None)


RATE_LIMITER = InMemoryRateLimiter()


def client_rate_key(request: Request, action: str) -> str:
    host = request.client.host if request.client else "unknown-client"
    return f"{action}:{host}"


@app.middleware("http")
async def request_context_and_security(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, private"
    if IS_PRODUCTION and request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    LOGGER.info("request_complete request_id=%s method=%s path=%s status=%s elapsed_ms=%s",
                request_id, request.method, request.url.path, response.status_code, elapsed_ms)
    return response


@app.get("/api/health/live", tags=["Operations"])
def health_live():
    """Liveness probe: the process is running."""
    return {"status": "ok", "service": "ShikshaSetu API"}


@app.get("/api/health/ready", tags=["Operations"])
def health_ready(db: Session = Depends(get_db)):
    """Readiness probe: the application can reach its database."""
    db.execute(select(1))
    return {"status": "ready", "database": "online"}


@app.get("/api/health", tags=["Operations"])
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "service": "ShikshaSetu FastAPI", "version": app.version,
            "database": "online", "model": model_status()["status"],
            "environment": APP_ENV, "timestamp": utcnow().isoformat()}


# -------------------------------- auth ------------------------------------
def firebase_public_config() -> dict[str, str]:
    return {
        "apiKey": os.getenv("FIREBASE_API_KEY", "").strip(),
        "authDomain": os.getenv("FIREBASE_AUTH_DOMAIN", "").strip(),
        "projectId": os.getenv("FIREBASE_PROJECT_ID", "").strip(),
        "appId": os.getenv("FIREBASE_APP_ID", "").strip(),
    }


def _firebase_value_is_placeholder(value: str) -> bool:
    normalized = (value or "").strip().lower()
    if not normalized:
        return True
    placeholder_markers = (
        "your-firebase", "your-project-id", "replace-with", "change-me",
        "placeholder", "<your", "example-project", "123456789:web:replace",
    )
    return any(marker in normalized for marker in placeholder_markers)


def _firebase_server_credential_status() -> tuple[bool, str]:
    """Return readiness without exposing or returning any credential material."""
    configured_path = (os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
                       or os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip())
    if configured_path:
        credential_path = Path(configured_path).expanduser()
        if not credential_path.is_absolute():
            credential_path = ROOT / credential_path
        if not credential_path.is_file():
            return False, "Firebase service-account JSON file was not found at the configured path."
        try:
            credential_data = json.loads(credential_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False, "Firebase service-account JSON could not be read."
        if credential_data.get("type") != "service_account":
            return False, "The configured Firebase credential file is not a service-account JSON file."
        required_credential_fields = ("project_id", "client_email", "private_key", "token_uri")
        if any(not str(credential_data.get(field, "")).strip() for field in required_credential_fields):
            return False, "The Firebase service-account JSON is incomplete. Download a fresh Admin SDK key."
        private_key = str(credential_data.get("private_key", ""))
        if not private_key.startswith("-----BEGIN PRIVATE KEY-----") or "-----END PRIVATE KEY-----" not in private_key:
            return False, "The Firebase service-account JSON does not contain a valid PEM private-key block."
        configured_project = os.getenv("FIREBASE_PROJECT_ID", "").strip()
        credential_project = str(credential_data.get("project_id", "")).strip()
        if configured_project and credential_project and configured_project != credential_project:
            return False, "Firebase Web App and Admin SDK credentials belong to different projects."
        return True, ""

    # Application Default Credentials are standard on Google-managed runtimes.
    if any(os.getenv(name) for name in ("K_SERVICE", "GAE_ENV", "GCE_METADATA_HOST")):
        return True, ""
    return False, "Firebase Admin service-account credentials are not configured for this backend."


def firebase_auth_readiness() -> dict[str, Any]:
    config = firebase_public_config()
    missing_web = [key for key, value in config.items() if _firebase_value_is_placeholder(value)]
    admin_sdk_ready = importlib.util.find_spec("firebase_admin") is not None
    credentials_ready, credential_message = _firebase_server_credential_status()
    missing = []
    if missing_web:
        missing.extend({
            "apiKey": "FIREBASE_API_KEY",
            "authDomain": "FIREBASE_AUTH_DOMAIN",
            "projectId": "FIREBASE_PROJECT_ID",
            "appId": "FIREBASE_APP_ID",
        }[key] for key in missing_web)
    if not admin_sdk_ready:
        missing.append("firebase-admin package")
    if not credentials_ready:
        missing.append("FIREBASE_SERVICE_ACCOUNT_PATH (Firebase Admin credentials)")

    if missing_web:
        message = "Google sign-in is not ready: complete the Firebase Web App values in backend-fastapi/.env."
    elif not admin_sdk_ready:
        message = "Google sign-in is not ready: the Firebase Admin SDK is missing. Run the FastAPI launcher to install requirements."
    elif not credentials_ready:
        message = credential_message
    else:
        message = "Google sign-in is ready."

    return {
        "enabled": not missing,
        "firebase": config if not missing_web else None,
        "checks": {
            "webConfig": not missing_web,
            "adminSdk": admin_sdk_ready,
            "serverCredentials": credentials_ready,
        },
        "missing": missing,
        "message": message,
    }


@app.get("/api/auth/firebase/config")
def firebase_auth_config():
    # Public diagnostic only: the response contains public Firebase client
    # settings and readiness booleans, never the Admin SDK key or path.
    return firebase_auth_readiness()


_FIREBASE_INIT_LOCK = threading.Lock()


def get_firebase_admin_app():
    """Load Firebase Admin credentials only on the server; never expose the key to browsers."""
    try:
        import firebase_admin
        from firebase_admin import credentials
    except ImportError:
        raise app_error("Firebase Admin SDK is missing. Run the backend launcher to install requirements.", 503)

    try:
        return firebase_admin.get_app()
    except ValueError:
        pass

    with _FIREBASE_INIT_LOCK:
        try:
            return firebase_admin.get_app()
        except ValueError:
            pass

        return _initialize_firebase_admin_app(firebase_admin, credentials)


def _initialize_firebase_admin_app(firebase_admin, credentials):
    project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    credential_setting = (os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "").strip()
                          or os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip())
    options = {"projectId": project_id} if project_id else {}
    try:
        if credential_setting:
            credential_path = Path(credential_setting).expanduser()
            if not credential_path.is_absolute():
                credential_path = ROOT / credential_path
            if not credential_path.is_file():
                raise FileNotFoundError(str(credential_path))
            return firebase_admin.initialize_app(credentials.Certificate(str(credential_path)), options=options)
        # Application Default Credentials also work on Google Cloud; local VS Code
        # users should normally set FIREBASE_SERVICE_ACCOUNT_PATH in .env.
        return firebase_admin.initialize_app(credentials.ApplicationDefault(), options=options)
    except Exception as exc:
        raise app_error(
            "Firebase server credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH in "
            "backend-fastapi/.env to your Firebase service-account JSON file.", 503
        ) from exc


def verify_firebase_google_token(encoded_token: str) -> dict[str, Any]:
    readiness = firebase_auth_readiness()
    if not readiness["enabled"]:
        raise app_error(readiness["message"] + " See FIREBASE-SETUP.md.", 503)
    try:
        import firebase_admin.auth as firebase_auth
        admin_app = get_firebase_admin_app()
        return firebase_auth.verify_id_token(encoded_token, app=admin_app, check_revoked=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise app_error("Firebase could not verify this sign-in. Choose your Google account and try again.", 401) from exc


@app.post("/api/auth/firebase", tags=["Authentication"])
def firebase_authenticate(request: Request, payload: FirebaseAuthRequest, db: Session = Depends(get_db)):
    RATE_LIMITER.check(client_rate_key(request, "firebase-auth"), AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_SECONDS)
    claims = verify_firebase_google_token(payload.idToken)
    firebase_claims = claims.get("firebase") or {}
    if firebase_claims.get("sign_in_provider") != "google.com":
        raise app_error("Only Google sign-in is enabled for ShikshaSetu. Continue with Google.", 403)

    email = str(claims.get("email", "")).lower().strip()
    firebase_uid = str(claims.get("uid", "")).strip()
    if (not email or len(email) > 180 or claims.get("email_verified") is not True
            or not firebase_uid or len(firebase_uid) > 128):
        raise app_error("Use a Google account with a verified email address.", 403)
    if payload.email and str(payload.email).lower().strip() != email:
        raise app_error("The Google account you selected does not match the email address you entered. Choose the matching account and try again.", 403)

    user = db.scalar(select(PortalUser).where(PortalUser.email == email))
    if not user:
        required = [payload.fullName, payload.age, payload.aiMentorName, payload.institutionCode]
        if not all(required) or not payload.privacyNoticeAccepted:
            return {"needsEnrollment": True,
                    "googleProfile": {"email": email, "fullName": claims.get("name", "")},
                    "message": "Your Google account is verified. Complete the student enrollment details to request access."}
        institution = db.scalar(select(Institution).where(
            func.upper(Institution.access_code) == payload.institutionCode.upper().strip(),
            Institution.active.is_(True)))
        if not institution:
            raise app_error("Institution code not found or institution is inactive. Check the code provided by your college.", 404)
        if not institution.enrollment_open:
            raise app_error("This institution is not accepting new enrollment requests.", 403)
        user = PortalUser(
            email=email,
            full_name=(payload.fullName or claims.get("name") or email.split("@")[0]).strip(),
            password_hash=PASSWORDS.hash(secrets.token_urlsafe(48)),
            firebase_uid=firebase_uid,
            role="STUDENT", account_status="PENDING", institution_id=institution.id,
            age=payload.age, ai_mentor_name=(payload.aiMentorName or "ShikshaSetu AI").strip(),
            chat_monitoring_consent=payload.chatMonitoringConsent,
            consent_at=utcnow() if payload.chatMonitoringConsent else None,
        )
        try:
            db.add(user)
            db.flush()
            audit(db, user, "STUDENT_ENROLLMENT_REQUEST", f"Firebase-verified student requested access to {institution.name}.")
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise app_error("An account with this email or Google identity already exists. Sign in with that account.", 409) from exc
        return {"enrollmentSubmitted": True,
                "message": f"Your request was sent to {institution.name}. Your institution administrator must approve it before you can enter."}

    # Tenant-bound accounts must present the institution code assigned to their
    # own institution. This is required for both students and institution admins.
    # The Super Admin is platform-wide and does not have an institution code.
    if user.role != "SUPER_ADMIN":
        supplied_code = (payload.institutionCode or "").strip().upper()
        if not supplied_code:
            raise app_error("Enter your Institution / Organization ID. Students and Institution Admins need this to sign in.", 422)
        institution = db.scalar(select(Institution).where(
            func.upper(Institution.access_code) == supplied_code,
            Institution.active.is_(True)))
        if not institution or user.institution_id != institution.id:
            raise app_error("That Institution / Organization ID does not match this account. Check the ID provided by your institution.", 403)

    # Legacy users are linked once by their verified email. Once linked, the UID
    # becomes immutable, preventing a different Firebase identity from taking over.
    uid_owner = db.scalar(select(PortalUser).where(PortalUser.firebase_uid == firebase_uid))
    if uid_owner and uid_owner.id != user.id:
        raise app_error("This Google identity is already linked to another ShikshaSetu account. Contact support.", 403)
    if user.firebase_uid and user.firebase_uid != firebase_uid:
        raise app_error("This ShikshaSetu email is already linked to a different Google identity. Contact your institution administrator.", 403)
    if not user.firebase_uid:
        user.firebase_uid = firebase_uid

    if user.account_status != "ACTIVE":
        db.commit()  # Persist the verified UID link even while approval is pending.
        messages = {"PENDING": "Your institution administrator has not approved your access request yet.",
                    "REJECTED": "Your enrollment request was not approved. Contact your institution administrator.",
                    "SUSPENDED": "Your account has been suspended. Contact your institution administrator."}
        raise app_error(messages.get(user.account_status, "This account is not active."), 403)
    if user.institution_id:
        institution = db.get(Institution, user.institution_id)
        if not institution or not institution.active:
            raise app_error("This institution workspace is currently suspended.", 403)

    token = secrets.token_urlsafe(48)
    db.add(PortalSession(user_id=user.id, token_hash=hash_token(token),
                         expires_at=utcnow() + timedelta(hours=SESSION_HOURS)))
    audit(db, user, "LOGIN", "Firebase-verified Google portal login successful.")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise app_error("This account could not be linked safely. Please retry sign-in.", 409) from exc
    return {"token": token, "expiresInHours": SESSION_HOURS, "profile": profile_for(user, db)}


@app.get("/api/auth/google/config")
def legacy_google_auth_config():
    return {"enabled": False, "message": "Google Identity Services sign-in was replaced by Firebase Authentication."}


@app.post("/api/auth/google")
def legacy_google_auth():
    raise app_error("This sign-in endpoint has been retired. Use Firebase Google sign-in on the ShikshaSetu login page.", 410)


@app.post("/api/auth/register")
def register():
    raise app_error("Password registration is disabled. Use Continue with Google on the ShikshaSetu login page.", 410)


@app.post("/api/auth/login")
def login():
    raise app_error("Password sign-in is disabled. Use Continue with Google on the ShikshaSetu login page.", 410)


@app.get("/api/auth/me", tags=["Authentication"])
def auth_me(user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    return profile_for(user, db)


@app.post("/api/auth/logout", tags=["Authentication"])
def logout(credentials: Optional[HTTPAuthorizationCredentials] = Depends(BEARER), user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    token = credentials.credentials if credentials else ""
    session = db.scalar(select(PortalSession).where(PortalSession.token_hash == hash_token(token), PortalSession.user_id == user.id))
    if session:
        session.revoked_at = utcnow()
    audit(db, user, "LOGOUT", "Portal session revoked.")
    db.commit()
    return {"message": "Signed out"}


@app.put("/api/auth/profile")
def update_profile(payload: ProfileRequest, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    user.full_name = payload.fullName.strip()
    user.ai_mentor_name = payload.aiMentorName.strip()
    if user.student_id:
        student = db.get(Student, user.student_id)
        if student and student.institution_id == user.institution_id:
            student.full_name = user.full_name
    audit(db, user, "PROFILE_UPDATED", "Account profile updated.")
    db.commit()
    return profile_for(user, db)


# --------------------------- super admin ---------------------------------
@app.get("/api/super-admin/institutions")
def list_institutions(user: PortalUser = Depends(require_roles("SUPER_ADMIN")), db: Session = Depends(get_db)):
    result = []
    for institution in db.scalars(select(Institution).order_by(Institution.name.asc())).all():
        admins = db.scalar(select(func.count(PortalUser.id)).where(PortalUser.institution_id == institution.id, PortalUser.role == "INSTITUTION_ADMIN")) or 0
        students = db.scalar(select(func.count(PortalUser.id)).where(PortalUser.institution_id == institution.id, PortalUser.role == "STUDENT", PortalUser.account_status == "ACTIVE")) or 0
        pending = db.scalar(select(func.count(PortalUser.id)).where(PortalUser.institution_id == institution.id, PortalUser.account_status == "PENDING")) or 0
        result.append({"id": institution.id, "name": institution.name, "accessCode": institution.access_code,
                       "active": institution.active, "admins": admins, "students": students, "pending": pending,
                       "createdAt": institution.created_at.isoformat()})
    return result


@app.post("/api/super-admin/institutions")
def create_institution(payload: CreateInstitutionRequest, user: PortalUser = Depends(require_roles("SUPER_ADMIN")), db: Session = Depends(get_db)):
    email = str(payload.adminEmail).lower().strip()
    if db.scalar(select(PortalUser).where(PortalUser.email == email)):
        raise app_error("Admin email is already registered.", 409)
    institution = Institution(name=payload.institutionName.strip(), access_code=make_access_code())
    db.add(institution); db.flush()
    # Password login is retired. Keep a random unusable password hash for the
    # legacy non-null DB column; the administrator signs in with verified Google
    # email plus this institution's access code.
    admin = PortalUser(email=email, full_name=payload.adminName.strip(), password_hash=PASSWORDS.hash(secrets.token_urlsafe(48)),
                       role="INSTITUTION_ADMIN", account_status="ACTIVE", institution_id=institution.id,
                       ai_mentor_name="ShikshaSetu AI", chat_monitoring_consent=False)
    db.add(admin); db.flush()
    audit(db, user, "INSTITUTION_CREATED", f"Created institution {institution.name} and first administrator.", admin.id, institution.id)
    db.commit()
    return {"institutionId": institution.id, "institutionName": institution.name,
            "institutionCode": institution.access_code, "adminEmail": admin.email,
            "message": "Institution created. Share its Institution / Organization ID with the administrator and enrolled students. The administrator signs in with the provisioned Google email and this ID."}


@app.patch("/api/super-admin/institutions/{institution_id}/status")
def set_institution_status(institution_id: int, payload: InstitutionStatusRequest, user: PortalUser = Depends(require_roles("SUPER_ADMIN")), db: Session = Depends(get_db)):
    institution = db.get(Institution, institution_id)
    if not institution:
        raise app_error("Institution not found.", 404)
    institution.active = payload.active
    if not institution.active:
        sessions = db.scalars(select(PortalSession).join(PortalUser).where(PortalUser.institution_id == institution_id, PortalSession.revoked_at.is_(None))).all()
        for session in sessions: session.revoked_at = utcnow()
    audit(db, user, "INSTITUTION_STATUS_CHANGED", f"Institution active={institution.active}.", institution_id=institution_id)
    db.commit()
    return {"id": institution.id, "active": institution.active}


# ----------------------- institution administration ----------------------
@app.get("/api/institution-admin/overview")
def institution_overview(user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    institution = db.get(Institution, tenant)
    total_students = db.scalar(select(func.count(Student.id)).where(Student.institution_id == tenant)) or 0
    pending = db.scalar(select(func.count(PortalUser.id)).where(PortalUser.institution_id == tenant, PortalUser.account_status == "PENDING")) or 0
    cutoff = utcnow() - timedelta(days=30)
    chats = db.scalar(select(func.count(ChatInteraction.id)).where(ChatInteraction.institution_id == tenant, ChatInteraction.created_at >= cutoff, ChatInteraction.expires_at > utcnow())) or 0
    unique_students = db.scalar(select(func.count(func.distinct(ChatInteraction.student_id))).where(ChatInteraction.institution_id == tenant, ChatInteraction.created_at >= cutoff, ChatInteraction.expires_at > utcnow())) or 0
    return {"institution": {"id": institution.id, "name": institution.name, "accessCode": institution.access_code,
                             "active": institution.active, "enrollmentOpen": institution.enrollment_open},
            "students": total_students, "pendingRequests": pending, "chatInteractionsLast30Days": chats,
            "uniqueChatUsersLast30Days": unique_students, "chatRetentionDays": CHAT_RETENTION_DAYS}


@app.get("/api/institution-admin/enrollment-requests", tags=["Institution administration"])
def enrollment_requests(limit: int = Query(default=200, ge=1, le=500), offset: int = Query(default=0, ge=0),
                        user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    rows = db.scalars(select(PortalUser).where(PortalUser.institution_id == tenant, PortalUser.role == "STUDENT", PortalUser.account_status == "PENDING").order_by(PortalUser.created_at.asc()).offset(offset).limit(limit)).all()
    return [{"userId": row.id, "fullName": row.full_name, "email": row.email, "role": row.role,
             "status": row.account_status, "studentId": row.student_id, "requestedAt": row.created_at.isoformat(),
             "chatMonitoringConsent": row.chat_monitoring_consent} for row in rows]


@app.post("/api/institution-admin/enrollment-requests/{user_id}/decision")
def decide_enrollment(user_id: int, payload: DecisionRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    decision = payload.decision.upper().strip()
    if decision not in {"APPROVE", "REJECT"}:
        raise app_error("Decision must be APPROVE or REJECT.")
    student_user = db.scalar(select(PortalUser).where(PortalUser.id == user_id, PortalUser.institution_id == tenant,
                                     PortalUser.role == "STUDENT", PortalUser.account_status == "PENDING"))
    if not student_user:
        raise app_error("Pending enrollment request not found.", 404)
    if decision == "APPROVE":
        student = Student(institution_id=tenant, student_code="STU-" + uuid.uuid4().hex[:12].upper(),
                          full_name=student_user.full_name, email=student_user.email, attendance=0,
                          internal_marks=0, assignments_completed=0, previous_failures=0, absences=0)
        db.add(student); db.flush()
        student_user.student_id = student.id
        student_user.account_status = "ACTIVE"
    else:
        student_user.account_status = "REJECTED"
    audit(db, user, f"ENROLLMENT_{decision}", payload.note or f"Enrollment {decision.lower()}.", student_user.id)
    db.commit()
    return {"userId": student_user.id, "status": student_user.account_status, "studentId": student_user.student_id or 0}


@app.get("/api/institution-admin/students", tags=["Institution administration"])
def institution_student_accounts(limit: int = Query(default=300, ge=1, le=1000), offset: int = Query(default=0, ge=0),
                                 user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    rows = db.scalars(select(PortalUser).where(PortalUser.institution_id == tenant, PortalUser.role == "STUDENT").order_by(PortalUser.created_at.desc()).offset(offset).limit(limit)).all()
    return [{"userId": row.id, "fullName": row.full_name, "email": row.email, "role": row.role,
             "status": row.account_status, "studentId": row.student_id, "requestedAt": row.created_at.isoformat(),
             "chatMonitoringConsent": row.chat_monitoring_consent} for row in rows]


@app.patch("/api/institution-admin/students/{user_id}/status")
def update_student_account_status(user_id: int, payload: AccountStatusRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    status = payload.status.upper().strip()
    if status not in {"ACTIVE", "SUSPENDED"}:
        raise app_error("Status must be ACTIVE or SUSPENDED.")
    target = db.scalar(select(PortalUser).where(PortalUser.id == user_id, PortalUser.institution_id == tenant,
                               PortalUser.role == "STUDENT", PortalUser.student_id.is_not(None)))
    if not target:
        raise app_error("Student account not found.", 404)
    target.account_status = status
    if status == "SUSPENDED":
        active = db.scalars(select(PortalSession).where(PortalSession.user_id == user_id, PortalSession.revoked_at.is_(None))).all()
        for session in active: session.revoked_at = utcnow()
    audit(db, user, "STUDENT_ACCOUNT_STATUS_CHANGED", f"Student account status={status}.", target.id)
    db.commit()
    return {"userId": target.id, "status": target.account_status}


@app.get("/api/institution-admin/progress", tags=["Institution administration"])
def institution_progress(limit: int = Query(default=500, ge=1, le=1000), offset: int = Query(default=0, ge=0),
                         user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    rows = db.scalars(select(StudentProgress).where(StudentProgress.institution_id == tenant).order_by(StudentProgress.created_at.desc()).offset(offset).limit(limit)).all()
    return [progress_dict(row, db, True) for row in rows]


@app.post("/api/institution-admin/progress/{student_id}")
def admin_save_progress(student_id: int, payload: ProgressRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    student = db.scalar(select(Student).where(Student.id == student_id, Student.institution_id == tenant))
    if not student: raise app_error("Student not found.", 404)
    if payload.assignmentsDone > payload.assignmentsTotal: raise app_error("Completed assignments cannot exceed total assignments.")
    row = StudentProgress(institution_id=tenant, student_id=student.id, user_id=user.id,
                          attendance=payload.attendance, assignments_done=payload.assignmentsDone,
                          assignments_total=payload.assignmentsTotal, problems=payload.problems,
                          hours=payload.hours, note=payload.note.strip())
    db.add(row); audit(db, user, "ADMIN_PROGRESS_SAVED", f"Administrator recorded progress for {student.student_code}.", student.id); db.commit(); db.refresh(row)
    return progress_dict(row, db, True)


@app.get("/api/institution-admin/audit-logs", tags=["Institution administration"])
def institution_audit_logs(limit: int = Query(default=250, ge=1, le=500), offset: int = Query(default=0, ge=0),
                           user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    rows = db.scalars(select(PortalAuditLog).where(PortalAuditLog.institution_id == tenant).order_by(PortalAuditLog.created_at.desc()).offset(offset).limit(limit)).all()
    return [audit_dict(row) for row in rows]


@app.get("/api/institution-admin/settings")
def institution_settings(user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    institution = db.get(Institution, require_tenant_admin(user))
    return {"id": institution.id, "name": institution.name, "accessCode": institution.access_code,
            "active": institution.active, "enrollmentOpen": institution.enrollment_open}


@app.put("/api/institution-admin/settings")
def update_institution_settings(payload: InstitutionSettingsRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    institution = db.get(Institution, require_tenant_admin(user))
    institution.name = payload.name.strip()
    institution.enrollment_open = payload.enrollmentOpen
    audit(db, user, "INSTITUTION_SETTINGS_UPDATED", "Institution settings updated.")
    db.commit()
    return {"id": institution.id, "name": institution.name, "accessCode": institution.access_code,
            "active": institution.active, "enrollmentOpen": institution.enrollment_open}


@app.post("/api/institution-admin/access-code/rotate")
def rotate_access_code(user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    institution = db.get(Institution, require_tenant_admin(user))
    new_code = make_access_code()
    while db.scalar(select(Institution.id).where(Institution.access_code == new_code)):
        new_code = make_access_code()
    institution.access_code = new_code
    audit(db, user, "INSTITUTION_ACCESS_CODE_ROTATED", "Institution enrollment code rotated.")
    db.commit()
    return {"accessCode": new_code, "message": "The previous code can no longer be used for new enrollment requests."}


@app.get("/api/institution-admin/chat-analytics")
def institution_chat_analytics(days: int = Query(default=30, ge=1, le=180), user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    cutoff = utcnow() - timedelta(days=days)
    rows = db.scalars(select(ChatInteraction).where(ChatInteraction.institution_id == tenant,
                 ChatInteraction.created_at >= cutoff, ChatInteraction.expires_at > utcnow())).all()
    topics = Counter(row.topic for row in rows)
    sentiments = Counter(row.sentiment for row in rows)
    daily = Counter(row.created_at.date().isoformat() for row in rows)
    per_student: dict[int, list[ChatInteraction]] = defaultdict(list)
    for row in rows:
        if row.student_id: per_student[row.student_id].append(row)
    engagement = []
    if len(per_student) >= 3:
        try:
            import numpy as np
            from sklearn.cluster import KMeans
            feature_rows, ids = [], []
            for sid, items in per_student.items():
                feature_rows.append([len(items), len({x.created_at.date() for x in items}), len({x.topic for x in items}), sum(len(x.user_message) for x in items) / len(items)])
                ids.append(sid)
            k = min(3, len(feature_rows))
            cluster_model = KMeans(n_clusters=k, random_state=42, n_init=10)
            labels = cluster_model.fit_predict(np.asarray(feature_rows, dtype=float))
            centers = cluster_model.cluster_centers_
            order = {idx: rank for rank, idx in enumerate(np.argsort(centers[:, 0]))}
            band_names = ["LOW_ACTIVITY", "STEADY_ACTIVITY", "HIGH_ACTIVITY"]
            cluster_band = {idx: band_names[min(order[idx], 2)] for idx in range(k)}
            clusters = {sid: cluster_band[int(label)] for sid, label in zip(ids, labels)}
        except Exception:
            clusters = {}
    else:
        clusters = {}
    for sid, items in per_student.items():
        student = db.get(Student, sid)
        engagement.append({"studentId": sid, "studentName": student.full_name if student else "Student",
                           "studentCode": student.student_code if student else "",
                           "interactions": len(items), "activeDays": len({x.created_at.date() for x in items}),
                           "distinctTopics": len({x.topic for x in items}),
                           "averageMessageLength": round(sum(len(x.user_message) for x in items) / len(items), 1),
                           "activityBand": clusters.get(sid, "INSUFFICIENT_COHORT_DATA")})
    engagement.sort(key=lambda x: x["interactions"], reverse=True)
    return {"periodDays": days, "totalInteractions": len(rows), "uniqueStudents": len(per_student),
            "topics": dict(topics), "sentiments": dict(sentiments), "dailyInteractions": dict(daily),
            "studentEngagement": engagement,
            "engagementModel": "scikit-learn KMeans · activity metadata only (interaction count, active days, topic breadth and average message length)",
            "notice": "Topic and tone cues are transparent keyword estimates, not diagnoses. Activity groups are descriptive only and must not be used for grading, discipline or automated decisions."}


@app.get("/api/institution-admin/chat-interactions")
def institution_chat_interactions(reason: str = Query(min_length=10, max_length=300), studentId: Optional[int] = None,
                                  user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    query = select(ChatInteraction).where(ChatInteraction.institution_id == tenant, ChatInteraction.expires_at > utcnow())
    if studentId is not None: query = query.where(ChatInteraction.student_id == studentId)
    rows = db.scalars(query.order_by(ChatInteraction.created_at.desc()).limit(500)).all()
    audit(db, user, "CHAT_CONVERSATIONS_REVIEWED", f"Administrator reviewed {len(rows)} retained chat interactions. Reason: {reason.strip()}", studentId)
    db.commit()
    result = []
    for row in rows:
        account = db.get(PortalUser, row.user_id)
        student = db.get(Student, row.student_id) if row.student_id else None
        result.append({"id": row.id, "studentId": row.student_id, "studentName": student.full_name if student else (account.full_name if account else "Former account"),
                       "email": account.email if account else "", "topic": row.topic, "sentiment": row.sentiment,
                       "message": row.user_message, "reply": row.assistant_reply,
                       "createdAt": row.created_at.isoformat(), "expiresAt": row.expires_at.isoformat()})
    return result


# ----------------------------- student self -------------------------------
def require_own_student(user: PortalUser, db: Session) -> Student:
    if user.role != "STUDENT" or not user.student_id:
        raise HTTPException(403, "Your student account must be linked to an approved student record.")
    student = db.get(Student, user.student_id)
    if not student or student.institution_id != user.institution_id:
        raise HTTPException(403, "Student record is not available in this institution.")
    return student


@app.put("/api/my/privacy-consent")
def update_privacy_consent(payload: ConsentRequest, user: PortalUser = Depends(require_roles("STUDENT")), db: Session = Depends(get_db)):
    previous = user.chat_monitoring_consent
    user.chat_monitoring_consent = payload.chatMonitoringConsent
    user.consent_at = utcnow() if payload.chatMonitoringConsent else None
    if previous != user.chat_monitoring_consent:
        audit(db, user, "CHAT_MONITORING_CONSENT_GRANTED" if payload.chatMonitoringConsent else "CHAT_MONITORING_CONSENT_WITHDRAWN",
              "Student updated the chatbot monitoring consent setting.")
    db.commit()
    return {"chatMonitoringConsent": user.chat_monitoring_consent,
            "consentAt": user.consent_at.isoformat() if user.consent_at else "",
            "message": "Chat companion access is enabled." if user.chat_monitoring_consent else "Chat companion access is paused because monitoring consent was withdrawn."}


@app.get("/api/my/progress")
def my_progress(user: PortalUser = Depends(require_roles("STUDENT")), db: Session = Depends(get_db)):
    student = require_own_student(user, db)
    rows = db.scalars(select(StudentProgress).where(StudentProgress.student_id == student.id, StudentProgress.institution_id == user.institution_id).order_by(StudentProgress.created_at.desc()).limit(100)).all()
    return [progress_dict(row, db) for row in rows]


@app.post("/api/my/progress")
def save_my_progress(payload: ProgressRequest, user: PortalUser = Depends(require_roles("STUDENT")), db: Session = Depends(get_db)):
    student = require_own_student(user, db)
    if payload.assignmentsDone > payload.assignmentsTotal: raise app_error("Completed assignments cannot exceed total assignments.")
    row = StudentProgress(institution_id=user.institution_id, student_id=student.id, user_id=user.id,
                          attendance=payload.attendance, assignments_done=payload.assignmentsDone,
                          assignments_total=payload.assignmentsTotal, problems=payload.problems,
                          hours=payload.hours, note=payload.note.strip())
    audit(db, user, "STUDENT_PROGRESS_SAVED", "Student submitted a progress check-in.", student.id)
    db.add(row); db.commit(); db.refresh(row)
    # Student self-reported progress is visible immediately in the institution admin endpoint.
    return progress_dict(row, db)


# ----------------------------- student records ---------------------------
@app.get("/api/students", tags=["Student records"])
def list_students(limit: int = Query(default=300, ge=1, le=1000), offset: int = Query(default=0, ge=0),
                 user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    if user.role == "SUPER_ADMIN":
        rows = db.scalars(select(Student).order_by(Student.id.desc()).offset(offset).limit(limit)).all()
    elif user.role == "INSTITUTION_ADMIN":
        rows = db.scalars(select(Student).where(Student.institution_id == user.institution_id).order_by(Student.id.desc()).offset(offset).limit(limit)).all()
    else:
        student = require_own_student(user, db)
        rows = [student]
    return [student_dict(row) for row in rows]


@app.post("/api/students")
def create_student(payload: StudentRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN", "SUPER_ADMIN")), db: Session = Depends(get_db)):
    tenant = user.institution_id
    if user.role == "SUPER_ADMIN": raise app_error("Create a student from an institution administrator workspace so the record has a tenant.", 403)
    duplicate = db.scalar(select(Student.id).where(Student.institution_id == tenant, func.lower(Student.student_code) == payload.studentCode.lower().strip()))
    if duplicate: raise app_error("Student ID already exists in this institution.", 409)
    student = Student(institution_id=tenant, student_code=payload.studentCode.strip(), full_name=payload.fullName.strip(),
                      email=(payload.email or "").strip().lower(), attendance=payload.attendance, internal_marks=payload.internalMarks,
                      assignments_completed=payload.assignmentsCompleted, previous_failures=payload.previousFailures,
                      absences=payload.absences, audit_group=(payload.auditGroup or "").strip())
    db.add(student); audit(db, user, "STUDENT_CREATE", f"Student record {student.student_code} created."); db.commit(); db.refresh(student)
    return student_dict(student)


@app.get("/api/students/{student_id}")
def get_student(student_id: int, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    return student_dict(student)


@app.put("/api/students/{student_id}")
def update_student(student_id: int, payload: StudentRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    student = db.scalar(select(Student).where(Student.id == student_id, Student.institution_id == tenant))
    if not student: raise app_error("Student not found.", 404)
    duplicate = db.scalar(select(Student.id).where(Student.institution_id == tenant, func.lower(Student.student_code) == payload.studentCode.lower().strip(), Student.id != student_id))
    if duplicate: raise app_error("Student ID already exists in this institution.", 409)
    student.student_code = payload.studentCode.strip(); student.full_name = payload.fullName.strip()
    student.email = (payload.email or "").strip().lower(); student.attendance = payload.attendance
    student.internal_marks = payload.internalMarks; student.assignments_completed = payload.assignmentsCompleted
    student.previous_failures = payload.previousFailures; student.absences = payload.absences
    student.audit_group = (payload.auditGroup or "").strip()
    linked = db.scalar(select(PortalUser).where(PortalUser.student_id == student_id, PortalUser.institution_id == tenant))
    if linked:
        linked.full_name = student.full_name
        if student.email: linked.email = student.email
    audit(db, user, "STUDENT_UPDATE", f"Student record {student.student_code} updated.", student_id)
    db.commit(); db.refresh(student)
    return student_dict(student)


@app.delete("/api/students/{student_id}")
def delete_student(student_id: int, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    student = db.scalar(select(Student).where(Student.id == student_id, Student.institution_id == tenant))
    if not student: raise app_error("Student not found.", 404)
    linked = db.scalars(select(PortalUser).where(PortalUser.student_id == student_id, PortalUser.institution_id == tenant)).all()
    for account in linked:
        account.account_status = "SUSPENDED"
        account.student_id = None
        active_sessions = db.scalars(select(PortalSession).where(PortalSession.user_id == account.id, PortalSession.revoked_at.is_(None))).all()
        for session in active_sessions: session.revoked_at = utcnow()
    audit(db, user, "STUDENT_DELETE", "Student record and associated account access were removed.", student_id)
    db.delete(student); db.commit()
    return {"message": "Student and associated records deleted; linked portal access suspended."}


# -------------------------- academic records ------------------------------
@app.get("/api/students/{student_id}/academic-records")
def list_academic_records(student_id: int, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    rows = db.scalars(select(AcademicRecord).where(AcademicRecord.student_id == student.id, AcademicRecord.institution_id == student.institution_id).order_by(AcademicRecord.record_date.desc(), AcademicRecord.id.desc())).all()
    return [academic_dict(row) for row in rows]


@app.post("/api/students/{student_id}/academic-records")
def create_academic_record(student_id: int, payload: AcademicRecordRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    if (payload.marksObtained is None) != (payload.maxMarks is None): raise app_error("Provide both marksObtained and maxMarks, or leave both empty.")
    if payload.marksObtained is not None and payload.marksObtained > payload.maxMarks: raise app_error("Marks obtained cannot exceed maximum marks.")
    if payload.attendancePercent is None and payload.marksObtained is None and payload.absenceCount is None and payload.consecutiveAbsences is None and payload.repeatedFailures is None:
        raise app_error("A record must include marks, attendance or absence information.")
    row = AcademicRecord(institution_id=student.institution_id, student_id=student.id, subject=payload.subject.strip(),
                         assessment_name=payload.assessmentName.strip(), record_date=payload.recordDate,
                         marks_obtained=payload.marksObtained, max_marks=payload.maxMarks, attendance_percent=payload.attendancePercent,
                         absence_count=payload.absenceCount, consecutive_absences=payload.consecutiveAbsences,
                         repeated_failures=payload.repeatedFailures, notes=payload.notes.strip())
    db.add(row); audit(db, user, "ACADEMIC_RECORD_CREATED", f"Academic record added for {student.student_code}.", student.id); db.commit(); db.refresh(row)
    return academic_dict(row)


@app.delete("/api/students/{student_id}/academic-records/{record_id}")
def delete_academic_record(student_id: int, record_id: int, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    row = db.scalar(select(AcademicRecord).where(AcademicRecord.id == record_id, AcademicRecord.student_id == student.id, AcademicRecord.institution_id == student.institution_id))
    if not row: raise app_error("Academic record not found.", 404)
    db.delete(row); audit(db, user, "ACADEMIC_RECORD_DELETED", f"Academic record {record_id} deleted.", student.id); db.commit()
    return {"message": "Academic record deleted."}


@app.post("/api/students/{student_id}/academic-trends")
def save_academic_trend(student_id: int, payload: AcademicTrendRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    if payload.previousRecordDate >= payload.latestRecordDate: raise app_error("The previous result date must be earlier than the latest result date.")
    if payload.latestRecordDate > date.today(): raise app_error("The latest result date cannot be in the future.")
    reference = payload.reference.strip() or uuid.uuid4().hex
    previous = AcademicRecord(institution_id=student.institution_id, student_id=student.id, subject=payload.subject.strip(),
                              assessment_name=f"ShikshaSetu Support Loop {reference} | PREVIOUS", record_date=payload.previousRecordDate,
                              marks_obtained=payload.previousMark, max_marks=100, attendance_percent=payload.previousAttendance,
                              notes="Dated support-loop snapshot (previous period).")
    latest = AcademicRecord(institution_id=student.institution_id, student_id=student.id, subject=payload.subject.strip(),
                            assessment_name=f"ShikshaSetu Support Loop {reference} | LATEST", record_date=payload.latestRecordDate,
                            marks_obtained=payload.latestMark, max_marks=100, consecutive_absences=payload.consecutiveAbsences,
                            repeated_failures=payload.repeatedFailures, notes="Dated support-loop snapshot (latest period).")
    db.add_all([previous, latest]); audit(db, user, "ACADEMIC_TREND_SAVED", f"Dated subject trend saved for {student.student_code}.", student.id); db.commit(); db.refresh(previous); db.refresh(latest)
    return [academic_dict(previous), academic_dict(latest)]


# ------------------------------- feedback ---------------------------------
@app.get("/api/students/{student_id}/feedback")
def list_feedback(student_id: int, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    rows = db.scalars(select(MentorFeedback).where(MentorFeedback.student_id == student.id, MentorFeedback.institution_id == student.institution_id).order_by(MentorFeedback.created_at.desc())).all()
    return [feedback_dict(row) for row in rows]


@app.post("/api/students/{student_id}/feedback")
def create_feedback(student_id: int, payload: FeedbackRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    row = MentorFeedback(institution_id=student.institution_id, student_id=student.id, mentor_name=payload.mentorName.strip(),
                         observation=payload.observation.strip(), action_taken=payload.actionTaken.strip(),
                         weekly_target=payload.weeklyTarget.strip(), follow_up_date=payload.followUpDate)
    db.add(row); audit(db, user, "MENTOR_FEEDBACK_CREATED", f"Mentor follow-up recorded for {student.student_code}.", student.id); db.commit(); db.refresh(row)
    return feedback_dict(row)


@app.patch("/api/students/{student_id}/feedback/{feedback_id}/outcome")
def update_feedback_outcome(student_id: int, feedback_id: int, payload: FeedbackOutcomeRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    allowed = {"Completed · improvement noted", "Completed · no clear change yet", "Further support needed", "Student not reached", "OPEN", "IN_PROGRESS", "RESOLVED"}
    if payload.status not in allowed: raise app_error("Unsupported follow-up outcome status.")
    row = db.scalar(select(MentorFeedback).where(MentorFeedback.id == feedback_id, MentorFeedback.student_id == student.id, MentorFeedback.institution_id == student.institution_id))
    if not row: raise app_error("Follow-up not found for this student.", 404)
    row.follow_up_status = payload.status; row.outcome_note = payload.outcomeNote.strip(); row.completed_at = utcnow()
    audit(db, user, "MENTOR_FOLLOWUP_OUTCOME", f"Follow-up outcome updated for {student.student_code}.", student.id); db.commit(); db.refresh(row)
    return feedback_dict(row)


# -------------------------- academic assessment ---------------------------
def baseline_assessment(student: Student) -> tuple[float, str, str]:
    parts = [
        ("Low attendance", 30 if student.attendance < 60 else 18 if student.attendance < 75 else 0),
        ("Low internal marks", 25 if student.internal_marks < 40 else 15 if student.internal_marks < 55 else 0),
        ("Incomplete assignments", 20 if student.assignments_completed < 50 else 10 if student.assignments_completed < 75 else 0),
        ("Previous failures", min(15, student.previous_failures * 5)),
        ("Absences", min(10, student.absences * 2)),
    ]
    score = float(sum(value for _, value in parts))
    band = "HIGH" if score >= 60 else "MEDIUM" if score >= 30 else "LOW"
    explanation = "; ".join(f"{label}: +{value}" for label, value in parts if value) or "No configured early-warning threshold crossed in the available fields."
    return score, band, explanation


@app.post("/api/students/{student_id}/assess")
def assess_student(student_id: int, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    score, band, explanation = baseline_assessment(student)
    row = RiskAssessment(institution_id=student.institution_id, student_id=student.id, risk_score=score,
                         risk_band=band, explanation=explanation, assessment_type="RULE_BASED_SUPPORT_SCREENING")
    db.add(row); audit(db, user, "ASSESSMENT_CREATE", f"Transparent baseline assessment created for {student.student_code}.", student.id); db.commit(); db.refresh(row)
    return {"id": row.id, "studentId": student.id, "riskScore": row.risk_score, "riskBand": row.risk_band,
            "explanation": row.explanation, "assessedAt": row.assessed_at.isoformat(), "assessmentType": row.assessment_type}


@app.get("/api/students/{student_id}/risk-history")
def risk_history(student_id: int, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    rows = db.scalars(select(RiskAssessment).where(RiskAssessment.student_id == student.id, RiskAssessment.institution_id == student.institution_id,
                                                   RiskAssessment.assessment_type == "RULE_BASED_SUPPORT_SCREENING").order_by(RiskAssessment.assessed_at.desc())).all()
    return [{"id": row.id, "studentId": row.student_id, "riskScore": row.risk_score, "riskBand": row.risk_band,
             "explanation": row.explanation, "assessedAt": row.assessed_at.isoformat(), "assessmentType": row.assessment_type} for row in rows]


def student_model_features(student: Student, db: Session) -> dict[str, Optional[float]]:
    records = db.scalars(select(AcademicRecord).where(AcademicRecord.student_id == student.id).order_by(AcademicRecord.record_date.desc(), AcademicRecord.id.desc())).all()
    dated_marks = [r.marks_obtained / r.max_marks * 100 for r in records if r.marks_obtained is not None and r.max_marks and r.max_marks > 0]
    recent_drop = None
    if len(dated_marks) >= 2: recent_drop = dated_marks[1] - dated_marks[0]
    consecutive = next((r.consecutive_absences for r in records if r.consecutive_absences is not None), None)
    repeated_low = float(sum(1 for value in dated_marks if value < 55)) if dated_marks else None
    return {
        "attendance_percent": student.attendance, "internal_marks_percent": student.internal_marks,
        "assignment_completion_percent": student.assignments_completed, "previous_failures": float(student.previous_failures),
        "absence_count": float(student.absences), "consecutive_absences": float(consecutive) if consecutive is not None else None,
        "recent_mark_drop": recent_drop, "repeated_low_results": repeated_low,
    }


def assessment_signals(features: dict[str, Optional[float]]) -> list[str]:
    items = []
    if features["attendance_percent"] is not None and features["attendance_percent"] < 75: items.append("Attendance below 75%; ask about barriers without blame.")
    if features["internal_marks_percent"] is not None and features["internal_marks_percent"] < 55: items.append("Internal marks below 55%; review subject results and learning gaps.")
    if features["assignment_completion_percent"] is not None and features["assignment_completion_percent"] < 75: items.append("Assignment completion below 75%; consider smaller milestones.")
    if features["recent_mark_drop"] is not None and features["recent_mark_drop"] >= 10: items.append("A recent subject mark decline of at least 10 percentage points is recorded.")
    if features["consecutive_absences"] is not None and features["consecutive_absences"] >= 3: items.append("Consecutive absences are recorded; check in supportively.")
    if not items: items.append("No configured threshold crossed in the available academic fields.")
    return items


def support_suggestions(features: dict[str, Optional[float]]) -> list[dict[str, str]]:
    suggestions = []
    if (features["internal_marks_percent"] is not None and features["internal_marks_percent"] < 55) or (features["recent_mark_drop"] is not None and features["recent_mark_drop"] >= 10):
        suggestions.append({"title": "Subject-specific learning support", "why": "Recorded subject results may need a closer learning review.", "conversation": "Ask which concepts feel difficult and agree a short revision plan."})
    if (features["attendance_percent"] is not None and features["attendance_percent"] < 75) or (features["consecutive_absences"] is not None and features["consecutive_absences"] >= 3):
        suggestions.append({"title": "Attendance support conversation", "why": "Attendance signals warrant understanding practical barriers.", "conversation": "Discuss barriers privately and agree a manageable check-in."})
    if features["assignment_completion_percent"] is not None and features["assignment_completion_percent"] < 75:
        suggestions.append({"title": "Assignment catch-up", "why": "Smaller milestones may make pending work easier to approach.", "conversation": "Agree one priority task before the next check-in."})
    if not suggestions:
        suggestions.append({"title": "Strength-based progress plan", "why": "No configured threshold crossed in available fields.", "conversation": "Ask what is working well and choose an optional stretch goal together."})
    return suggestions


@app.post("/api/ai/students/{student_id}/assessment")
def ml_assess_student(student_id: int, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    if ML_MODEL is None: raise app_error("No trained model is available. Use the approved labelled CSV training workflow first.", 409)
    import numpy as np
    features = student_model_features(student, db)
    vector = np.array([[np.nan if features[name] is None else features[name] for name in MODEL_FEATURES]], dtype=float)
    pipeline = ML_MODEL["pipeline"] if isinstance(ML_MODEL, dict) else ML_MODEL
    probabilities = pipeline.predict_proba(vector)[0]
    classes = list(pipeline.named_steps["classifier"].classes_)
    positive_index = classes.index(1) if 1 in classes else -1
    probability = float(probabilities[positive_index])
    band = "HIGH" if probability >= .65 else "MEDIUM" if probability >= .35 else "LOW"
    signals = assessment_signals(features); suggestions = support_suggestions(features)
    warnings = []
    if features["consecutive_absences"] is None or features["recent_mark_drop"] is None or features["repeated_low_results"] is None:
        warnings.append("Some temporal features are missing. Missing values are imputed by the approved training pipeline, not interpreted as zero.")
    version = ML_METADATA.get("modelVersion", "unknown")
    row = RiskAssessment(institution_id=student.institution_id, student_id=student.id, assessment_type="TRAINED_PROTOTYPE",
                         risk_score=probability * 100, risk_band=band,
                         explanation="Estimate for the defined next-period academic deterioration outcome; this is not a diagnosis or cause.",
                         deterioration_probability=probability, model_version=version,
                         features_json=json.dumps(features), signals_json=json.dumps(signals), suggestions_json=json.dumps(suggestions))
    db.add(row); audit(db, user, "ML_ASSESSMENT_CREATE", f"Research model assessment created for {student.student_code}.", student.id); db.commit(); db.refresh(row)
    return {"assessmentId": row.id, "studentId": student.id, "assessmentType": "TRAINED_PROTOTYPE",
            "modelVersion": version, "deteriorationProbability": round(probability, 4), "supportPriority": band,
            "observedFeatures": features, "observedSignals": signals, "supportSuggestions": suggestions,
            "requiresHumanReview": True, "dataQualityWarnings": warnings, "assessedAt": row.assessed_at.isoformat(),
            "interpretation": "This estimates only the defined next-period subject-average decline outcome. It does not identify causes, diagnose a student or decide support. Review context with the student and mentor."}


@app.get("/api/ai/students/{student_id}/history")
def ml_assessment_history(student_id: int, user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    student = require_student_scope(student_id, user, db)
    rows = db.scalars(select(RiskAssessment).where(RiskAssessment.student_id == student.id, RiskAssessment.institution_id == student.institution_id,
                                                   RiskAssessment.assessment_type == "TRAINED_PROTOTYPE").order_by(RiskAssessment.assessed_at.desc())).all()
    return [{"assessmentId": row.id, "studentId": row.student_id, "deteriorationProbability": row.deterioration_probability,
             "supportPriority": row.risk_band, "modelVersion": row.model_version, "featuresJson": row.features_json,
             "signalsJson": row.signals_json, "suggestionsJson": row.suggestions_json, "assessedAt": row.assessed_at.isoformat(),
             "interpretation": row.explanation, "requiresHumanReview": True, "dataQualityWarnings": []} for row in rows]


@app.get("/api/ai/model/status")
def ai_model_status(user: PortalUser = Depends(require_roles("SUPER_ADMIN", "INSTITUTION_ADMIN"))):
    return model_status()


@app.post("/api/ai/model/train", tags=["AI research"]) 
def train_academic_model(request: Request, file: UploadFile = File(...), user: PortalUser = Depends(require_roles("SUPER_ADMIN"))):
    global ML_MODEL, ML_METADATA
    RATE_LIMITER.check(client_rate_key(request, "model-train"), 3, 3600)
    if not file.filename.lower().endswith(".csv"): raise app_error("Upload a CSV file.")
    raw = file.file.read(MAX_CSV_UPLOAD_BYTES + 1)
    if len(raw) > MAX_CSV_UPLOAD_BYTES: raise app_error(f"CSV file must be {MAX_CSV_UPLOAD_BYTES // (1024 * 1024)} MB or smaller.", 413)
    text_data = raw.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text_data))
    required = {"student_key", *MODEL_FEATURES, MODEL_TARGET}
    headers = set(reader.fieldnames or [])
    missing = sorted(required - headers)
    if missing: raise app_error("Missing CSV columns: " + ", ".join(missing))
    rows = list(reader)
    if len(rows) < 100: raise app_error("At least 100 labelled snapshots are required by this prototype guard.")
    keys = {row["student_key"].strip() for row in rows if row.get("student_key", "").strip()}
    if len(keys) < 30: raise app_error("At least 30 distinct pseudonymous student_key values are required.")
    try:
        import numpy as np
        import joblib
        from sklearn.compose import ColumnTransformer
        from sklearn.impute import SimpleImputer
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
        from sklearn.model_selection import GroupShuffleSplit
        from sklearn.pipeline import Pipeline
        X, y, groups = [], [], []
        for row in rows:
            values=[]
            for feature in MODEL_FEATURES:
                value=(row.get(feature) or "").strip()
                number=np.nan if value in {"", "?"} else float(value)
                if not np.isnan(number) and (not np.isfinite(number) or number < 0):
                    raise ValueError(f"{feature} contains an invalid negative or non-finite value")
                maximum = {
                    "attendance_percent": 100, "internal_marks_percent": 100,
                    "assignment_completion_percent": 100, "previous_failures": 100,
                    "absence_count": 365, "consecutive_absences": 365,
                    "recent_mark_drop": 100, "repeated_low_results": 100,
                }[feature]
                if not np.isnan(number) and number > maximum:
                    raise ValueError(f"{feature} must not exceed {maximum}")
                values.append(number)
            if not (row.get("student_key") or "").strip():
                raise ValueError("student_key is required for grouped student validation")
            label = int((row.get(MODEL_TARGET) or "").strip())
            if label not in {0,1}: raise ValueError(f"{MODEL_TARGET} must be 0 or 1")
            X.append(values); y.append(label); groups.append(row["student_key"].strip())
        X=np.asarray(X,dtype=float); y=np.asarray(y,dtype=int); groups=np.asarray(groups)
        splitter=GroupShuffleSplit(n_splits=1,test_size=.20,random_state=42)
        train_idx,test_idx=next(splitter.split(X,y,groups))
        y_train,y_test=y[train_idx],y[test_idx]
        if min(np.sum(y_train==0),np.sum(y_train==1),np.sum(y_test==0),np.sum(y_test==1)) < 5:
            raise ValueError("Both target classes need at least five rows in train and holdout partitions.")
        pipeline=Pipeline([("imputer",SimpleImputer(strategy="median",add_indicator=True)),
                           ("classifier",RandomForestClassifier(n_estimators=300,max_depth=8,min_samples_leaf=5,random_state=42,class_weight="balanced_subsample"))])
        pipeline.fit(X[train_idx],y_train)
        pred=pipeline.predict(X[test_idx]);prob=pipeline.predict_proba(X[test_idx])[:,1]
        metrics={"totalRows":int(len(rows)),"uniqueStudents":int(len(keys)),"trainRows":int(len(train_idx)),"testRows":int(len(test_idx)),
                 "accuracy":float(accuracy_score(y_test,pred)),"precision":float(precision_score(y_test,pred,zero_division=0)),
                 "recall":float(recall_score(y_test,pred,zero_division=0)),"f1":float(f1_score(y_test,pred,zero_division=0)),
                 "rocAuc":float(roc_auc_score(y_test,prob)),"confusionMatrix":confusion_matrix(y_test,pred).tolist(),
                 "validationMethod":"Student-grouped random 80/20 holdout; temporal and external validation are still required."}
        version="ss-sklearn-rf-"+utcnow().strftime("%Y%m%d-%H%M%S")
        bundle={"pipeline":pipeline,"features":MODEL_FEATURES,"modelVersion":version}
        joblib.dump(bundle,MODEL_PATH)
        meta={"modelVersion":version,"trainedAt":utcnow().isoformat(),"metrics":metrics,"target":MODEL_TARGET}
        MODEL_META_PATH.write_text(json.dumps(meta,indent=2),encoding="utf-8")
        ML_MODEL=bundle
        ML_METADATA=meta
        with SessionLocal() as audit_db:
            actor=audit_db.get(PortalUser,user.id)
            audit(audit_db,actor,"ACADEMIC_MODEL_TRAINED",f"Trained research Random Forest {version} from an approved labelled CSV.")
            audit_db.commit()
        return {"status":"TRAINED_PROTOTYPE","modelVersion":version,"trainedAt":meta["trainedAt"],"target":MODEL_TARGET,"metrics":metrics,
                "note":"Research prototype only. Human review and later-term/external validation are required."}
    except Exception as exc:
        raise app_error(f"Training failed: {exc}")


# --------------------------- chatbot + insights ---------------------------
@app.post("/api/chat/interactions")
def chat_interaction(payload: ChatRequest, user: PortalUser = Depends(require_roles("STUDENT")), db: Session = Depends(get_db)):
    student = require_own_student(user, db)
    if not user.chat_monitoring_consent:
        raise app_error("Chat companion access is paused because chatbot monitoring consent is off. Open My profile to review the institutional privacy notice.", 403)
    topic, sentiment, _ = classify_chat(payload.message)
    reply = empathetic_reply(payload.message, topic, sentiment, user.ai_mentor_name)
    row = ChatInteraction(institution_id=user.institution_id, user_id=user.id, student_id=student.id,
                          topic=topic, sentiment=sentiment, user_message=payload.message.strip(),
                          assistant_reply=reply, expires_at=utcnow()+timedelta(days=CHAT_RETENTION_DAYS))
    audit(db, user, "CHAT_INTERACTION_RECORDED", f"Chat activity recorded; topic={topic}, tone={sentiment}.", student.id)
    db.add(row); db.commit()
    return {"id": row.id, "reply": reply, "topic": topic, "sentiment": sentiment,
            "notice": "This interaction is stored for institution-visible usage analytics under the privacy notice and retention period."}


@app.get("/api/chat/my-analytics")
def my_chat_analytics(user: PortalUser = Depends(require_roles("STUDENT")), db: Session = Depends(get_db)):
    student = require_own_student(user, db)
    cutoff = utcnow() - timedelta(days=30)
    rows = db.scalars(select(ChatInteraction).where(ChatInteraction.user_id == user.id, ChatInteraction.student_id == student.id,
             ChatInteraction.created_at >= cutoff, ChatInteraction.expires_at > utcnow())).all()
    topics = dict(Counter(row.topic for row in rows))
    active_days = len({row.created_at.date() for row in rows})
    band = "LOW_ACTIVITY" if len(rows) < 3 else "STEADY_ACTIVITY" if active_days < 5 else "HIGH_ACTIVITY"
    return {"interactionCount": len(rows), "activeDays": active_days, "distinctTopics": len(topics),
            "activityBand": band, "topics": topics,
            "notice": f"Your institution can review retained interaction records for support and service oversight. Records expire after {CHAT_RETENTION_DAYS} days. Topic labels are estimates, not diagnoses."}


# ------------------------- admin AI / audit APIs --------------------------
@app.get("/api/ai-admin/interpretations")
def list_interpretations(user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant = require_tenant_admin(user)
    rows = db.scalars(select(ManualInterpretation).where(ManualInterpretation.institution_id == tenant).order_by(ManualInterpretation.created_at.desc()).limit(300)).all()
    result=[]
    for row in rows:
        student=db.get(Student,row.student_id)
        result.append({"id":row.id,"studentId":row.student_id,"studentNameSnapshot":student.full_name if student else "Student",
                       "reviewStatus":row.review_status,"interpretation":row.summary,"evidence":row.context,
                       "nextAction":row.next_step,"createdAt":row.created_at.isoformat()})
    return result


@app.post("/api/ai-admin/students/{student_id}/interpretations")
def add_interpretation(student_id: int, payload: InterpretationRequest, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student=require_student_scope(student_id,user,db)
    row=ManualInterpretation(institution_id=student.institution_id,student_id=student.id,author=payload.author.strip(),
                             summary=(payload.summary or payload.interpretation).strip(),context=(payload.context or payload.evidence).strip(),
                             next_step=(payload.nextStep or payload.nextAction).strip(),review_status=payload.reviewStatus.strip())
    db.add(row);audit(db,user,"MANUAL_INTERPRETATION_CREATED",f"Manual interpretation saved for {student.student_code}.",student.id);db.commit();db.refresh(row)
    return {"id":row.id,"studentId":row.student_id,"studentNameSnapshot":student.full_name,"reviewStatus":row.review_status,
            "interpretation":row.summary,"evidence":row.context,"nextAction":row.next_step,"createdAt":row.created_at.isoformat()}


@app.get("/api/ai-admin/students/{student_id}/interpretations")
def student_interpretations(student_id: int, user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    student=require_student_scope(student_id,user,db)
    rows=db.scalars(select(ManualInterpretation).where(ManualInterpretation.student_id==student.id,ManualInterpretation.institution_id==student.institution_id).order_by(ManualInterpretation.created_at.desc())).all()
    return [{"id":row.id,"studentId":row.student_id,"author":row.author,"summary":row.summary,"context":row.context,"nextStep":row.next_step,"reviewStatus":row.review_status,"createdAt":row.created_at.isoformat()} for row in rows]


@app.get("/api/fairness/audit")
def fairness_audit(user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")), db: Session = Depends(get_db)):
    tenant=require_tenant_admin(user)
    students=db.scalars(select(Student).where(Student.institution_id==tenant)).all()
    assessments=db.scalars(select(RiskAssessment).where(RiskAssessment.institution_id==tenant,RiskAssessment.assessment_type=="RULE_BASED_SUPPORT_SCREENING").order_by(RiskAssessment.assessed_at.desc())).all()
    latest={}
    for row in assessments: latest.setdefault(row.student_id,row)
    groups=defaultdict(list)
    for student in students:
        key=student.audit_group or "Not specified"
        if student.id in latest: groups[key].append(latest[student.id])
    return {"groups":{name:{"assessedCount":len(rows),"highRiskRate":sum(1 for row in rows if row.risk_band=="HIGH")/len(rows) if rows else 0} for name,rows in groups.items()},
            "notice":"Descriptive comparison only. Audit groups are not model predictors. Review lawful purpose, sample sizes and context before drawing conclusions."}


@app.get("/api/interventions")
def interventions(user: PortalUser = Depends(current_user)):
    return [
        {"id":"I1","name":"Academic mentoring","description":"Weekly one-to-one review of coursework and a student-owned study plan.","forIndicators":["Low internal marks","Previous course failures"]},
        {"id":"I2","name":"Attendance support","description":"Check in privately, identify practical barriers and agree a realistic attendance plan.","forIndicators":["Low attendance","High absence count"]},
        {"id":"I3","name":"Assignment catch-up","description":"Break pending assignments into small milestones with tutor support.","forIndicators":["Incomplete assignments"]},
        {"id":"I4","name":"Peer learning group","description":"Offer optional peer study sessions and subject-specific practice.","forIndicators":["Low internal marks","Incomplete assignments"]},
    ]


@app.post("/api/import/students", tags=["Institution administration"])
def import_students(request: Request, file: UploadFile = File(...),
                    user: PortalUser = Depends(require_roles("INSTITUTION_ADMIN")),
                    db: Session = Depends(get_db)):
    """Validate the complete CSV before inserting records in one transaction."""
    tenant = require_tenant_admin(user)
    RATE_LIMITER.check(client_rate_key(request, "student-csv-import"), 5, 600)
    if not (file.filename or "").lower().endswith(".csv"):
        raise app_error("Upload a .csv file.")
    raw = file.file.read(MAX_CSV_UPLOAD_BYTES + 1)
    if len(raw) > MAX_CSV_UPLOAD_BYTES:
        raise app_error(f"CSV file must be {MAX_CSV_UPLOAD_BYTES // (1024 * 1024)} MB or smaller.", 413)
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise app_error("CSV must use UTF-8 encoding.") from exc
    reader = csv.DictReader(io.StringIO(decoded))
    required = {"student_code", "full_name", "attendance", "internal_marks", "assignments_completed", "previous_failures", "absences"}
    headers = set(reader.fieldnames or [])
    if not required.issubset(headers):
        raise app_error("CSV is missing required columns: " + ", ".join(sorted(required - headers)))

    existing_codes = {
        value.lower() for value in db.scalars(
            select(Student.student_code).where(Student.institution_id == tenant)
        ).all()
    }
    seen_codes: set[str] = set()
    prepared: list[Student] = []
    errors: list[str] = []
    error_count = 0
    rows_seen = 0
    for line, row in enumerate(reader, start=2):
        rows_seen += 1
        if rows_seen > 20000:
            raise app_error("CSV contains more than 20,000 data rows. Split it into smaller files.", 413)
        try:
            code = (row.get("student_code") or "").strip()
            name = (row.get("full_name") or "").strip()
            if not code or len(code) > 30 or not name or len(name) > 120:
                raise ValueError("student_code (1–30 chars) and full_name (1–120 chars) are required")
            normalized_code = code.casefold()
            if normalized_code in existing_codes or normalized_code in seen_codes:
                raise ValueError(f"duplicate student_code {code}")
            attendance = float(row["attendance"])
            marks = float(row["internal_marks"])
            assignments = float(row["assignments_completed"])
            failures = int(row["previous_failures"])
            absences = int(row["absences"])
            if not all(0 <= value <= 100 for value in (attendance, marks, assignments)):
                raise ValueError("attendance, internal_marks and assignments_completed must be 0–100")
            if not 0 <= failures <= 100 or not 0 <= absences <= 365:
                raise ValueError("previous_failures must be 0–100 and absences 0–365")
            email = (row.get("email") or "").strip().lower()
            audit_group = (row.get("audit_group") or "").strip()
            if len(email) > 180 or len(audit_group) > 80:
                raise ValueError("email or audit_group exceeds its maximum length")
            prepared.append(Student(
                institution_id=tenant, student_code=code, full_name=name, email=email,
                attendance=attendance, internal_marks=marks, assignments_completed=assignments,
                previous_failures=failures, absences=absences, audit_group=audit_group,
            ))
            seen_codes.add(normalized_code)
        except (ValueError, TypeError, KeyError) as exc:
            error_count += 1
            if len(errors) < 200:
                errors.append(f"Row {line}: {str(exc)[:180]}")

    # Do not leave a half-imported class list when any row is invalid.
    if error_count:
        return {"imported": 0, "skipped": error_count, "errors": errors,
                "message": "No records were imported. Correct the listed rows and upload again."}
    if not prepared:
        raise app_error("The CSV contains no student rows.")
    try:
        db.add_all(prepared)
        audit(db, user, "STUDENT_CSV_IMPORT", f"Imported {len(prepared)} student record(s).")
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"imported": len(prepared), "skipped": 0, "errors": [],
            "message": f"Successfully imported {len(prepared)} student records."}


@app.get("/api/dashboard")
def dashboard(user: PortalUser = Depends(current_user), db: Session = Depends(get_db)):
    if user.role == "SUPER_ADMIN":
        return {"institutions": db.scalar(select(func.count(Institution.id))) or 0}
    if user.role == "STUDENT":
        student=require_own_student(user,db)
        return {"student":student_dict(student),"progress":my_progress(user,db)}
    tenant=require_tenant_admin(user)
    return {"students":db.scalar(select(func.count(Student.id)).where(Student.institution_id==tenant)) or 0,
            "pendingRequests":db.scalar(select(func.count(PortalUser.id)).where(PortalUser.institution_id==tenant,PortalUser.account_status=="PENDING")) or 0}


@app.get("/", include_in_schema=False)
def root():
    response = {"service": "ShikshaSetu API", "health": "/api/health", "version": app.version}
    if not IS_PRODUCTION:
        response["docs"] = "/api/docs"
    return response


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "requestId": getattr(request.state, "request_id", None)},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Do not echo submitted input values: validation errors can contain private data.
    errors = [{"location": list(error.get("loc", ())), "message": error.get("msg", "Invalid value"),
               "type": error.get("type", "validation_error")} for error in exc.errors()]
    return JSONResponse(
        status_code=422,
        content={"detail": "Request validation failed. Check the highlighted fields.",
                 "errors": errors, "requestId": getattr(request.state, "request_id", None)},
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unavailable")
    LOGGER.exception("unhandled_exception request_id=%s method=%s path=%s", request_id,
                     request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected server error occurred. Please try again or contact support.",
                 "requestId": request_id},
    )
