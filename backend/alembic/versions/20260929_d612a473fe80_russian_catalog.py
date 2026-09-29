"""Unpublish non-Russian/unknown origin products without deleting project history."""
from alembic import op

revision = "d612a473fe80"
down_revision = "c5b3e981a742"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        UPDATE products p SET is_published = false,
            source_payload = COALESCE(source_payload, '{}'::jsonb) ||
                jsonb_build_object('russian_catalog_archive', jsonb_build_object(
                    'previously_published', is_published, 'date', '2026-09-29',
                    'reason', 'Manufacturer or product origin is not recorded as Russia'))
        WHERE NOT (
            lower(trim(COALESCE(p.country_of_origin, ''))) IN
                ('россия', 'рф', 'российская федерация', 'russia', 'russian federation', 'ru', 'rus')
            AND EXISTS (SELECT 1 FROM manufacturers m WHERE m.id = p.manufacturer_id
                AND lower(trim(COALESCE(m.country, ''))) IN
                    ('россия', 'рф', 'российская федерация', 'russia', 'russian federation', 'ru', 'rus'))
        )
    """)


def downgrade():
    op.execute("""
        UPDATE products SET
            is_published = COALESCE((source_payload->'russian_catalog_archive'->>'previously_published')::boolean, false),
            source_payload = source_payload - 'russian_catalog_archive'
        WHERE source_payload ? 'russian_catalog_archive'
    """)
