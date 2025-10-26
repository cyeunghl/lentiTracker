"""Static configuration values for the Lentivirus tracker application."""

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
    'vessel': 'T175',
}

BASE_TRANSFECTION = {
    'vessel': 'T175',
    'opti_mem_ml': 1.0,
    'xtremegene_ul': 76.8,
    'total_plasmid_ug': 25.6,
    'reagent_to_dna_ratio': 3.0,
}

PACKAGING_PLASMID_BP = 10_709
ENVELOPE_PLASMID_BP = 5_822
DEFAULT_MOLAR_RATIO = (4, 3, 1)
