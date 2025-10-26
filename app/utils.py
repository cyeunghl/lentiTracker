"""Utility helpers shared across the Flask views and models."""
from __future__ import annotations

import math
from typing import Iterable, Optional

from .constants import BASE_SEEDING, BASE_TRANSFECTION, DEFAULT_MOLAR_RATIO, SURFACE_AREAS


SHORTHAND_MULTIPLIERS = {
    'K': 1_000,
    'M': 1_000_000,
    'B': 1_000_000_000,
}


def parse_positive_int(value, default: Optional[int] = None) -> Optional[int]:
    if value in (None, ''):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number <= 0:
        return default
    return int(round(number))


def total_plate_count(experiment, exclude_prep_id: Optional[int] = None) -> int:
    return sum(
        (prep.plate_count or 0)
        for prep in experiment.preps
        if exclude_prep_id is None or prep.id != exclude_prep_id
    )


def parse_optional_float(value) -> Optional[float]:
    if value in (None, ''):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_shorthand_number(value) -> Optional[float]:
    """Convert shorthand numeric strings like ``750K`` or ``1.5M`` to floats."""
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


def calculate_seeding_volume(vessel_type: str, target_cells: Optional[float]) -> float:
    ratio = calculate_surface_ratio(vessel_type)
    base_volume = BASE_SEEDING['volume_ml'] * ratio
    if target_cells:
        return target_cells / BASE_SEEDING['density']
    return base_volume


def calculate_transfection_scaling(
    vessel_type: str, ratio: Optional[Iterable[float]] = None
) -> dict:
    surface_ratio = calculate_surface_ratio(vessel_type)
    opti_mem = BASE_TRANSFECTION['opti_mem_ml'] * surface_ratio
    xtremegene = BASE_TRANSFECTION['xtremegene_ul'] * surface_ratio
    total_plasmid = BASE_TRANSFECTION['total_plasmid_ug'] * surface_ratio

    if ratio is None:
        ratio = DEFAULT_MOLAR_RATIO

    transfer, packaging, envelope = ratio
    total_ratio = sum(ratio)
    transfer_mass = total_plasmid * (transfer / total_ratio)
    packaging_mass = total_plasmid * (packaging / total_ratio)
    envelope_mass = total_plasmid * (envelope / total_ratio)

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


def round_titer_average(value: Optional[float]):
    if value in (None, 0):
        return 0 if value == 0 else None
    magnitude = math.floor(math.log10(abs(value))) - 2
    if magnitude < 0:
        magnitude = 0
    base = 10 ** magnitude
    return int(round(value / base) * base)
