"""Blueprint routes for the Lentivirus tracker Flask application."""
from __future__ import annotations

import math
from datetime import datetime
from typing import Iterable

from flask import Blueprint, current_app, jsonify, render_template, request

from .constants import BASE_TRANSFECTION, DEFAULT_MOLAR_RATIO, SURFACE_AREAS
from .database import db
from .models import (
    Experiment,
    Harvest,
    LentivirusPrep,
    MediaChange,
    TiterRun,
    TiterSample,
    Transfection,
)
from .utils import (
    calculate_seeding_volume,
    calculate_transfection_scaling,
    compute_moi,
    compute_titer,
    parse_optional_float,
    parse_positive_int,
    parse_shorthand_number,
    round_titer_average,
    total_plate_count,
)


bp = Blueprint('main', __name__)


@bp.route('/')
def index():
    today = datetime.utcnow().date().isoformat()
    return render_template(
        'index.html',
        surface_areas=SURFACE_AREAS,
        today=today,
        default_media='DMEM + 10% FBS',
    )


@bp.route('/api/experiments', methods=['GET', 'POST'])
def experiments_endpoint():
    if request.method == 'POST':
        data = request.get_json(force=True)
        seeding_date = (
            datetime.strptime(data.get('seeding_date'), '%Y-%m-%d').date()
            if data.get('seeding_date')
            else datetime.utcnow().date()
        )
        vessels_seeded = parse_positive_int(data.get('vessels_seeded'), default=1)
        cells_to_seed = parse_shorthand_number(data.get('cells_to_seed'))
        if cells_to_seed is None:
            return jsonify({'error': 'cells_to_seed is required'}), 400

        name_value = (data.get('name') or '').strip()
        if not name_value:
            base_date = seeding_date.isoformat()
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
            current_app.logger.exception('Failed to persist experiment')
            return jsonify({'error': 'Unable to save experiment', 'details': str(exc)}), 500
        return jsonify({'experiment': experiment.to_dict()})

    experiments = Experiment.query.order_by(Experiment.created_at.desc()).all()
    return jsonify({'experiments': [exp.to_dict() for exp in experiments]})


@bp.route('/api/experiments/<int:experiment_id>', methods=['GET', 'PUT', 'DELETE'])
def experiment_detail(experiment_id: int):
    experiment = Experiment.query.get_or_404(experiment_id)

    if request.method == 'GET':
        return jsonify({'experiment': experiment.to_dict(include_children=True)})

    if request.method == 'DELETE':
        db.session.delete(experiment)
        db.session.commit()
        return jsonify({'deleted': True})

    data = request.get_json(force=True)
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
        updates['vessels_seeded'] = parse_positive_int(data.get('vessels_seeded'))

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
        experiment.seeding_date = (
            datetime.strptime(data['seeding_date'], '%Y-%m-%d').date()
            if data['seeding_date']
            else None
        )

    db.session.commit()
    return jsonify({'experiment': experiment.to_dict()})


@bp.route('/api/experiments/<int:experiment_id>/preps', methods=['POST', 'GET'])
def prep_endpoint(experiment_id: int):
    experiment = Experiment.query.get_or_404(experiment_id)

    if request.method == 'POST':
        data = request.get_json(force=True)
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


@bp.route('/api/preps/<int:prep_id>', methods=['PUT', 'DELETE'])
def update_prep(prep_id: int):
    prep = LentivirusPrep.query.get_or_404(prep_id)

    if request.method == 'DELETE':
        db.session.delete(prep)
        db.session.commit()
        return jsonify({'deleted': True})

    data = request.get_json(force=True)

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


def _parse_ratio(ratio_payload: Iterable[float] | None, mode: str) -> tuple[float, float, float]:
    if mode == 'optimal' or not ratio_payload:
        return DEFAULT_MOLAR_RATIO
    return tuple(float(value) for value in ratio_payload)


def _compute_volume(mass_ug: float, concentration_ng_ul) -> float | None:
    if concentration_ng_ul in (None, 0):
        return None
    try:
        concentration_value = float(concentration_ng_ul)
    except (TypeError, ValueError):
        return None
    if concentration_value == 0:
        return None
    return round((mass_ug * 1000.0) / concentration_value, 3)


@bp.route('/api/preps/<int:prep_id>/transfection', methods=['POST'])
def transfection_endpoint(prep_id: int):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    experiment = prep.experiment
    vessel_type = experiment.vessel_type if experiment else BASE_TRANSFECTION['vessel']
    data = request.get_json(force=True)

    ratio_mode = data.get('ratio_mode', 'optimal')
    ratio = _parse_ratio(data.get('ratio'), ratio_mode)
    scaling = calculate_transfection_scaling(vessel_type, ratio)

    transfer_conc = data.get('transfer_concentration_ng_ul') or prep.transfer_concentration
    packaging_conc = data.get('packaging_concentration_ng_ul')
    envelope_conc = data.get('envelope_concentration_ng_ul')

    transfection = prep.transfection or Transfection(prep=prep)
    transfection.vessel_type = vessel_type
    base_vessel = BASE_TRANSFECTION['vessel']
    transfection.surface_area = SURFACE_AREAS.get(
        vessel_type,
        SURFACE_AREAS[base_vessel] * scaling['surface_ratio'],
    )
    transfection.opti_mem_ml = scaling['opti_mem_ml']
    transfection.xtremegene_ul = scaling['xtremegene_ul']
    transfection.total_plasmid_ug = scaling['total_plasmid_ug']
    transfection.transfer_ratio, transfection.packaging_ratio, transfection.envelope_ratio = ratio
    transfection.transfer_mass_ug = scaling['transfer_mass_ug']
    transfection.packaging_mass_ug = scaling['packaging_mass_ug']
    transfection.envelope_mass_ug = scaling['envelope_mass_ug']
    transfection.ratio_mode = ratio_mode
    transfection.transfer_concentration_ng_ul = transfer_conc
    transfection.packaging_concentration_ng_ul = packaging_conc
    transfection.envelope_concentration_ng_ul = envelope_conc
    transfection.transfer_volume_ul = _compute_volume(scaling['transfer_mass_ug'], transfer_conc)
    transfection.packaging_volume_ul = _compute_volume(scaling['packaging_mass_ug'], packaging_conc)
    transfection.envelope_volume_ul = _compute_volume(scaling['envelope_mass_ug'], envelope_conc)
    transfection.ratio_display = f"{ratio[0]}:{ratio[1]}:{ratio[2]}"

    db.session.add(transfection)
    db.session.commit()
    return jsonify({'transfection': transfection.to_dict()})


@bp.route('/api/preps/<int:prep_id>/media-change', methods=['POST'])
def media_change_endpoint(prep_id: int):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    data = request.get_json(force=True)

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


@bp.route('/api/preps/<int:prep_id>/harvest', methods=['POST'])
def harvest_endpoint(prep_id: int):
    prep = LentivirusPrep.query.get_or_404(prep_id)
    data = request.get_json(force=True)

    harvest_date = (
        datetime.strptime(data.get('harvest_date'), '%Y-%m-%d').date()
        if data.get('harvest_date')
        else None
    )
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


@bp.route('/api/preps/<int:prep_id>/titer-runs', methods=['POST', 'GET'])
def titer_runs_endpoint(prep_id: int):
    LentivirusPrep.query.get_or_404(prep_id)

    if request.method == 'POST':
        data = request.get_json(force=True)
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

        for sample in data.get('samples', []):
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


@bp.route('/api/titer-runs/<int:run_id>/results', methods=['POST'])
def titer_results_endpoint(run_id: int):
    run = TiterRun.query.get_or_404(run_id)
    data = request.get_json(force=True)

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
        sample = TiterSample.query.filter_by(
            id=sample_payload['id'], titer_run_id=run.id
        ).first_or_404()
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

    return jsonify(
        {
            'samples': updated_samples,
            'average_titer': average_titer,
            'control_cell_concentration': run.control_cell_concentration,
            'measurement_media_ml': run.measurement_media_ml,
        }
    )


@bp.route('/api/metrics/transfection', methods=['POST'])
def metrics_transfection():
    data = request.get_json(force=True)
    vessel_type = data['vessel_type']
    ratio_mode = data.get('ratio_mode', 'optimal')
    ratio = _parse_ratio(data.get('ratio'), ratio_mode)

    scaling = calculate_transfection_scaling(vessel_type, ratio)
    scaling['surface_area'] = SURFACE_AREAS[vessel_type]
    scaling['ratio'] = ratio
    scaling['transfer_volume_ul'] = _compute_volume(
        scaling['transfer_mass_ug'], data.get('transfer_concentration_ng_ul')
    )
    scaling['packaging_volume_ul'] = _compute_volume(
        scaling['packaging_mass_ug'], data.get('packaging_concentration_ng_ul')
    )
    scaling['envelope_volume_ul'] = _compute_volume(
        scaling['envelope_mass_ug'], data.get('envelope_concentration_ng_ul')
    )
    scaling['ratio_display'] = f"{ratio[0]}:{ratio[1]}:{ratio[2]}"
    return jsonify(scaling)


@bp.route('/api/metrics/seeding', methods=['POST'])
def metrics_seeding():
    data = request.get_json(force=True)
    vessel_type = data['vessel_type']
    target_cells = data.get('target_cells')
    volume = calculate_seeding_volume(vessel_type, target_cells)
    return jsonify({'seeding_volume_ml': round(volume, 3)})


@bp.route('/api/metrics/moi', methods=['POST'])
def metrics_moi():
    data = request.get_json(force=True)
    fraction_infected = data['fraction_infected']
    moi = compute_moi(fraction_infected)
    return jsonify({'moi': moi})


@bp.route('/api/metrics/titer', methods=['POST'])
def metrics_titer():
    data = request.get_json(force=True)
    cells = data['cells']
    moi = data['moi']
    virus_volume_ul = data['virus_volume_ul']
    titer = compute_titer(cells, moi, virus_volume_ul)
    return jsonify({'titer': titer})
