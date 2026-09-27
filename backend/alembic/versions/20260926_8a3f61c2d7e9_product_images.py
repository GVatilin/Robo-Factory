"""product images

Revision ID: 8a3f61c2d7e9
Revises: 5c1e7a9d2b40
Create Date: 2026-09-26 21:00:00.000000+00:00

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '8a3f61c2d7e9'
down_revision: str | None = '5c1e7a9d2b40'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('product_images',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('product_id', sa.Integer(), nullable=False),
    sa.Column('original_name', sa.String(length=300), nullable=True),
    sa.Column('width', sa.Integer(), nullable=False),
    sa.Column('height', sa.Integer(), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('source_id', sa.Integer(), nullable=True),
    sa.Column('uploaded_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], name=op.f('fk_product_images_product_id_products'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['source_id'], ['data_sources.id'], name=op.f('fk_product_images_source_id_data_sources'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'], name=op.f('fk_product_images_uploaded_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_product_images')),
    sa.UniqueConstraint('product_id', name=op.f('uq_product_images_product_id'))
    )


def downgrade() -> None:
    op.drop_table('product_images')
