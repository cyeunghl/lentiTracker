import math
from datetime import datetime
from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///lenti_tracker.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
migrate = Migrate(app, db)


SURFACE_AREAS = {
    'T175': 175.0,
    'T150': 150.0,
    'T75': 75.0,
    'T25': 25.0,
    'T12.5': 12.5,
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

    def to_dict(self):
        return {
            'id': self.id,
            'cell_line': self.cell_line,
            'passage_number': self.passage_number,
            'cell_concentration': self.cell_concentration,
            'cells_to_seed': self.cells_to_seed,
            'vessel_type': self.vessel_type,
            'seeding_volume_ml': self.seeding_volume_ml,
            'media_type': self.media_type,
            'vessels_seeded': self.vessels_seeded,
            'seeding_date': self.seeding_date.isoformat() if self.seeding_date else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


class LentivirusPrep(db.Model, TimestampMixin):
    __tablename__ = 'lentivirus_preps'

    id = db.Column(db.Integer, primary_key=True)
    experiment_id = db.Column(db.Integer, db.ForeignKey('experiments.id'), nullable=False)
    transfer_name = db.Column(db.String(128), nullable=False)
    transfer_concentration = db.Column(db.Float)
    plasmid_size_bp = db.Column(db.Integer)
    cell_line_used = db.Column(db.String(128))
    plate_count = db.Column(db.Integer, default=1)

    transfection = db.relationship('Transfection', uselist=False, backref='prep', cascade='all, delete-orphan')
    media_change = db.relationship('MediaChange', uselist=False, backref='prep', cascade='all, delete-orphan')
    harvest = db.relationship('Harvest', uselist=False, backref='prep', cascade='all, delete-orphan')
    titer_runs = db.relationship('TiterRun', backref='prep', cascade='all, delete-orphan')

    def to_dict(self):
        status = {
            'logged': True,
            'transfected': self.transfection is not None,
            'media_changed': self.media_change is not None,
            'harvested': self.harvest is not None,
            'titered': bool(self.titer_runs)
        }
        return {
            'id': self.id,
            'experiment_id': self.experiment_id,
            'transfer_name': self.transfer_name,
            'transfer_concentration': self.transfer_concentration,
            'plasmid_size_bp': self.plasmid_size_bp,
            'cell_line_used': self.cell_line_used,
            'plate_count': self.plate_count,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'transfection': self.transfection.to_dict() if self.transfection else None,
            'media_change': self.media_change.to_dict() if self.media_change else None,
            'harvest': self.harvest.to_dict() if self.harvest else None,
            'status': status,
        }


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
    transfer_concentration = db.Column(db.Float)
    packaging_concentration = db.Column(db.Float)
    envelope_concentration = db.Column(db.Float)

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
            'transfer_concentration': self.transfer_concentration,
            'packaging_concentration': self.packaging_concentration,
            'envelope_concentration': self.envelope_concentration,
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

    def to_dict(self):
        return {
            'id': self.id,
            'label': self.label,
            'virus_volume_ul': self.virus_volume_ul,
            'selection_used': self.selection_used,
            'measured_percent': self.measured_percent,
            'moi': self.moi,
            'titer_tu_ml': self.titer_tu_ml,
        }


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


def round_significant(value: float, digits: int = 3) -> float:
    if value is None or value == 0:
        return 0.0
    magnitude = int(math.floor(math.log10(abs(value))))
    factor = 10 ** (digits - 1 - magnitude)
    return round(value * factor) / factor


@app.route('/')
def index():
    return render_template('index.html', surface_areas=SURFACE_AREAS)


@app.route('/api/experiments', methods=['GET', 'POST'])
def experiments_endpoint():
    if request.method == 'POST':
        data = request.json
        seeding_date = datetime.strptime(data.get('seeding_date'), '%Y-%m-%d').date() if data.get('seeding_date') else None
        experiment = Experiment(
            cell_line=data['cell_line'],
            passage_number=data.get('passage_number'),
            cell_concentration=data.get('cell_concentration'),
            cells_to_seed=data.get('cells_to_seed'),
            vessel_type=data['vessel_type'],
            seeding_volume_ml=data.get('seeding_volume_ml'),
            media_type=data.get('media_type'),
            vessels_seeded=data.get('vessels_seeded'),
            seeding_date=seeding_date,
        )
        db.session.add(experiment)
        db.session.commit()
        return jsonify({'experiment': experiment.to_dict()})

    experiments = Experiment.query.order_by(Experiment.created_at.desc()).all()
    return jsonify({'experiments': [exp.to_dict() for exp in experiments]})


@app.route('/api/experiments/<int:experiment_id>', methods=['PUT'])
def update_experiment(experiment_id):
    experiment = Experiment.query.get_or_404(experiment_id)
    data = request.json
    for field in ['cell_line', 'passage_number', 'cell_concentration', 'cells_to_seed',
                  'vessel_type', 'seeding_volume_ml', 'media_type', 'vessels_seeded']:
        if field in data:
            setattr(experiment, field, data[field])
    if 'seeding_date' in data:
        experiment.seeding_date = datetime.strptime(data['seeding_date'], '%Y-%m-%d').date() if data['seeding_date'] else None
    db.session.commit()
    return jsonify({'experiment': experiment.to_dict()})


def _validate_plate_capacity(experiment, requested_plate_count, exclude_prep_id=None):
    if requested_plate_count is None:
        return
    if requested_plate_count < 1:
        raise ValueError('Plate count must be at least 1.')
    if experiment.vessels_seeded is None:
        return
    query = LentivirusPrep.query.filter_by(experiment_id=experiment.id)
    if exclude_prep_id is not None:
        query = query.filter(LentivirusPrep.id != exclude_prep_id)
    total_existing = sum(prep.plate_count or 0 for prep in query)
    if total_existing + requested_plate_count > experiment.vessels_seeded:
        raise ValueError('Requested plates exceed the number seeded for this experiment.')


@app.route('/api/experiments/<int:experiment_id>/preps', methods=['POST', 'GET'])
def prep_endpoint(experiment_id):
    experiment = Experiment.query.get_or_404(experiment_id)
    if request.method == 'POST':
        data = request.json
        plate_count = data.get('plate_count') or 1
        try:
            plate_count = int(plate_count)
        except (TypeError, ValueError):
            return jsonify({'error': 'Plate count must be an integer.'}), 400
        try:
            _validate_plate_capacity(experiment, plate_count)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        transfer_conc = data.get('transfer_concentration')
        if transfer_conc in (None, ''):
            transfer_conc_value = None
        else:
            try:
                transfer_conc_value = float(transfer_conc)
            except (TypeError, ValueError):
                return jsonify({'error': 'Transfer concentration must be numeric.'}), 400
        plasmid_size = data.get('plasmid_size_bp')
        if plasmid_size in (None, ''):
            plasmid_size_value = None
        else:
            try:
                plasmid_size_value = int(plasmid_size)
            except (TypeError, ValueError):
                return jsonify({'error': 'Plasmid size must be an integer.'}), 400
        prep = LentivirusPrep(
            experiment_id=experiment_id,
            transfer_name=data['transfer_name'],
            transfer_concentration=transfer_conc_value,
            plasmid_size_bp=plasmid_size_value,
            cell_line_used=data.get('cell_line_used'),
            plate_count=plate_count,
        )
        db.session.add(prep)
        db.session.commit()
        return jsonify({'prep': prep.to_dict()})
    preps = LentivirusPrep.query.filter_by(experiment_id=experiment_id).all()
    return jsonify({'preps': [prep.to_dict() for prep in preps]})


@app.route('/api/preps/<int:prep_id>', methods=['PUT', 'DELETE'])
def update_prep(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    if request.method == 'DELETE':
        db.session.delete(prep)
        db.session.commit()
        return jsonify({'status': 'deleted'})

    data = request.json or {}
    if 'transfer_name' in data:
        prep.transfer_name = data['transfer_name']
    if 'transfer_concentration' in data:
        transfer_conc = data['transfer_concentration']
        if transfer_conc in (None, ''):
            prep.transfer_concentration = None
        else:
            try:
                prep.transfer_concentration = float(transfer_conc)
            except (TypeError, ValueError):
                return jsonify({'error': 'Transfer concentration must be numeric.'}), 400
    if 'plasmid_size_bp' in data:
        plasmid_size = data['plasmid_size_bp']
        if plasmid_size in (None, ''):
            prep.plasmid_size_bp = None
        else:
            try:
                prep.plasmid_size_bp = int(plasmid_size)
            except (TypeError, ValueError):
                return jsonify({'error': 'Plasmid size must be an integer.'}), 400
    if 'cell_line_used' in data:
        prep.cell_line_used = data['cell_line_used'] or None
    if 'plate_count' in data:
        try:
            plate_count = int(data['plate_count'])
        except (TypeError, ValueError):
            return jsonify({'error': 'Plate count must be an integer.'}), 400
        try:
            _validate_plate_capacity(prep.experiment, plate_count, exclude_prep_id=prep.id)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        prep.plate_count = plate_count
    db.session.commit()
    return jsonify({'prep': prep.to_dict()})


@app.route('/api/preps/<int:prep_id>/transfection', methods=['POST'])
def transfection_endpoint(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    data = request.json
    ratio_mode = data.get('ratio_mode', 'optimal')
    ratio = data.get('ratio')
    if ratio_mode == 'optimal' or not ratio:
        ratio = DEFAULT_MOLAR_RATIO
    else:
        if isinstance(ratio, str):
            ratio = [segment.strip() for segment in ratio.split(',') if segment.strip()]
        ratio = tuple(float(x) for x in ratio)
        if len(ratio) != 3:
            return jsonify({'error': 'Custom ratios must include three values.'}), 400
    vessel_type = data['vessel_type']
    if vessel_type not in SURFACE_AREAS:
        return jsonify({'error': 'Unknown vessel type.'}), 400
    scaling = calculate_transfection_scaling(vessel_type, ratio)
    transfer_conc = data.get('transfer_concentration')
    packaging_conc = data.get('packaging_concentration')
    envelope_conc = data.get('envelope_concentration')
    try:
        transfer_conc_value = float(transfer_conc) if transfer_conc not in (None, '') else prep.transfer_concentration
    except (TypeError, ValueError):
        return jsonify({'error': 'Transfer concentration must be numeric.'}), 400
    try:
        packaging_conc_value = float(packaging_conc) if packaging_conc not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'error': 'Packaging concentration must be numeric.'}), 400
    try:
        envelope_conc_value = float(envelope_conc) if envelope_conc not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'error': 'Envelope concentration must be numeric.'}), 400
    transfection = prep.transfection or Transfection(prep=prep)
    transfection.vessel_type = vessel_type
    transfection.surface_area = SURFACE_AREAS[vessel_type]
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
    transfection.transfer_concentration = transfer_conc_value
    transfection.packaging_concentration = packaging_conc_value
    transfection.envelope_concentration = envelope_conc_value
    db.session.add(transfection)
    db.session.commit()
    return jsonify({'transfection': transfection.to_dict()})


@app.route('/api/preps/<int:prep_id>/media-change', methods=['POST'])
def media_change_endpoint(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    data = request.json
    media_change = prep.media_change or MediaChange(prep=prep)
    media_change.media_type = data['media_type']
    volume_value = data.get('volume_ml')
    if volume_value in (None, ''):
        return jsonify({'error': 'Media volume is required.'}), 400
    try:
        media_change.volume_ml = float(volume_value)
    except (TypeError, ValueError):
        return jsonify({'error': 'Media volume must be numeric.'}), 400
    db.session.add(media_change)
    db.session.commit()
    return jsonify({'media_change': media_change.to_dict()})


@app.route('/api/preps/<int:prep_id>/harvest', methods=['POST'])
def harvest_endpoint(prep_id):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    data = request.json
    harvest_date = datetime.strptime(data.get('harvest_date'), '%Y-%m-%d').date() if data.get('harvest_date') else None
    harvest = prep.harvest or Harvest(prep=prep)
    harvest.harvest_date = harvest_date
    volume = data.get('volume_ml')
    if volume in (None, ''):
        harvest.volume_ml = None
    else:
        try:
            harvest.volume_ml = float(volume)
        except (TypeError, ValueError):
            return jsonify({'error': 'Harvest volume must be numeric.'}), 400
    db.session.add(harvest)
    db.session.commit()
    return jsonify({'harvest': harvest.to_dict()})


@app.route('/api/preps/<int:prep_id>/titer-runs', methods=['POST', 'GET'])
def titer_runs_endpoint(prep_id):
    LentivirusPrep.query.get_or_404(prep_id)
    if request.method == 'POST':
        data = request.json
        try:
            cells_seeded = float(data['cells_seeded'])
        except (TypeError, ValueError, KeyError):
            return jsonify({'error': 'Cells seeded must be numeric.'}), 400
        tests_count = data.get('tests_count', 1)
        try:
            tests_count_value = int(tests_count)
        except (TypeError, ValueError):
            return jsonify({'error': 'Tests count must be an integer.'}), 400
        titer_run = TiterRun(
            prep_id=prep_id,
            cell_line=data['cell_line'],
            cells_seeded=cells_seeded,
            vessel_type=data['vessel_type'],
            selection_reagent=data.get('selection_reagent'),
            selection_concentration=data.get('selection_concentration'),
            tests_count=tests_count_value,
            notes=data.get('notes'),
        )
        db.session.add(titer_run)
        db.session.flush()
        samples_payload = data.get('samples', [])
        for sample in samples_payload:
            virus_volume = sample.get('virus_volume_ul', 0)
            try:
                virus_volume_value = float(virus_volume)
            except (TypeError, ValueError):
                return jsonify({'error': 'Sample virus volume must be numeric.'}), 400
            sample_entry = TiterSample(
                titer_run_id=titer_run.id,
                label=sample['label'],
                virus_volume_ul=virus_volume_value,
                selection_used=sample.get('selection_used', False),
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
    control_percent = data.get('control_percent', 100)
    cells_at_transduction = run.cells_seeded

    updated_samples = []
    for sample_data in data.get('samples', []):
        sample = TiterSample.query.filter_by(id=sample_data['id'], titer_run_id=run.id).first_or_404()
        measured_percent = sample_data.get('measured_percent')
        if measured_percent is None:
            continue
        fraction_infected = max(0.0, min(1.0, 1 - (measured_percent / control_percent)))
        moi = compute_moi(fraction_infected)
        titer = compute_titer(cells_at_transduction, moi, sample.virus_volume_ul)
        sample.measured_percent = measured_percent
        sample.moi = round(moi, 4) if math.isfinite(moi) else None
        sample.titer_tu_ml = round(titer, 2) if math.isfinite(titer) else None
        updated_samples.append(sample.to_dict())
    db.session.commit()

    average_titer = None
    titers = [s['titer_tu_ml'] for s in updated_samples if s['titer_tu_ml'] is not None]
    if titers:
        average_titer = sum(titers) / len(titers)
    rounded_average = round_significant(average_titer) if average_titer is not None else None

    return jsonify({
        'samples': updated_samples,
        'average_titer': average_titer,
        'rounded_average_titer': rounded_average,
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


if __name__ == '__main__':
    app.run(debug=True)
