"""Add explicit object transport counts, including installations without startup seed."""
import json
import sqlalchemy as sa
from alembic import op

revision = "e731bc902ad4"
down_revision = "d612a473fe80"
branch_labels = None
depends_on = None

FIELDS = [
    ("warehouse", "internal_moves_per_day", "Внутрискладские перемещения в сутки", 800, 903),
    ("medical", "cargo_trips_per_day", "Перевозки грузов в сутки", 40, 901),
    ("medical", "linen_trips_per_day", "Перевозки белья в сутки", 20, 902),
    ("medical", "food_trips_per_day", "Перевозки питания в сутки", 30, 903),
    ("medical", "medicine_trips_per_day", "Перевозки медикаментов в сутки", 40, 904),
    ("medical", "waste_trips_per_day", "Перевозки отходов в сутки", 20, 905),
]


def upgrade():
    db = op.get_bind()
    db.execute(sa.text("""
        INSERT INTO data_sources (code, title, source_type, publisher, notes)
        VALUES ('object_transport_defaults', 'Демонстрационные объёмы перевозок — допущение команды',
                'team_assumption', 'Команда Robo-Factory',
                'Состав полей — п. 3.2.1 ТЗ. Значения являются примером и уточняются по данным объекта.')
        ON CONFLICT (code) DO NOTHING
    """))
    for facility, code, name, value, order in FIELDS:
        db.execute(sa.text("""
            INSERT INTO parameter_definitions
                (facility_type_id, code, name, section, data_type, unit, is_required,
                 default_value, min_value, max_value, source_id, source_note, hint, sort_order)
            SELECT f.id, :code, :name, 'Потоки перевозок', 'integer', 'рейсов/сутки', true,
                   CAST(:value AS jsonb), 0, 1000000000, s.id,
                   'Демонстрационное допущение команды. Замените фактическими замерами объекта.',
                   'Число отдельных перемещений за сутки; 0, если поток отсутствует.', :sort_order
            FROM facility_types f CROSS JOIN data_sources s
            WHERE f.code = :facility AND s.code = 'object_transport_defaults'
            ON CONFLICT (facility_type_id, code) DO NOTHING
        """), {"facility": facility, "code": code, "name": name, "value": json.dumps(value), "sort_order": order})
        db.execute(sa.text("""
            UPDATE projects p SET
                parameters = COALESCE(p.parameters, '{}'::jsonb) || CAST(:values AS jsonb),
                parameter_origins = COALESCE(p.parameter_origins, '{}'::jsonb) || CAST(:origins AS jsonb),
                updated_at = now()
            FROM facility_types f
            WHERE p.facility_type_id = f.id AND f.code = :facility AND p.is_demo = true
              AND NOT (COALESCE(p.parameters, '{}'::jsonb) ? :code)
        """), {"facility": facility, "code": code, "values": json.dumps({code: value}),
                 "origins": json.dumps({code: "team_assumption"})})


def downgrade():
    # Preserve administrator edits and project history; these are additive reference records.
    pass
