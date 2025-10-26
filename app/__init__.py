"""Application factory for the Lentivirus tracker."""
from __future__ import annotations

from pathlib import Path

from flask import Flask

from .database import db, migrate, prepare_database_paths
from .schema import ensure_sqlite_schema


def create_app() -> Flask:
    app = Flask(__name__)

    db_path = prepare_database_paths(Path(app.root_path))
    app.config.update(
        SQLALCHEMY_DATABASE_URI=f'sqlite:///{db_path}',
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        SQLALCHEMY_ENGINE_OPTIONS={'connect_args': {'check_same_thread': False}},
    )

    db.init_app(app)
    migrate.init_app(app, db)

    # Import models so SQLAlchemy is aware of them before creating tables.
    from . import models  # pylint: disable=import-outside-toplevel
    from .routes import bp as main_bp

    app.register_blueprint(main_bp)

    with app.app_context():
        db.create_all()
        ensure_sqlite_schema()

    return app
