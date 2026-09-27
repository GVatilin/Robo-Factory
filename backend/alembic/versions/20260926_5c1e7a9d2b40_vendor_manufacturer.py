"""vendor link and manufacturer contacts

Revision ID: 5c1e7a9d2b40
Revises: 38f4eb005110
Create Date: 2026-09-26 12:00:00.000000+00:00

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '5c1e7a9d2b40'
down_revision: str | None = '38f4eb005110'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('manufacturers', sa.Column('region', sa.String(length=200), nullable=True))
    op.add_column('manufacturers', sa.Column('contact_email', sa.String(length=320), nullable=True))
    op.add_column('manufacturers', sa.Column('phone', sa.String(length=50), nullable=True))
    op.add_column('users', sa.Column('manufacturer_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_users_manufacturer_id'), 'users', ['manufacturer_id'], unique=False)
    op.create_foreign_key(
        op.f('fk_users_manufacturer_id_manufacturers'), 'users', 'manufacturers',
        ['manufacturer_id'], ['id'], ondelete='SET NULL',
    )
    # Регион производителя — самый частый регион его продуктов из уже загруженного каталога.
    op.execute(
        """
        UPDATE manufacturers m SET region = sub.region
        FROM (
            SELECT DISTINCT ON (manufacturer_id) manufacturer_id, region
            FROM products
            WHERE manufacturer_id IS NOT NULL AND region IS NOT NULL
            GROUP BY manufacturer_id, region
            ORDER BY manufacturer_id, count(*) DESC, region
        ) sub
        WHERE m.id = sub.manufacturer_id AND m.region IS NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint(op.f('fk_users_manufacturer_id_manufacturers'), 'users', type_='foreignkey')
    op.drop_index(op.f('ix_users_manufacturer_id'), table_name='users')
    op.drop_column('users', 'manufacturer_id')
    op.drop_column('manufacturers', 'phone')
    op.drop_column('manufacturers', 'contact_email')
    op.drop_column('manufacturers', 'region')
