import math
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from sqlalchemy import inspect, text

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_PATH = BASE_DIR / 'instance'
INSTANCE_PATH.mkdir(parents=True, exist_ok=True)
DB_PATH = INSTANCE_PATH / 'lenti_tracker.db'
LEGACY_DB_PATH = BASE_DIR / 'lenti_tracker.db'
if LEGACY_DB_PATH.exists() and not DB_PATH.exists():
    LEGACY_DB_PATH.replace(DB_PATH)

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_PATH}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'connect_args': {
        'check_same_thread': False,
    }
}

db = SQLAlchemy(app)
migrate = Migrate(app, db)


SURFACE_AREAS = {
    'T175': 175.0,
    'T150': 150.0,
    'T75': 75.0,
    'T25': 25.0,
    'T12.5': 12.5,
    '15 cm dish': 145.0,
    '10 cm dish': 55.0,
    '6-well': 58.0,  # total for the plate
    '12-well': 38.0,
    '24-well': 21.0,
    '96-well': 3.36,
}

BASE_SEEDING = {
    'cells': 15_000_000,
    'volume_ml': 20.0,
    'density': 750_000,
    'vessel': 'T175'
}

BASE_TRANSFECTION = {
    'vessel': 'T175',
    'surface_area': SURFACE_AREAS['T175'],
    'opti_mem_ml': 1.0,
    'xtremegene_ul': 76.8,
    'total_plasmid_ug': 25.6,
    'reagent_to_dna_ratio': 3.0
}

PACKAGING_PLASMID_BP = 10709
ENVELOPE_PLASMID_BP = 5822
DEFAULT_MOLAR_RATIO = (4, 3, 1)


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Experiment(db.Model, TimestampMixin):
    __tablename__ = 'experiments'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False, default='Untitled Experiment')
    status = db.Column(db.String(32), nullable=False, default='active')
    finished_at = db.Column(db.DateTime)
    cell_line = db.Column(db.String(128), nullable=False)
    passage_number = db.Column(db.String(64))
    cell_concentration = db.Column(db.Float)
    cells_to_seed = db.Column(db.Float)
    vessel_type = db.Column(db.String(64), nullable=False)
    seeding_volume_ml = db.Column(db.Float)
    media_type = db.Column(db.String(128))
    vessels_seeded = db.Column(db.Integer)
    seeding_date = db.Column(db.Date)

    preps = db.relationship('LentivirusPrep', backref='experiment', cascade='all, delete-orphan')

    def to_dict(self, include_children: bool = False):
        plates_allocated = sum((prep.plate_count or 0) for prep in self.preps)
        completed_preps = sum(1 for prep in self.preps if prep.transfection is not None)
        data = {
            'id': self.id,
            'name': self.name,
            'status': self.status,
            'finished_at': self.finished_at.isoformat() if self.finished_at else None,
            'cell_line': self.cell_line,
            'passage_number': self.passage_number,
            'cell_concentration': self.cell_concentration,
            'cells_to_seed': self.cells_to_seed,
            'vessel_type': self.vessel_type,
            'seeding_volume_ml': self.seeding_volume_ml,
            'media_type': self.media_type,
            'vessels_seeded': self.vessels_seeded,
            'seeding_date': self.seeding_date.isoformat() if self.seeding_date else None,
            'prep_count': len(self.preps),
            'completed_preps': completed_preps,
            'plates_allocated': plates_allocated,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }
        if include_children:
            data['preps'] = [prep.to_dict(include_children=True) for prep in self.preps]
        return data


class LentivirusPrep(db.Model, TimestampMixin):
    __tablename__ = 'lentivirus_preps'

    id = db.Column(db.Integer, primary_key=True)
    experiment_id = db.Column(db.Integer, db.ForeignKey('experiments.id'), nullable=False)
    transfer_name = db.Column(db.String(128), nullable=False)
    transfer_concentration = db.Column(db.Float)
    plasmid_size_bp = db.Column(db.Integer)
    cell_line_used = db.Column(db.String(128))
    plate_count = db.Column(db.Integer, nullable=False, default=1)

    transfection = db.relationship('Transfection', uselist=False, backref='prep', cascade='all, delete-orphan')
    media_change = db.relationship('MediaChange', uselist=False, backref='prep', cascade='all, delete-orphan')
    harvest = db.relationship('Harvest', uselist=False, backref='prep', cascade='all, delete-orphan')
    titer_runs = db.relationship('TiterRun', backref='prep', cascade='all, delete-orphan')

    def to_dict(self, include_children: bool = False):
        status = {
            'logged': True,
            'transfected': self.transfection is not None,
            'media_changed': self.media_change is not None,
            'harvested': self.harvest is not None,
            'titered': bool(self.titer_runs),
        }
        data = {
            'id': self.id,
            'experiment_id': self.experiment_id,
            'transfer_name': self.transfer_name,
            'transfer_concentration': self.transfer_concentration,
            'plasmid_size_bp': self.plasmid_size_bp,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'vessel_type': self.experiment.vessel_type if self.experiment else None,
            'plate_count': self.plate_count,
            'status': status,
        }
        if include_children:
            data['transfection'] = self.transfection.to_dict() if self.transfection else None
            data['media_change'] = self.media_change.to_dict() if self.media_change else None
            data['harvest'] = self.harvest.to_dict() if self.harvest else None
            data['titer_runs'] = [run.to_dict(include_samples=True) for run in self.titer_runs]
        return data


class Transfection(db.Model, TimestampMixin):
    __tablename__ = 'transfections'

    id = db.Column(db.Integer, primary_key=True)
    prep_id = db.Column(db.Integer, db.ForeignKey('lentivirus_preps.id'), nullable=False)
    vessel_type = db.Column(db.String(64), nullable=False)
    surface_area = db.Column(db.Float)
    opti_mem_ml = db.Column(db.Float)
    xtremegene_ul = db.Column(db.Float)
    total_plasmid_ug = db.Column(db.Float)
    transfer_ratio = db.Column(db.Float)
    packaging_ratio = db.Column(db.Float)
    envelope_ratio = db.Column(db.Float)
    transfer_mass_ug = db.Column(db.Float)
    packaging_mass_ug = db.Column(db.Float)
    envelope_mass_ug = db.Column(db.Float)
    ratio_mode = db.Column(db.String(32), default='optimal')
    transfer_volume_ul = db.Column(db.Float)
    packaging_volume_ul = db.Column(db.Float)
    envelope_volume_ul = db.Column(db.Float)
    transfer_concentration_ng_ul = db.Column(db.Float)
    packaging_concentration_ng_ul = db.Column(db.Float)
    envelope_concentration_ng_ul = db.Column(db.Float)
    ratio_display = db.Column(db.String(64))

    def to_dict(self):
        return {
            'id': self.id,
            'prep_id': self.prep_id,
            'vessel_type': self.vessel_type,
            'surface_area': self.surface_area,
            'opti_mem_ml': self.opti_mem_ml,
            'xtremegene_ul': self.xtremegene_ul,
            'total_plasmid_ug': self.total_plasmid_ug,
            'transfer_ratio': self.transfer_ratio,
            'packaging_ratio': self.packaging_ratio,
            'envelope_ratio': self.envelope_ratio,
            'transfer_mass_ug': self.transfer_mass_ug,
            'packaging_mass_ug': self.packaging_mass_ug,
            'envelope_mass_ug': self.envelope_mass_ug,
            'ratio_mode': self.ratio_mode,
            'transfer_volume_ul': self.transfer_volume_ul,
            'packaging_volume_ul': self.packaging_volume_ul,
            'envelope_volume_ul': self.envelope_volume_ul,
            'transfer_concentration_ng_ul': self.transfer_concentration_ng_ul,
            'packaging_concentration_ng_ul': self.packaging_concentration_ng_ul,
            'envelope_concentration_ng_ul': self.envelope_concentration_ng_ul,
            'ratio_display': self.ratio_display,
            'created_at': self.created_at.isoformat(),
        }


class MediaChange(db.Model, TimestampMixin):
    __tablename__ = 'media_changes'

    id = db.Column(db.Integer, primary_key=True)
    prep_id = db.Column(db.Integer, db.ForeignKey('lentivirus_preps.id'), nullable=False)
    media_type = db.Column(db.String(128), nullable=False)
    volume_ml = db.Column(db.Float, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'prep_id': self.prep_id,
            'media_type': self.media_type,
            'volume_ml': self.volume_ml,
            'created_at': self.created_at.isoformat(),
        }


class Harvest(db.Model, TimestampMixin):
    __tablename__ = 'harvests'

    id = db.Column(db.Integer, primary_key=True)
    prep_id = db.Column(db.Integer, db.ForeignKey('lentivirus_preps.id'), nullable=False)
    harvest_date = db.Column(db.Date)
    volume_ml = db.Column(db.Float)

    def to_dict(self):
        return {
            'id': self.id,
            'prep_id': self.prep_id,
            'harvest_date': self.harvest_date.isoformat() if self.harvest_date else None,
            'volume_ml': self.volume_ml,
            'created_at': self.created_at.isoformat(),
        }


class TiterRun(db.Model, TimestampMixin):
    __tablename__ = 'titer_runs'

    id = db.Column(db.Integer, primary_key=True)
    prep_id = db.Column(db.Integer, db.ForeignKey('lentivirus_preps.id'), nullable=False)
    cell_line = db.Column(db.String(128), nullable=False)
    cells_seeded = db.Column(db.Float, nullable=False)
    vessel_type = db.Column(db.String(64), nullable=False)
    selection_reagent = db.Column(db.String(128))
    selection_concentration = db.Column(db.String(64))
    tests_count = db.Column(db.Integer, default=1)
    notes = db.Column(db.Text)
    polybrene_ug_ml = db.Column(db.Float)
    measurement_media_ml = db.Column(db.Float)
    control_cell_concentration = db.Column(db.Float)

    samples = db.relationship('TiterSample', backref='titer_run', cascade='all, delete-orphan')

    def to_dict(self, include_samples=False):
        data = {
            'id': self.id,
            'prep_id': self.prep_id,
            'cell_line': self.cell_line,
            'cells_seeded': self.cells_seeded,
            'vessel_type': self.vessel_type,
            'selection_reagent': self.selection_reagent,
            'selection_concentration': self.selection_concentration,
            'tests_count': self.tests_count,
            'notes': self.notes,
            'polybrene_ug_ml': self.polybrene_ug_ml,
            'measurement_media_ml': self.measurement_media_ml,
            'control_cell_concentration': self.control_cell_concentration,
            'created_at': self.created_at.isoformat(),
        }
        if include_samples:
            data['samples'] = [sample.to_dict() for sample in self.samples]
        return data


class TiterSample(db.Model, TimestampMixin):
    __tablename__ = 'titer_samples'

    id = db.Column(db.Integer, primary_key=True)
    titer_run_id = db.Column(db.Integer, db.ForeignKey('titer_runs.id'), nullable=False)
    label = db.Column(db.String(128), nullable=False)
    virus_volume_ul = db.Column(db.Float, nullable=False)
    selection_used = db.Column(db.Boolean, default=False)
    measured_percent = db.Column(db.Float)
    moi = db.Column(db.Float)
    titer_tu_ml = db.Column(db.Float)
    cell_concentration = db.Column(db.Float)

    def to_dict(self):
        return {
            'id': self.id,
            'label': self.label,
            'virus_volume_ul': self.virus_volume_ul,
            'selection_used': self.selection_used,
            'measured_percent': self.measured_percent,
            'moi': self.moi,
            'titer_tu_ml': self.titer_tu_ml,
            'cell_concentration': self.cell_concentration,
        }


SHORTHAND_MULTIPLIERS = {
    'K': 1_000,
    'M': 1_000_000,
    'B': 1_000_000_000,
}


def parse_positive_int(value, default=None):
    if value in (None, ''):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number <= 0:
        return default
    return int(round(number))


def total_plate_count(experiment, exclude_prep_id=None):
    return sum(
        (prep.plate_count or 0)
        for prep in experiment.preps
        if exclude_prep_id is None or prep.id != exclude_prep_id
    )


def parse_optional_float(value):
    if value in (None, ''):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_shorthand_number(value):
    """Convert values like 750K or 1.5M to floats."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(',', '')
    try:
        return float(text)
    except ValueError:
        pass
    if text:
        suffix = text[-1].upper()
        if suffix in SHORTHAND_MULTIPLIERS:
            try:
                base = float(text[:-1])
                return base * SHORTHAND_MULTIPLIERS[suffix]
            except ValueError:
                return None
    return None


def calculate_surface_ratio(vessel_type: str) -> float:
    surface_area = SURFACE_AREAS.get(vessel_type)
    if not surface_area:
        raise ValueError('Unknown vessel type')
    base_area = SURFACE_AREAS[BASE_SEEDING['vessel']]
    return surface_area / base_area


def calculate_seeding_volume(vessel_type: str, target_cells: float) -> float:
    ratio = calculate_surface_ratio(vessel_type)
    base_cells = BASE_SEEDING['cells'] * ratio
    base_volume = BASE_SEEDING['volume_ml'] * ratio
    if target_cells:
        return target_cells / BASE_SEEDING['density']
    return base_volume


def calculate_transfection_scaling(vessel_type: str, ratio=None):
    surface_ratio = calculate_surface_ratio(vessel_type)
    opti_mem = BASE_TRANSFECTION['opti_mem_ml'] * surface_ratio
    xtremegene = BASE_TRANSFECTION['xtremegene_ul'] * surface_ratio
    total_plasmid = BASE_TRANSFECTION['total_plasmid_ug'] * surface_ratio

    if ratio is None:
        ratio = DEFAULT_MOLAR_RATIO

    total_ratio = sum(ratio)
    transfer_mass = total_plasmid * (ratio[0] / total_ratio)
    packaging_mass = total_plasmid * (ratio[1] / total_ratio)
    envelope_mass = total_plasmid * (ratio[2] / total_ratio)

    return {
        'surface_ratio': surface_ratio,
        'opti_mem_ml': round(opti_mem, 3),
        'xtremegene_ul': round(xtremegene, 3),
        'total_plasmid_ug': round(total_plasmid, 3),
        'transfer_mass_ug': round(transfer_mass, 3),
        'packaging_mass_ug': round(packaging_mass, 3),
        'envelope_mass_ug': round(envelope_mass, 3),
    }


def compute_moi(fraction_infected: float) -> float:
    if fraction_infected >= 1:
        return float('inf')
    if fraction_infected <= 0:
        return 0.0
    return -math.log(1 - fraction_infected)


def compute_titer(cells_at_transduction: float, moi: float, virus_volume_ul: float) -> float:
    if virus_volume_ul == 0:
        return 0.0
    volume_ml = virus_volume_ul / 1000.0
    return cells_at_transduction * (moi / volume_ml)


def round_titer_average(value: float | None):
    if value in (None, 0):
        return 0 if value == 0 else None
    magnitude = math.floor(math.log10(abs(value))) - 2
    if magnitude < 0:
        magnitude = 0
    base = 10 ** magnitude
    return int(round(value / base) * base)


def ensure_sqlite_schema():
    """Add any missing columns that newer builds require."""
    engine = db.engine
    if not engine.url.drivername.startswith('sqlite'):
        return
    inspector = inspect(engine)
    if 'experiments' not in inspector.get_table_names():
        return
    existing_columns = {column['name'] for column in inspector.get_columns('experiments')}
    required_columns = {
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
    missing = {name: ddl for name, ddl in required_columns.items() if name not in existing_columns}
    if missing:
        with engine.begin() as connection:
            for column_name, column_type in missing.items():
                connection.execute(text(f'ALTER TABLE experiments ADD COLUMN {column_name} {column_type}'))
            if 'media_type' in missing:
                connection.execute(
                    text("UPDATE experiments SET media_type = 'DMEM + 10% FBS' WHERE media_type IS NULL")
                )
            if 'name' in missing:
                connection.execute(
                    text("UPDATE experiments SET name = COALESCE(name, 'Untitled Experiment')")
                )
            if 'status' in missing:
                connection.execute(
                    text("UPDATE experiments SET status = COALESCE(status, 'active')")
                )
            if 'vessels_seeded' in missing:
                connection.execute(
                    text('UPDATE experiments SET vessels_seeded = 1 WHERE vessels_seeded IS NULL')
                )
            if 'seeding_date' in missing:
                today = datetime.utcnow().date().isoformat()
                connection.execute(
                    text('UPDATE experiments SET seeding_date = COALESCE(seeding_date, :today)'),
                    {'today': today},
                )
            if 'created_at' in missing or 'updated_at' in missing:
                now = datetime.utcnow().isoformat()
                connection.execute(
                    text(
                        "UPDATE experiments "
                        "SET created_at = COALESCE(created_at, :now), "
                        "updated_at = COALESCE(updated_at, :now)"
                    ),
                    {'now': now},
                )
    transfection_required = {
        'transfer_volume_ul': 'FLOAT',
        'packaging_volume_ul': 'FLOAT',
        'envelope_volume_ul': 'FLOAT',
        'transfer_concentration_ng_ul': 'FLOAT',
        'packaging_concentration_ng_ul': 'FLOAT',
        'envelope_concentration_ng_ul': 'FLOAT',
        'ratio_display': 'VARCHAR(64)',
    }
    if 'transfections' in inspector.get_table_names():
        existing = {column['name'] for column in inspector.get_columns('transfections')}
        missing = {name: ddl for name, ddl in transfection_required.items() if name not in existing}
        if missing:
            with engine.begin() as connection:
                for column_name, column_type in missing.items():
                    connection.execute(
                        text(f'ALTER TABLE transfections ADD COLUMN {column_name} {column_type}')
                    )
    titer_run_required = {
        'polybrene_ug_ml': 'FLOAT',
        'measurement_media_ml': 'FLOAT',
        'control_cell_concentration': 'FLOAT',
    }
    prep_required = {
        'plate_count': 'INTEGER'
    }
    if 'lentivirus_preps' in inspector.get_table_names():
        existing = {column['name'] for column in inspector.get_columns('lentivirus_preps')}
        missing = {name: ddl for name, ddl in prep_required.items() if name not in existing}
        if missing:
            with engine.begin() as connection:
                for column_name, column_type in missing.items():
                    connection.execute(
                        text(f'ALTER TABLE lentivirus_preps ADD COLUMN {column_name} {column_type} DEFAULT 1')
                    )
                connection.execute(
                    text('UPDATE lentivirus_preps SET plate_count = 1 WHERE plate_count IS NULL')
                )
    if 'titer_runs' in inspector.get_table_names():
        existing = {column['name'] for column in inspector.get_columns('titer_runs')}
        missing = {name: ddl for name, ddl in titer_run_required.items() if name not in existing}
        if missing:
            with engine.begin() as connection:
                for column_name, column_type in missing.items():
                    connection.execute(
                        text(f'ALTER TABLE titer_runs ADD COLUMN {column_name} {column_type}')
                    )
    titer_sample_required = {
        'cell_concentration': 'FLOAT',
    }
    if 'titer_samples' in inspector.get_table_names():
        existing = {column['name'] for column in inspector.get_columns('titer_samples')}
        missing = {name: ddl for name, ddl in titer_sample_required.items() if name not in existing}
        if missing:
            with engine.begin() as connection:
                for column_name, column_type in missing.items():
                    connection.execute(
                        text(f'ALTER TABLE titer_samples ADD COLUMN {column_name} {column_type}')
                    )


@app.route('/')
def index():
    today = datetime.utcnow().date().isoformat()
    return render_template(
        'index.html',
        surface_areas=SURFACE_AREAS,
        today=today,
        default_media='DMEM + 10% FBS',
    )


@app.route('/api/experiments', methods=['GET', 'POST'])
def experiments_endpoint():
    if request.method == 'POST':
        data = request.json
        seeding_date = datetime.strptime(data.get('seeding_date'), '%Y-%m-%d').date() if data.get('seeding_date') else None
        vessels_seeded = parse_positive_int(data.get('vessels_seeded'), default=1)
        cells_to_seed = parse_shorthand_number(data.get('cells_to_seed'))
        if cells_to_seed is None:
            return jsonify({'error': 'cells_to_seed is required'}), 400
        if seeding_date is None:
            seeding_date = datetime.utcnow().date()
        name_value = (data.get('name') or '').strip()
        if not name_value:
            base_date = seeding_date.isoformat() if seeding_date else datetime.utcnow().date().isoformat()
            name_value = f"{data['cell_line']} · {base_date}"
        status = (data.get('status') or 'active').lower()
        if status not in {'active', 'finished'}:
            status = 'active'
        finished_at = datetime.utcnow() if status == 'finished' else None
        experiment = Experiment(
            name=name_value,
            status=status,
            finished_at=finished_at,
            cell_line=data['cell_line'],
            passage_number=data.get('passage_number'),
            cell_concentration=parse_shorthand_number(data.get('cell_concentration')),
            cells_to_seed=cells_to_seed,
            vessel_type=data['vessel_type'],
            seeding_volume_ml=parse_shorthand_number(data.get('seeding_volume_ml')),
            media_type=data.get('media_type') or 'DMEM + 10% FBS',
            vessels_seeded=vessels_seeded,
            seeding_date=seeding_date,
        )
        try:
            db.session.add(experiment)
            db.session.commit()
        except Exception as exc:  # pragma: no cover - defensive handling
            db.session.rollback()
            app.logger.exception('Failed to persist experiment')
            return jsonify({'error': 'Unable to save experiment', 'details': str(exc)}), 500
        return jsonify({'experiment': experiment.to_dict()})

    experiments = Experiment.query.order_by(Experiment.created_at.desc()).all()
    return jsonify({'experiments': [exp.to_dict() for exp in experiments]})


@app.route('/api/experiments/<int:experiment_id>', methods=['GET', 'PUT', 'DELETE'])
def experiment_detail(experiment_id):
    experiment = Experiment.query.get_or_404(experiment_id)
    if request.method == 'GET':
        return jsonify({'experiment': experiment.to_dict(include_children=True)})
    if request.method == 'DELETE':
        db.session.delete(experiment)
        db.session.commit()
        return jsonify({'deleted': True})
    data = request.json
    updates = {
        'cell_line': data.get('cell_line'),
        'passage_number': data.get('passage_number'),
        'cell_concentration': parse_shorthand_number(data.get('cell_concentration')),
        'cells_to_seed': None,
        'vessel_type': data.get('vessel_type'),
        'seeding_volume_ml': parse_shorthand_number(data.get('seeding_volume_ml')),
        'media_type': data.get('media_type'),
        'vessels_seeded': None,
    }
    if 'vessels_seeded' in data:
        vessels_seeded = parse_positive_int(data.get('vessels_seeded'))
        updates['vessels_seeded'] = vessels_seeded
    if 'cells_to_seed' in data:
        cells_to_seed = parse_shorthand_number(data.get('cells_to_seed'))
        if cells_to_seed is None:
            return jsonify({'error': 'cells_to_seed is required'}), 400
        updates['cells_to_seed'] = cells_to_seed
    if 'name' in data:
        name_value = (data.get('name') or '').strip()
        if name_value:
            updates['name'] = name_value
    if 'status' in data:
        status = (data.get('status') or '').lower()
        if status in {'active', 'finished'}:
            updates['status'] = status
            if status == 'finished':
                experiment.finished_at = experiment.finished_at or datetime.utcnow()
            elif status == 'active':
                experiment.finished_at = None
    for field, value in updates.items():
        if value is not None or field in data:
            setattr(experiment, field, value)
    if 'seeding_date' in data:
        experiment.seeding_date = datetime.strptime(data['seeding_date'], '%Y-%m-%d').date() if data['seeding_date'] else None
    db.session.commit()
    return jsonify({'experiment': experiment.to_dict()})


@app.route('/api/experiments/<int:experiment_id>/preps', methods=['POST', 'GET'])
def prep_endpoint(experiment_id):
    experiment = Experiment.query.get_or_404(experiment_id)
    if request.method == 'POST':
        data = request.json
        plate_count = parse_positive_int(data.get('plate_count'), default=1)
        if plate_count is None:
            return jsonify({'error': 'plate_count must be a positive integer'}), 400
        capacity = experiment.vessels_seeded
        if capacity:
            used = total_plate_count(experiment)
            remaining = capacity - used
            if plate_count > remaining:
                if remaining <= 0:
                    message = 'All seeded plates are already allocated to preparations'
                else:
                    message = f'Only {remaining} plate(s) remain available for this experiment'
                return jsonify({'error': message}), 400
        prep = LentivirusPrep(
            experiment_id=experiment_id,
            transfer_name=data['transfer_name'],
            transfer_concentration=parse_optional_float(data.get('transfer_concentration')),
            plasmid_size_bp=parse_positive_int(data.get('plasmid_size_bp')),
            plate_count=plate_count,
        )
        db.session.add(prep)
        db.session.commit()
        db.session.refresh(experiment)
        return jsonify({'prep': prep.to_dict(include_children=True)})
    preps = LentivirusPrep.query.filter_by(experiment_id=experiment_id).all()
    return jsonify({'preps': [prep.to_dict(include_children=True) for prep in preps]})


@app.route('/api/preps/<int:prep_id>', methods=['PUT', 'DELETE'])
def update_prep(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    if request.method == 'DELETE':
        db.session.delete(prep)
        db.session.commit()
        return jsonify({'deleted': True})
    data = request.json
    if 'transfer_name' in data:
        prep.transfer_name = data.get('transfer_name')
    if 'transfer_concentration' in data:
        prep.transfer_concentration = parse_optional_float(data.get('transfer_concentration'))
    if 'plasmid_size_bp' in data:
        prep.plasmid_size_bp = parse_positive_int(data.get('plasmid_size_bp'))
    if 'plate_count' in data:
        new_count = parse_positive_int(data.get('plate_count'))
        if new_count is None:
            return jsonify({'error': 'plate_count must be a positive integer'}), 400
        experiment = prep.experiment
        capacity = experiment.vessels_seeded if experiment else None
        if capacity:
            used = total_plate_count(experiment, exclude_prep_id=prep.id)
            remaining = capacity - used
            if new_count > remaining:
                if remaining <= 0:
                    message = 'All seeded plates are already allocated to other preparations'
                else:
                    message = f'Only {remaining} plate(s) remain available for this experiment'
                return jsonify({'error': message}), 400
        prep.plate_count = new_count
    db.session.commit()
    return jsonify({'prep': prep.to_dict(include_children=True)})


@app.route('/api/preps/<int:prep_id>/transfection', methods=['POST'])
def transfection_endpoint(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    experiment = prep.experiment
    vessel_type = experiment.vessel_type if experiment else BASE_TRANSFECTION['vessel']
    data = request.json
    ratio_mode = data.get('ratio_mode', 'optimal')
    ratio = data.get('ratio')
    if ratio_mode == 'optimal' or not ratio:
        ratio = DEFAULT_MOLAR_RATIO
    else:
        ratio = tuple(float(x) for x in ratio)

    scaling = calculate_transfection_scaling(vessel_type, ratio)

    def compute_volume(mass_ug, concentration_ng_ul):
        if concentration_ng_ul in (None, 0):
            return None
        try:
            concentration_value = float(concentration_ng_ul)
        except (TypeError, ValueError):
            return None
        if concentration_value == 0:
            return None
        return round((mass_ug * 1000.0) / concentration_value, 3)

    transfer_conc = data.get('transfer_concentration_ng_ul') or prep.transfer_concentration
    packaging_conc = data.get('packaging_concentration_ng_ul')
    envelope_conc = data.get('envelope_concentration_ng_ul')

    transfer_volume = compute_volume(scaling['transfer_mass_ug'], transfer_conc)
    packaging_volume = compute_volume(scaling['packaging_mass_ug'], packaging_conc)
    envelope_volume = compute_volume(scaling['envelope_mass_ug'], envelope_conc)

    ratio_display = f"{ratio[0]}:{ratio[1]}:{ratio[2]}"

    transfection = prep.transfection or Transfection(prep=prep)
    transfection.vessel_type = vessel_type
    transfection.surface_area = SURFACE_AREAS.get(vessel_type, scaling['surface_ratio'] * SURFACE_AREAS[BASE_TRANSFECTION['vessel']])
    transfection.opti_mem_ml = scaling['opti_mem_ml']
    transfection.xtremegene_ul = scaling['xtremegene_ul']
    transfection.total_plasmid_ug = scaling['total_plasmid_ug']
    transfection.transfer_ratio = ratio[0]
    transfection.packaging_ratio = ratio[1]
    transfection.envelope_ratio = ratio[2]
    transfection.transfer_mass_ug = scaling['transfer_mass_ug']
    transfection.packaging_mass_ug = scaling['packaging_mass_ug']
    transfection.envelope_mass_ug = scaling['envelope_mass_ug']
    transfection.ratio_mode = ratio_mode
    transfection.transfer_concentration_ng_ul = transfer_conc
    transfection.packaging_concentration_ng_ul = packaging_conc
    transfection.envelope_concentration_ng_ul = envelope_conc
    transfection.transfer_volume_ul = transfer_volume
    transfection.packaging_volume_ul = packaging_volume
    transfection.envelope_volume_ul = envelope_volume
    transfection.ratio_display = ratio_display

    db.session.add(transfection)
    db.session.commit()
    return jsonify({'transfection': transfection.to_dict()})


@app.route('/api/preps/<int:prep_id>/media-change', methods=['POST'])
def media_change_endpoint(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    data = request.json
    volume = parse_optional_float(data.get('volume_ml'))
    if volume is None:
        return jsonify({'error': 'volume_ml is required'}), 400
    media_type = data.get('media_type') or (prep.experiment.media_type if prep.experiment else None)
    if not media_type:
        return jsonify({'error': 'media_type is required'}), 400
    media_change = prep.media_change or MediaChange(prep=prep)
    media_change.media_type = media_type
    media_change.volume_ml = volume
    db.session.add(media_change)
    db.session.commit()
    return jsonify({'media_change': media_change.to_dict()})


@app.route('/api/preps/<int:prep_id>/harvest', methods=['POST'])
def harvest_endpoint(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    data = request.json
    harvest_date = datetime.strptime(data.get('harvest_date'), '%Y-%m-%d').date() if data.get('harvest_date') else None
    volume = data.get('volume_ml')
    if volume in (None, '') and prep.media_change:
        volume = prep.media_change.volume_ml
    volume_value = parse_optional_float(volume)
    if volume_value is None:
        return jsonify({'error': 'volume_ml is required'}), 400
    harvest = prep.harvest or Harvest(prep=prep)
    harvest.harvest_date = harvest_date
    harvest.volume_ml = volume_value
    db.session.add(harvest)
    db.session.commit()
    return jsonify({'harvest': harvest.to_dict()})


@app.route('/api/preps/<int:prep_id>/titer-runs', methods=['POST', 'GET'])
def titer_runs_endpoint(prep_id):
    LentivirusPrep.query.get_or_404(prep_id)
    if request.method == 'POST':
        data = request.json
        cells_seeded = parse_shorthand_number(data.get('cells_seeded'))
        if cells_seeded is None:
            return jsonify({'error': 'cells_seeded is required'}), 400
        titer_run = TiterRun(
            prep_id=prep_id,
            cell_line=data['cell_line'],
            cells_seeded=cells_seeded,
            vessel_type=data['vessel_type'],
            selection_reagent=data.get('selection_reagent'),
            selection_concentration=data.get('selection_concentration'),
            tests_count=data.get('tests_count', 1),
            notes=data.get('notes'),
            polybrene_ug_ml=parse_shorthand_number(data.get('polybrene_ug_ml')),
            measurement_media_ml=parse_shorthand_number(data.get('measurement_media_ml')),
            control_cell_concentration=parse_shorthand_number(data.get('control_cell_concentration')),
        )
        db.session.add(titer_run)
        db.session.flush()
        samples_payload = data.get('samples', [])
        for sample in samples_payload:
            sample_entry = TiterSample(
                titer_run_id=titer_run.id,
                label=sample['label'],
                virus_volume_ul=sample['virus_volume_ul'],
                selection_used=sample.get('selection_used', True),
            )
            db.session.add(sample_entry)
        db.session.commit()
        return jsonify({'titer_run': titer_run.to_dict(include_samples=True)})
    runs = TiterRun.query.filter_by(prep_id=prep_id).order_by(TiterRun.created_at.desc()).all()
    return jsonify({'titer_runs': [run.to_dict(include_samples=True) for run in runs]})


@app.route('/api/titer-runs/<int:run_id>/results', methods=['POST'])
def titer_results_endpoint(run_id):
    run = TiterRun.query.get_or_404(run_id)
    data = request.json
    measurement_media_ml = parse_shorthand_number(data.get('measurement_media_ml'))
    control_concentration = parse_shorthand_number(data.get('control_cell_concentration'))
    if measurement_media_ml is not None:
        run.measurement_media_ml = measurement_media_ml
    if control_concentration is not None:
        run.control_cell_concentration = control_concentration
    measurement_media = run.measurement_media_ml or 1.0
    cells_at_transduction = run.cells_seeded

    pending_updates = []
    control_candidate = None
    for sample_payload in data.get('samples', []):
        sample = TiterSample.query.filter_by(id=sample_payload['id'], titer_run_id=run.id).first_or_404()
        if 'selection_used' in sample_payload:
            sample.selection_used = bool(sample_payload['selection_used'])
        cell_concentration = parse_shorthand_number(sample_payload.get('cell_concentration'))
        if cell_concentration is not None:
            sample.cell_concentration = cell_concentration
            if not sample.selection_used:
                control_candidate = cell_concentration
        pending_updates.append(
            {
                'sample': sample,
                'cell_concentration': cell_concentration,
                'measured_percent': sample_payload.get('measured_percent'),
            }
        )

    if run.control_cell_concentration is None and control_candidate is not None:
        run.control_cell_concentration = control_candidate

    control_cells = None
    if run.control_cell_concentration is not None:
        control_cells = run.control_cell_concentration * measurement_media

    updated_samples = []
    for entry in pending_updates:
        sample = entry['sample']
        measured_percent = None
        survival_fraction = None
        if entry['cell_concentration'] is not None and control_cells not in (None, 0):
            sample_cells = entry['cell_concentration'] * measurement_media
            survival_fraction = sample_cells / control_cells if control_cells else 0
            measured_percent = max(0.0, survival_fraction * 100)
        elif entry['measured_percent'] is not None:
            try:
                measured_percent = float(entry['measured_percent'])
            except (TypeError, ValueError):
                measured_percent = None
            survival_fraction = measured_percent / 100 if measured_percent is not None else None
        if measured_percent is None or survival_fraction is None:
            sample.measured_percent = None
            sample.moi = None
            sample.titer_tu_ml = None
            updated_samples.append(sample.to_dict())
            continue
        fraction_infected = max(0.0, min(1.0, 1 - survival_fraction))
        moi = compute_moi(fraction_infected)
        titer = compute_titer(cells_at_transduction, moi, sample.virus_volume_ul)
        sample.measured_percent = round(measured_percent, 2)
        sample.moi = round(moi, 4) if math.isfinite(moi) else None
        sample.titer_tu_ml = round(titer, 2) if math.isfinite(titer) else None
        updated_samples.append(sample.to_dict())
    db.session.commit()

    average_titer = None
    titers = [s['titer_tu_ml'] for s in updated_samples if s['titer_tu_ml'] is not None]
    if titers:
        average_titer = round_titer_average(sum(titers) / len(titers))

    return jsonify({
        'samples': updated_samples,
        'average_titer': average_titer,
        'control_cell_concentration': run.control_cell_concentration,
        'measurement_media_ml': run.measurement_media_ml,
    })


@app.route('/api/metrics/transfection', methods=['POST'])
def metrics_transfection():
    data = request.json
    vessel_type = data['vessel_type']
    ratio_mode = data.get('ratio_mode', 'optimal')
    ratio = data.get('ratio')
    if ratio_mode == 'optimal' or not ratio:
        ratio_values = DEFAULT_MOLAR_RATIO
    else:
        ratio_values = tuple(float(x) for x in ratio)
    scaling = calculate_transfection_scaling(vessel_type, ratio_values)
    scaling['surface_area'] = SURFACE_AREAS[vessel_type]
    scaling['ratio'] = ratio_values
    def compute_volume(mass_ug, concentration_ng_ul):
        if concentration_ng_ul in (None, 0):
            return None
        try:
            concentration_value = float(concentration_ng_ul)
        except (TypeError, ValueError):
            return None
        if concentration_value == 0:
            return None
        return round((mass_ug * 1000.0) / concentration_value, 3)

    scaling['transfer_volume_ul'] = compute_volume(
        scaling['transfer_mass_ug'], data.get('transfer_concentration_ng_ul')
    )
    scaling['packaging_volume_ul'] = compute_volume(
        scaling['packaging_mass_ug'], data.get('packaging_concentration_ng_ul')
    )
    scaling['envelope_volume_ul'] = compute_volume(
        scaling['envelope_mass_ug'], data.get('envelope_concentration_ng_ul')
    )
    scaling['ratio_display'] = f"{ratio_values[0]}:{ratio_values[1]}:{ratio_values[2]}"
    return jsonify(scaling)


@app.route('/api/metrics/seeding', methods=['POST'])
def metrics_seeding():
    data = request.json
    vessel_type = data['vessel_type']
    target_cells = data.get('target_cells')
    volume = calculate_seeding_volume(vessel_type, target_cells)
    return jsonify({'seeding_volume_ml': round(volume, 3)})


@app.route('/api/metrics/moi', methods=['POST'])
def metrics_moi():
    data = request.json
    fraction_infected = data['fraction_infected']
    moi = compute_moi(fraction_infected)
    return jsonify({'moi': moi})


@app.route('/api/metrics/titer', methods=['POST'])
def metrics_titer():
    data = request.json
    cells = data['cells']
    moi = data['moi']
    virus_volume_ul = data['virus_volume_ul']
    titer = compute_titer(cells, moi, virus_volume_ul)
    return jsonify({'titer': titer})


with app.app_context():
    db.create_all()
    ensure_sqlite_schema()


if __name__ == '__main__':
    app.run(debug=True)
