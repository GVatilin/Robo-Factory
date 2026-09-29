"""Sourced company logos."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c5b3e981a742"
down_revision = "b9217dc43e60"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("manufacturers", sa.Column("logo_metadata", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("manufacturers", "logo_metadata")
