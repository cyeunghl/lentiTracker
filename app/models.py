"""SQLAlchemy model definitions for the Lentivirus tracker."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from .database import db
from .utils import round_titer_average


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

    def to_dict(self, include_children: bool = False) -> dict:
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
            'titer_summaries': [
                summary for summary in (prep.latest_titer_summary() for prep in self.preps) if summary
            ],
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

    def latest_titer_summary(self) -> Optional[dict]:
        if not self.titer_runs:
            return None
        latest_run = max(self.titer_runs, key=lambda run: run.created_at)
        samples = [sample for sample in latest_run.samples if sample.titer_tu_ml is not None]
        if not samples:
            return None
        average = round_titer_average(sum(sample.titer_tu_ml for sample in samples) / len(samples))
        return {
            'prep_id': self.id,
            'transfer_name': self.transfer_name,
            'average_titer': average,
            'run_id': latest_run.id,
            'run_created_at': latest_run.created_at.isoformat(),
        }

    def to_dict(self, include_children: bool = False) -> dict:
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
            'latest_titer': self.latest_titer_summary(),
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

    def to_dict(self) -> dict:
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

    def to_dict(self) -> dict:
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

    def to_dict(self) -> dict:
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

    def to_dict(self, include_samples: bool = False) -> dict:
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

    def to_dict(self) -> dict:
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
