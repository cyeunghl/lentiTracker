"""Runtime schema patching for legacy SQLite databases."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import inspect, text

from .database import db


def ensure_sqlite_schema() -> None:
    """Add any missing columns that newer builds require."""
    engine = db.engine
    if not engine.url.drivername.startswith('sqlite'):
        return

    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if 'experiments' not in table_names:
        return

    def add_missing_columns(table_name: str, required_columns: dict[str, str]) -> None:
        if table_name not in table_names:
            return
        existing = {column['name'] for column in inspect(engine).get_columns(table_name)}
        missing = {name: ddl for name, ddl in required_columns.items() if name not in existing}
        if not missing:
            return
        with engine.begin() as connection:
            for column_name, column_type in missing.items():
                connection.execute(
                    text(f'ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}')
                )

    experiment_required = {
        'name': 'VARCHAR(128)',
        'status': 'VARCHAR(32)',
        'finished_at': 'DATETIME',
        'passage_number': 'VARCHAR(64)',
        'cell_concentration': 'FLOAT',
        'cells_to_seed': 'FLOAT',
        'vessel_type': 'VARCHAR(64)',
        'media_type': 'VARCHAR(128)',
        'vessels_seeded': 'INTEGER',
        'seeding_date': 'DATE',
        'seeding_volume_ml': 'FLOAT',
        'created_at': 'DATETIME',
        'updated_at': 'DATETIME',
    }
    add_missing_columns('experiments', experiment_required)

    with engine.begin() as connection:
        connection.execute(
            text("UPDATE experiments SET media_type = 'DMEM + 10% FBS' WHERE media_type IS NULL")
        )
        connection.execute(
            text("UPDATE experiments SET name = COALESCE(name, 'Untitled Experiment')")
        )
        connection.execute(
            text("UPDATE experiments SET status = COALESCE(status, 'active')")
        )
        connection.execute(
            text('UPDATE experiments SET vessels_seeded = 1 WHERE vessels_seeded IS NULL')
        )
        today = datetime.utcnow().date().isoformat()
        connection.execute(
            text('UPDATE experiments SET seeding_date = COALESCE(seeding_date, :today)'),
            {'today': today},
        )
        now = datetime.utcnow().isoformat()
        connection.execute(
            text(
                "UPDATE experiments "
                "SET created_at = COALESCE(created_at, :now), "
                "updated_at = COALESCE(updated_at, :now)"
            ),
            {'now': now},
        )

    add_missing_columns(
        'transfections',
        {
            'transfer_volume_ul': 'FLOAT',
            'packaging_volume_ul': 'FLOAT',
            'envelope_volume_ul': 'FLOAT',
            'transfer_concentration_ng_ul': 'FLOAT',
            'packaging_concentration_ng_ul': 'FLOAT',
            'envelope_concentration_ng_ul': 'FLOAT',
            'ratio_display': 'VARCHAR(64)',
        },
    )

    add_missing_columns(
        'lentivirus_preps',
        {
            'plate_count': 'INTEGER',
        },
    )
    with engine.begin() as connection:
        connection.execute(
            text('UPDATE lentivirus_preps SET plate_count = 1 WHERE plate_count IS NULL')
        )

    add_missing_columns(
        'titer_runs',
        {
            'polybrene_ug_ml': 'FLOAT',
            'measurement_media_ml': 'FLOAT',
            'control_cell_concentration': 'FLOAT',
        },
    )

    add_missing_columns(
        'titer_samples',
        {
            'cell_concentration': 'FLOAT',
        },
    )
