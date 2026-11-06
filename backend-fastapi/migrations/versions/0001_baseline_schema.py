"""Create missing ShikshaSetu tables and safely adopt existing databases.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-06
"""
from alembic import op
from sqlalchemy import Column, String, inspect

from app import Base

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # create_all is intentionally used only for this baseline so an existing
    # deployment is adopted without dropping or rebuilding any application data.
    Base.metadata.create_all(bind=bind, checkfirst=True)
    inspector = inspect(bind)
    user_columns = {item["name"] for item in inspector.get_columns("portal_users")}
    if "firebase_uid" not in user_columns:
        op.add_column("portal_users", Column("firebase_uid", String(128), nullable=True))
    inspector = inspect(bind)
    indexes = inspector.get_indexes("portal_users")
    unique_exists = any(
        item.get("unique") and item.get("column_names") == ["firebase_uid"]
        for item in indexes
    )
    if not unique_exists:
        op.create_index("uq_portal_users_firebase_uid", "portal_users", ["firebase_uid"], unique=True)


def downgrade() -> None:
    # This baseline may be applied to a live pre-Alembic database. Destructive
    # rollback is deliberately disabled to protect existing institution data.
    raise RuntimeError("Baseline downgrade is intentionally disabled; use a reviewed forward migration.")
