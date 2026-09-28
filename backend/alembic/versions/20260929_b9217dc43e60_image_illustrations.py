"""Distinguish sourced illustrations from exact product photographs."""
from alembic import op
import sqlalchemy as sa

revision = 'b9217dc43e60'
down_revision = '8a3f61c2d7e9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('product_images', sa.Column('is_illustration', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('product_images', sa.Column('caption', sa.String(500), nullable=True))


def downgrade():
    op.drop_column('product_images', 'caption')
    op.drop_column('product_images', 'is_illustration')
