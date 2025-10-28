"""Database helpers and extension instances."""
from __future__ import annotations

from pathlib import Path

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

INSTANCE_RELATIVE = Path('instance')
DB_FILENAME = 'lenti_tracker.db'


db = SQLAlchemy()
migrate = Migrate()


def prepare_database_paths(root_path: Path) -> Path:
    """Ensure the SQLite database lives in the package instance directory."""
    instance_path = root_path / INSTANCE_RELATIVE
    instance_path.mkdir(parents=True, exist_ok=True)

    db_path = instance_path / DB_FILENAME
    legacy_path = root_path / DB_FILENAME
    if legacy_path.exists() and not db_path.exists():
        legacy_path.replace(db_path)
    return db_path
