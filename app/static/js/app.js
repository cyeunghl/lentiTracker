const api = {
    experiments: '/api/experiments',
    experimentDetail: (id) => `/api/experiments/${id}`,
    experimentPreps: (id) => `/api/experiments/${id}/preps`,
    prep: (id) => `/api/preps/${id}`,
    transfection: (prepId) => `/api/preps/${prepId}/transfection`,
    mediaChange: (prepId) => `/api/preps/${prepId}/media-change`,
    harvest: (prepId) => `/api/preps/${prepId}/harvest`,
    titerRuns: (prepId) => `/api/preps/${prepId}/titer-runs`,
    titerResults: (runId) => `/api/titer-runs/${runId}/results`,
    metrics: {
        transfection: '/api/metrics/transfection'
    }
};

const SHORTHAND_MULTIPLIERS = { K: 1e3, M: 1e6, B: 1e9 };

const state = {
    experiments: [],
    activeExperiment: null,
    selectedPreps: new Set(),
    editingPrepId: null,
    transfectionDraft: new Map(),
    mediaDraft: new Map(),
    harvestDraft: new Map(),
    titerSamples: [],
    titerPrepInputs: new Map(),
    titerForm: {
        cellLine: '',
        vesselType: '6-well',
        selectionReagent: 'Puromycin',
        selectionOther: '',
        selectionConcentration: '',
        polybrene: '',
        testsCount: 1,
        notes: ''
    },
    titerSaveScope: 'all',
    titerSaveTarget: null,
    titerPlanCopy: '',
    currentRunId: null
};

function parseNumericInput(value) {
    if (value === undefined || value === null) return null;
    const text = value.toString().trim().replace(/,/g, '');
    if (!text) return null;
    const direct = Number(text);
    if (!Number.isNaN(direct)) return direct;
    const match = text.match(/^(-?\d*\.?\d+)\s*([KMB])(?:[A-Z]*)?$/i);
    if (match) {
        const [, base, suffix] = match;
        return Number(base) * SHORTHAND_MULTIPLIERS[suffix.toUpperCase()];
    }
    return null;
}

function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    if (number >= 1e6) return `${(number / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return number.toLocaleString();
}

function formatWholeNumber(value) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    if (Number.isNaN(number) || !Number.isFinite(number)) return null;
    return Math.round(number).toLocaleString();
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString();
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function isoToday() {
    return new Date().toISOString().split('T')[0];
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!response.ok) {
        let message = 'Request failed';
        try {
            const text = await response.text();
            if (text) {
                try {
                    const payload = JSON.parse(text);
                    message = payload.error || payload.details || message;
                } catch (parseError) {
                    message = text;
                }
            }
        } catch (error) {
            // ignore body parsing errors and fall back to default message
        }
        throw new Error(message);
    }
    return response.json();
}

function toggleNewExperimentPanel(show) {
    const panel = document.getElementById('newExperimentPanel');
    panel.hidden = !show;
    if (show) {
        panel.querySelector('input[name="name"]').focus();
    }
}

function showDashboard() {
    document.getElementById('dashboardView').classList.add('active');
    document.getElementById('dashboardView').hidden = false;
    document.getElementById('workflowView').classList.remove('active');
    document.getElementById('workflowView').hidden = true;
    state.activeExperiment = null;
    state.selectedPreps.clear();
    state.currentRunId = null;
}

function showWorkflow() {
    document.getElementById('dashboardView').classList.remove('active');
    document.getElementById('dashboardView').hidden = true;
    document.getElementById('workflowView').hidden = false;
    document.getElementById('workflowView').classList.add('active');
}

async function loadExperiments() {
    const data = await fetchJSON(api.experiments);
    state.experiments = data.experiments || [];
    renderDashboard();
}

function createExperimentCard(experiment) {
    const card = document.createElement('article');
    card.className = 'experiment-card';
    const status = (experiment.status || 'active').toLowerCase();
    const vesselsSeeded = experiment.vessels_seeded || 0;
    const platesAllocated = experiment.plates_allocated || 0;
    const prepCount = experiment.prep_count || 0;
    const transfected = experiment.completed_preps || 0;
    const plateSummary = vesselsSeeded
        ? `${platesAllocated}/${vesselsSeeded} plates allocated`
        : `${platesAllocated} plate${platesAllocated === 1 ? '' : 's'} allocated`;

    card.innerHTML = `
        <span class="status-chip">${status === 'finished' ? 'Finished' : 'Active'}</span>
        <h3>${experiment.name || 'Untitled experiment'}</h3>
        <dl>
            <dt>Cell line</dt><dd>${experiment.cell_line}</dd>
            <dt>Cells to seed</dt><dd>${formatNumber(experiment.cells_to_seed)}</dd>
            <dt>Vessel</dt><dd>${experiment.vessel_type}</dd>
            <dt>Vessels seeded</dt><dd>${vesselsSeeded || '—'}</dd>
        </dl>
        <div class="prep-progress">${plateSummary} · ${transfected}/${prepCount} transfected</div>
    `;

    if (status === 'finished' && Array.isArray(experiment.titer_summaries) && experiment.titer_summaries.length) {
        const summaryList = document.createElement('ul');
        summaryList.className = 'titer-summary-list';
        experiment.titer_summaries.forEach((entry) => {
            const item = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = entry.transfer_name;
            const value = document.createElement('span');
            const formatted = formatWholeNumber(entry.average_titer);
            value.textContent = formatted ? `${formatted} TU/mL` : 'No titer recorded';
            item.append(name, value);
            summaryList.appendChild(item);
        });
        card.appendChild(summaryList);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'primary';
    openButton.textContent = 'Open';
    openButton.addEventListener('click', () => openExperimentDetail(experiment.id));
    actions.appendChild(openButton);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'ghost';
    toggleButton.textContent = status === 'finished' ? 'Mark active' : 'Mark finished';
    toggleButton.addEventListener('click', async () => {
        await updateExperiment(experiment.id, { status: status === 'finished' ? 'active' : 'finished' });
        await loadExperiments();
    });
    actions.appendChild(toggleButton);

    card.appendChild(actions);
    return card;
}

function renderDashboard() {
    const activeContainer = document.getElementById('activeExperiments');
    const finishedContainer = document.getElementById('finishedExperiments');
    activeContainer.innerHTML = '';
    finishedContainer.innerHTML = '';

    if (!state.experiments.length) {
        const empty = document.createElement('div');
        empty.className = 'callout muted';
        empty.textContent = 'No experiments saved yet. Start by creating a new experiment.';
        activeContainer.appendChild(empty);
        return;
    }

    state.experiments.forEach((experiment) => {
        const card = createExperimentCard(experiment);
        if ((experiment.status || 'active') === 'finished') {
            finishedContainer.appendChild(card);
        } else {
            activeContainer.appendChild(card);
        }
    });
}

async function createExperiment(event) {
    event.preventDefault();
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form));
    payload.cells_to_seed = parseNumericInput(payload.cells_to_seed);
    payload.vessels_seeded = payload.vessels_seeded ? Number(payload.vessels_seeded) : 1;
    payload.media_type = payload.media_type || APP_DEFAULT_MEDIA;
    payload.seeding_date = payload.seeding_date || isoToday();
    if (payload.cells_to_seed === null) {
        alert('Enter the number of cells to seed.');
        return;
    }
    try {
        await fetchJSON(api.experiments, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        form.reset();
        toggleNewExperimentPanel(false);
        await loadExperiments();
    } catch (error) {
        alert(error.message);
    }
}

async function updateExperiment(id, payload) {
    await fetchJSON(api.experimentDetail(id), {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
}

async function deleteExperiment(id) {
    await fetchJSON(api.experimentDetail(id), { method: 'DELETE' });
}

async function openExperimentDetail(experimentId) {
    const data = await fetchJSON(api.experimentDetail(experimentId));
    state.activeExperiment = data.experiment;
    const prepIds = new Set(state.activeExperiment.preps.map((prep) => prep.id));
    state.selectedPreps = new Set([...state.selectedPreps].filter((id) => prepIds.has(id)));
    state.currentRunId = ensureCurrentRunSelection();
    showWorkflow();
    renderWorkflow();
}

function ensureCurrentRunSelection() {
    if (!state.activeExperiment) return null;
    const runs = collectAllRuns();
    if (!runs.length) return null;
    if (state.currentRunId && runs.some((entry) => entry.id === state.currentRunId)) {
        return state.currentRunId;
    }
    return runs[0].id;
}

function collectAllRuns() {
    if (!state.activeExperiment) return [];
    return state.activeExperiment.preps
        .flatMap((prep) => (prep.titer_runs || []).map((run) => ({ prep, run })))
        .map(({ prep, run }) => ({
            id: run.id,
            prepId: prep.id,
            prepName: prep.transfer_name,
            data: run,
            label: `${prep.transfer_name} · ${formatDateTime(run.created_at)}`
        }));
}

function renderWorkflow() {
    if (!state.activeExperiment) return;
    renderExperimentHeader();
    renderSeedingSection();
    renderPrepSection();
    renderTransfectionSection();
    renderMediaSection();
    renderHarvestSection();
    renderTiterSetupSection();
    renderTiterResultsSection();
}

function renderExperimentHeader() {
    const experiment = state.activeExperiment;
    document.getElementById('workflowExperimentName').textContent = experiment.name || 'Experiment';
    const metaParts = [
        experiment.cell_line,
        `${formatNumber(experiment.cells_to_seed)} cells`,
        experiment.vessel_type
    ];
    if (experiment.vessels_seeded) {
        metaParts.push(`${experiment.plates_allocated || 0}/${experiment.vessels_seeded} plates allocated`);
    }
    document.getElementById('workflowExperimentMeta').textContent = metaParts.join(' · ');
    const toggleButton = document.getElementById('toggleExperimentStatus');
    toggleButton.textContent = (experiment.status || 'active') === 'finished' ? 'Mark active' : 'Mark finished';
}

function renderSeedingSection() {
    const experiment = state.activeExperiment;
    const form = document.getElementById('seedingDetailForm');
    form.querySelector('#detailName').value = experiment.name || '';
    form.querySelector('#detailCellLine').value = experiment.cell_line || 'HEK293T';
    form.querySelector('#detailCells').value = experiment.cells_to_seed ? formatNumber(experiment.cells_to_seed) : '';
    form.querySelector('#detailVessel').value = experiment.vessel_type || 'T175';
    form.querySelector('#detailVesselsSeeded').value = experiment.vessels_seeded || 1;
    form.querySelector('#detailMedia').value = experiment.media_type || APP_DEFAULT_MEDIA;
    form.querySelector('#detailDate').value = experiment.seeding_date || isoToday();

    const meta = document.getElementById('seedingMeta');
    meta.innerHTML = '';
    [
        ['Created', formatDateTime(experiment.created_at)],
        ['Updated', formatDateTime(experiment.updated_at)],
        ['Status', (experiment.status || 'active').toUpperCase()]
    ].forEach(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        meta.append(dt, dd);
    });
}

function getSelectedPrepIds() {
    return [...state.selectedPreps];
}

function getPrepById(prepId) {
    return state.activeExperiment.preps.find((prep) => prep.id === prepId);
}

function setPrepError(message) {
    const banner = document.getElementById('prepError');
    if (message) {
        banner.textContent = message;
        banner.hidden = false;
    } else {
        banner.hidden = true;
        banner.textContent = '';
    }
}

function renderStatusBar(prep) {
    const container = document.createElement('div');
    container.className = 'status-bar';
    const steps = [
        { key: 'logged', label: 'Logged' },
        { key: 'transfected', label: 'Transfected' },
        { key: 'media_changed', label: 'Media' },
        { key: 'harvested', label: 'Harvested' },
        { key: 'titered', label: 'Titered' }
    ];
    steps.forEach((step) => {
        const pill = document.createElement('span');
        pill.className = 'status-pill';
        if (prep.status && prep.status[step.key]) {
            pill.classList.add('complete');
        }
        pill.textContent = step.label;
        container.appendChild(pill);
    });
    return container;
}

function renderPrepSection() {
    const experiment = state.activeExperiment;
    const tbody = document.getElementById('prepTableBody');
    tbody.innerHTML = '';
    setPrepError(null);

    const capacity = experiment.vessels_seeded || 0;
    const allocated = experiment.plates_allocated || 0;
    const capacityBanner = document.getElementById('prepCapacity');
    if (capacity) {
        capacityBanner.textContent = `Allocated ${allocated}/${capacity} plates across ${experiment.prep_count || 0} preparations.`;
    } else {
        capacityBanner.textContent = `${allocated} plate${allocated === 1 ? '' : 's'} tracked across ${experiment.prep_count || 0} preparations.`;
    }

    experiment.preps
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .forEach((prep) => {
            const row = document.createElement('tr');
            row.dataset.prepId = prep.id;

            const selectCell = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = state.selectedPreps.has(prep.id);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    state.selectedPreps.add(prep.id);
                } else {
                    state.selectedPreps.delete(prep.id);
                }
                syncDraftsForSelection();
                renderTransfectionSection();
                renderMediaSection();
                renderHarvestSection();
                renderTiterSetupSection();
                renderTiterResultsSection();
                updatePrepSelectionSummary();
            });
            selectCell.appendChild(checkbox);
            row.appendChild(selectCell);

            const nameCell = document.createElement('td');
            if (state.editingPrepId === prep.id) {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'inline-input';
                input.value = prep.transfer_name;
                input.dataset.field = 'transfer_name';
                nameCell.appendChild(input);
            } else {
                const title = document.createElement('strong');
                title.textContent = prep.transfer_name;
                const meta = document.createElement('div');
                meta.className = 'muted';
                meta.textContent = `Created ${formatDateTime(prep.created_at)}`;
                nameCell.append(title, meta);
            }
            row.appendChild(nameCell);

            const transferCell = document.createElement('td');
            if (state.editingPrepId === prep.id) {
                const input = document.createElement('input');
                input.type = 'number';
                input.step = 'any';
                input.className = 'inline-input';
                input.value = prep.transfer_concentration ?? '';
                input.dataset.field = 'transfer_concentration';
                transferCell.appendChild(input);
            } else {
                transferCell.textContent = prep.transfer_concentration != null ? `${prep.transfer_concentration}` : '—';
            }
            row.appendChild(transferCell);

            const sizeCell = document.createElement('td');
            if (state.editingPrepId === prep.id) {
                const input = document.createElement('input');
                input.type = 'number';
                input.step = '1';
                input.className = 'inline-input';
                input.value = prep.plasmid_size_bp ?? '';
                input.dataset.field = 'plasmid_size_bp';
                sizeCell.appendChild(input);
            } else {
                sizeCell.textContent = prep.plasmid_size_bp != null ? prep.plasmid_size_bp.toLocaleString() : '—';
            }
            row.appendChild(sizeCell);

            const platesCell = document.createElement('td');
            if (state.editingPrepId === prep.id) {
                const input = document.createElement('input');
                input.type = 'number';
                input.min = '1';
                input.className = 'inline-input';
                input.value = prep.plate_count ?? 1;
                input.dataset.field = 'plate_count';
                platesCell.appendChild(input);
            } else {
                platesCell.textContent = prep.plate_count ?? 1;
            }
            row.appendChild(platesCell);

            const statusCell = document.createElement('td');
            statusCell.appendChild(renderStatusBar(prep));
            row.appendChild(statusCell);

            const actionsCell = document.createElement('td');
            actionsCell.className = 'row-actions';
            if (state.editingPrepId === prep.id) {
                const saveButton = document.createElement('button');
                saveButton.type = 'button';
                saveButton.className = 'primary small';
                saveButton.textContent = 'Save';
                saveButton.addEventListener('click', () => savePrepRow(row, prep.id));

                const cancelButton = document.createElement('button');
                cancelButton.type = 'button';
                cancelButton.className = 'ghost small';
                cancelButton.textContent = 'Cancel';
                cancelButton.addEventListener('click', () => {
                    state.editingPrepId = null;
                    renderPrepSection();
                });
                actionsCell.append(saveButton, cancelButton);
            } else {
                const editButton = document.createElement('button');
                editButton.type = 'button';
                editButton.className = 'ghost small';
                editButton.textContent = 'Edit';
                editButton.addEventListener('click', () => {
                    state.editingPrepId = prep.id;
                    renderPrepSection();
                });

                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'ghost small danger';
                deleteButton.textContent = 'Delete';
                deleteButton.addEventListener('click', async () => {
                    if (!confirm('Delete this preparation?')) return;
                    await fetchJSON(api.prep(prep.id), { method: 'DELETE' });
                    await refreshActiveExperiment();
                });

                actionsCell.append(editButton, deleteButton);
            }
            row.appendChild(actionsCell);

            tbody.appendChild(row);
        });

    updatePrepSelectionSummary();
}

function updatePrepSelectionSummary() {
    const summary = document.getElementById('prepSelectionSummary');
    const ids = getSelectedPrepIds();
    if (!ids.length) {
        summary.textContent = 'No preparations selected.';
    } else {
        summary.textContent = `${ids.length} prep${ids.length === 1 ? '' : 's'} selected.`;
    }
}

function collectRowValues(row) {
    const values = {};
    row.querySelectorAll('.inline-input').forEach((input) => {
        values[input.dataset.field] = input.value;
    });
    return values;
}

async function savePrepRow(row, prepId) {
    const values = collectRowValues(row);
    const payload = {};
    if (values.transfer_name !== undefined) payload.transfer_name = values.transfer_name.trim();
    if (values.transfer_concentration !== undefined) payload.transfer_concentration = values.transfer_concentration;
    if (values.plasmid_size_bp !== undefined) payload.plasmid_size_bp = values.plasmid_size_bp;
    if (values.plate_count !== undefined) payload.plate_count = values.plate_count;
    try {
        await fetchJSON(api.prep(prepId), {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        state.editingPrepId = null;
        await refreshActiveExperiment(prepId);
    } catch (error) {
        setPrepError(error.message);
    }
}

async function refreshActiveExperiment(focusPrepId = null) {
    if (!state.activeExperiment) return;
    const data = await fetchJSON(api.experimentDetail(state.activeExperiment.id));
    state.activeExperiment = data.experiment;
    if (focusPrepId && state.activeExperiment.preps.some((prep) => prep.id === focusPrepId)) {
        state.selectedPreps.add(focusPrepId);
    }
    state.selectedPreps = new Set([...state.selectedPreps].filter((id) => state.activeExperiment.preps.some((prep) => prep.id === id)));
    state.currentRunId = ensureCurrentRunSelection();
    syncDraftsForSelection();
    renderWorkflow();
}

function syncDraftsForSelection() {
    const selected = new Set(getSelectedPrepIds());
    [...state.transfectionDraft.keys()].forEach((key) => {
        if (!selected.has(key)) state.transfectionDraft.delete(key);
    });
    [...state.mediaDraft.keys()].forEach((key) => {
        if (!selected.has(key)) state.mediaDraft.delete(key);
    });
    [...state.harvestDraft.keys()].forEach((key) => {
        if (!selected.has(key)) state.harvestDraft.delete(key);
    });
    [...state.titerPrepInputs.keys()].forEach((key) => {
        if (!selected.has(key)) state.titerPrepInputs.delete(key);
    });

    selected.forEach((id) => {
        initializeTransfectionDraft(id);
        initializeMediaDraft(id);
        initializeHarvestDraft(id);
        initializeTiterPrepInput(id);
    });
}

function initializeTransfectionDraft(prepId) {
    if (state.transfectionDraft.has(prepId)) return;
    const prep = getPrepById(prepId);
    if (!prep) return;
    const existing = prep.transfection || {};
    state.transfectionDraft.set(prepId, {
        ratioMode: existing.ratio_display || '4:3:1',
        customRatio: existing.ratio_display && existing.ratio_display !== '4:3:1' ? existing.ratio_display : '4:3:1',
        transferConcentration: existing.transfer_concentration_ng_ul ?? prep.transfer_concentration ?? '',
        packagingConcentration: existing.packaging_concentration_ng_ul ?? '',
        envelopeConcentration: existing.envelope_concentration_ng_ul ?? '',
        metrics: null
    });
}

function initializeMediaDraft(prepId) {
    if (state.mediaDraft.has(prepId)) return;
    const prep = getPrepById(prepId);
    if (!prep) return;
    const media = prep.media_change || {};
    state.mediaDraft.set(prepId, {
        mediaType: media.media_type || state.activeExperiment.media_type || APP_DEFAULT_MEDIA,
        volume: media.volume_ml ?? ''
    });
}

function initializeHarvestDraft(prepId) {
    if (state.harvestDraft.has(prepId)) return;
    const prep = getPrepById(prepId);
    if (!prep) return;
    const harvest = prep.harvest || {};
    const media = prep.media_change || {};
    const volumeValue = harvest.volume_ml ?? media.volume_ml;
    state.harvestDraft.set(prepId, {
        date: harvest.harvest_date || isoToday(),
        volume: volumeValue != null ? String(volumeValue) : ''
    });
}

function initializeTiterPrepInput(prepId) {
    if (state.titerPrepInputs.has(prepId)) return;
    const prep = getPrepById(prepId);
    if (!prep) return;
    const defaultCells = state.activeExperiment.cells_to_seed && state.activeExperiment.vessels_seeded
        ? Math.round(state.activeExperiment.cells_to_seed / state.activeExperiment.vessels_seeded)
        : '';
    state.titerPrepInputs.set(prepId, {
        cellsSeeded: defaultCells ? formatNumber(defaultCells) : ''
    });
}

function parseRatioInput(value) {
    if (!value) return null;
    const parts = value
        .split(/[,:\s]+/)
        .map((token) => Number(token.trim()))
        .filter((num) => !Number.isNaN(num) && num > 0);
    if (parts.length !== 3) return null;
    return parts;
}

async function updateTransfectionMetrics(prepId) {
    const draft = state.transfectionDraft.get(prepId);
    if (!draft) return;
    const prep = getPrepById(prepId);
    if (!prep) return;
    let ratioMode = 'optimal';
    let ratioValues = null;
    if (draft.ratioMode !== '4:3:1') {
        ratioMode = 'custom';
        const parsed = parseRatioInput(draft.ratioMode);
        if (!parsed) {
            draft.metrics = null;
            return;
        }
        ratioValues = parsed;
    }
    try {
        const response = await fetchJSON(api.metrics.transfection, {
            method: 'POST',
            body: JSON.stringify({
                vessel_type: prep.vessel_type,
                ratio_mode: ratioMode,
                ratio: ratioValues || [4, 3, 1],
                transfer_concentration_ng_ul: draft.transferConcentration || prep.transfer_concentration || null,
                packaging_concentration_ng_ul: draft.packagingConcentration || null,
                envelope_concentration_ng_ul: draft.envelopeConcentration || null
            })
        });
        draft.metrics = response;
    } catch (error) {
        draft.metrics = null;
    }
}

function buildTransfectionRow(prep) {
    const draft = state.transfectionDraft.get(prep.id);
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const name = document.createElement('strong');
    name.textContent = prep.transfer_name;
    const vessel = document.createElement('div');
    vessel.className = 'muted';
    vessel.textContent = prep.vessel_type;
    nameCell.append(name, vessel);
    row.appendChild(nameCell);

    const ratioCell = document.createElement('td');
    const ratioSelect = document.createElement('select');
    ['4:3:1', '3:2:1', 'Other'].forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option === 'Other' ? 'Custom' : option;
        const current = draft?.ratioMode || '4:3:1';
        if ((option === 'Other' && current !== '4:3:1' && current !== '3:2:1') || option === current) {
            opt.selected = true;
        }
        ratioSelect.appendChild(opt);
    });
    ratioSelect.addEventListener('change', async () => {
        if (!draft) return;
        if (ratioSelect.value === 'Other') {
            draft.ratioMode = draft.customRatio || '4:3:1';
        } else {
            draft.ratioMode = ratioSelect.value;
        }
        row.querySelector('[data-role="custom-ratio"]').hidden = ratioSelect.value !== 'Other';
        await updateTransfectionMetrics(prep.id);
        renderTransfectionSection();
    });
    ratioCell.appendChild(ratioSelect);

    const customWrapper = document.createElement('div');
    customWrapper.dataset.role = 'custom-ratio';
    const isCustom = draft && !['4:3:1', '3:2:1'].includes(draft.ratioMode);
    customWrapper.hidden = !isCustom;
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.value = draft ? draft.customRatio : '4,3,1';
    customInput.addEventListener('input', async () => {
        draft.customRatio = customInput.value;
        draft.ratioMode = customInput.value;
        await updateTransfectionMetrics(prep.id);
        renderTransfectionSection();
    });
    customWrapper.appendChild(customInput);
    ratioCell.appendChild(customWrapper);
    row.appendChild(ratioCell);

    const transferCell = document.createElement('td');
    const transferInput = document.createElement('input');
    transferInput.type = 'number';
    transferInput.step = 'any';
    transferInput.value = draft?.transferConcentration ?? '';
    transferInput.placeholder = prep.transfer_concentration != null ? prep.transfer_concentration : '';
    transferInput.addEventListener('input', async () => {
        draft.transferConcentration = transferInput.value;
        await updateTransfectionMetrics(prep.id);
        renderTransfectionSection();
    });
    transferCell.appendChild(transferInput);
    row.appendChild(transferCell);

    const packagingCell = document.createElement('td');
    const packagingInput = document.createElement('input');
    packagingInput.type = 'number';
    packagingInput.step = 'any';
    packagingInput.value = draft?.packagingConcentration ?? '';
    packagingInput.addEventListener('input', async () => {
        draft.packagingConcentration = packagingInput.value;
        await updateTransfectionMetrics(prep.id);
        renderTransfectionSection();
    });
    packagingCell.appendChild(packagingInput);
    row.appendChild(packagingCell);

    const envelopeCell = document.createElement('td');
    const envelopeInput = document.createElement('input');
    envelopeInput.type = 'number';
    envelopeInput.step = 'any';
    envelopeInput.value = draft?.envelopeConcentration ?? '';
    envelopeInput.addEventListener('input', async () => {
        draft.envelopeConcentration = envelopeInput.value;
        await updateTransfectionMetrics(prep.id);
        renderTransfectionSection();
    });
    envelopeCell.appendChild(envelopeInput);
    row.appendChild(envelopeCell);

    const metricsCell = document.createElement('td');
    metricsCell.className = 'metrics-cell';
    if (draft?.metrics) {
        const m = draft.metrics;
        metricsCell.innerHTML = `
            <div>Opti-MEM: ${m.opti_mem_ml?.toFixed(3) ?? '—'} mL</div>
            <div>X-tremeGENE: ${m.xtremegene_ul?.toFixed(3) ?? '—'} µL</div>
            <div>Transfer: ${m.transfer_volume_ul ?? '—'} µL · Packaging: ${m.packaging_volume_ul ?? '—'} µL · Envelope: ${m.envelope_volume_ul ?? '—'} µL</div>
        `;
    } else {
        metricsCell.textContent = 'Provide concentrations to compute volumes.';
        metricsCell.classList.add('muted');
    }
    row.appendChild(metricsCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'row-actions';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'ghost small';
    copyButton.textContent = 'Copy label';
    copyButton.addEventListener('click', () => {
        const text = `${prep.transfer_name} — ${state.activeExperiment.cell_line} — ${isoToday()}`;
        copyToClipboard(copyButton, text);
    });
    actionsCell.appendChild(copyButton);
    row.appendChild(actionsCell);

    return row;
}

function renderTransfectionSection() {
    const placeholder = document.getElementById('transfectionPlaceholder');
    const tableWrapper = document.getElementById('transfectionTableWrapper');
    const tbody = tableWrapper.querySelector('tbody');
    const actions = document.getElementById('transfectionActions');
    const bulkControls = document.getElementById('transfectionBulkControls');
    const errorBanner = document.getElementById('transfectionError');
    errorBanner.hidden = true;
    errorBanner.textContent = '';

    const selectedIds = getSelectedPrepIds();
    if (!selectedIds.length) {
        placeholder.hidden = false;
        tableWrapper.hidden = true;
        actions.hidden = true;
        bulkControls.hidden = true;
        return;
    }

    placeholder.hidden = true;
    tableWrapper.hidden = false;
    actions.hidden = false;
    bulkControls.hidden = selectedIds.length <= 1;
    tbody.innerHTML = '';

    const pending = selectedIds.filter((id) => {
        const draft = state.transfectionDraft.get(id);
        return draft && draft.metrics === null;
    });
    if (pending.length) {
        Promise.all(pending.map((id) => updateTransfectionMetrics(id))).then(() => {
            renderTransfectionSection();
        });
    }

    selectedIds.forEach((id) => {
        tbody.appendChild(buildTransfectionRow(getPrepById(id)));
    });
}

function applyTransfectionBulk() {
    const packaging = document.getElementById('bulkPackagingInput').value;
    const envelope = document.getElementById('bulkEnvelopeInput').value;
    getSelectedPrepIds().forEach((id) => {
        const draft = state.transfectionDraft.get(id);
        if (!draft) return;
        if (packaging !== '') draft.packagingConcentration = packaging;
        if (envelope !== '') draft.envelopeConcentration = envelope;
    });
    Promise.all(getSelectedPrepIds().map((id) => updateTransfectionMetrics(id))).then(() => {
        renderTransfectionSection();
    });
}

function copyTransfectionLabels() {
    const button = document.getElementById('copyTransfectionLabels');
    const selected = getSelectedPrepIds();
    if (!selected.length || !button) return;
    const text = selected
        .map((id) => {
            const prep = getPrepById(id);
            if (!prep) return null;
            return `${prep.transfer_name} — ${state.activeExperiment.cell_line} — ${isoToday()}`;
        })
        .filter(Boolean)
        .join('\n');
    if (text) {
        copyToClipboard(button, text);
    }
}

function copyTransfectionLabelTable() {
    const button = document.getElementById('copyTransfectionTable');
    const selected = getSelectedPrepIds();
    if (!selected.length || !button) return;
    const cellLine = state.activeExperiment?.cell_line || '';
    const rows = selected
        .map((id) => {
            const prep = getPrepById(id);
            if (!prep) return null;
            return `${prep.transfer_name}\t${cellLine}\t${isoToday()}`;
        })
        .filter(Boolean);
    if (!rows.length) return;
    const header = 'Transfer name\tCell line\tDate';
    copyToClipboard(button, [header, ...rows].join('\n'));
}

async function saveTransfection() {
    const selected = getSelectedPrepIds();
    if (!selected.length) return;
    try {
        for (const prepId of selected) {
            const draft = state.transfectionDraft.get(prepId);
            if (!draft) continue;
            let ratioMode = 'optimal';
            let ratioValues = null;
            if (draft.ratioMode !== '4:3:1') {
                ratioMode = 'custom';
                ratioValues = parseRatioInput(draft.ratioMode);
                if (!ratioValues) throw new Error('Enter a valid molar ratio (e.g. 4:3:1).');
            }
            await fetchJSON(api.transfection(prepId), {
                method: 'POST',
                body: JSON.stringify({
                    ratio_mode: ratioMode,
                    ratio: ratioValues,
                    transfer_concentration_ng_ul: draft.transferConcentration || null,
                    packaging_concentration_ng_ul: draft.packagingConcentration || null,
                    envelope_concentration_ng_ul: draft.envelopeConcentration || null
                })
            });
        }
        await refreshActiveExperiment(selected[0]);
    } catch (error) {
        const banner = document.getElementById('transfectionError');
        banner.textContent = error.message;
        banner.hidden = false;
    }
}

function buildMediaEntry(prep) {
    const draft = state.mediaDraft.get(prep.id);
    const wrapper = document.createElement('div');
    wrapper.className = 'stack-item';
    wrapper.dataset.prepId = prep.id;

    const header = document.createElement('header');
    header.innerHTML = `<strong>${prep.transfer_name}</strong><span class="muted">${prep.status && prep.status.transfected ? 'Transfected' : 'Pending transfection'}</span>`;
    wrapper.appendChild(header);

    const controls = document.createElement('div');
    controls.className = 'media-controls';

    const mediaSelect = document.createElement('select');
    ['DMEM + 10% FBS', 'DMEM + 10% iFBS', 'DMEM + 20% iFBS', 'Other…'].forEach((label) => {
        const option = document.createElement('option');
        option.value = label === 'Other…' ? 'other' : label;
        option.textContent = label;
        const current = draft.mediaType;
        if (label === 'Other…' && current && !['DMEM + 10% FBS', 'DMEM + 10% iFBS', 'DMEM + 20% iFBS'].includes(current)) {
            option.selected = true;
        } else if (label === current) {
            option.selected = true;
        }
        mediaSelect.appendChild(option);
    });

    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.placeholder = 'Custom media';
    const isCustom = draft.mediaType && !['DMEM + 10% FBS', 'DMEM + 10% iFBS', 'DMEM + 20% iFBS'].includes(draft.mediaType);
    otherInput.hidden = !isCustom;
    otherInput.value = isCustom ? draft.mediaType : '';

    mediaSelect.addEventListener('change', () => {
        if (mediaSelect.value === 'other') {
            otherInput.hidden = false;
            draft.mediaType = otherInput.value || '';
        } else {
            otherInput.hidden = true;
            draft.mediaType = mediaSelect.value;
        }
    });
    otherInput.addEventListener('input', () => {
        draft.mediaType = otherInput.value;
    });

    const volumeInput = document.createElement('input');
    volumeInput.type = 'number';
    volumeInput.step = 'any';
    volumeInput.min = '0';
    volumeInput.value = draft.volume ?? '';
    volumeInput.placeholder = prep.media_change && prep.media_change.volume_ml != null ? prep.media_change.volume_ml : '';
    volumeInput.addEventListener('input', () => {
        draft.volume = volumeInput.value;
    });

    controls.append(mediaSelect, otherInput, volumeInput);
    wrapper.appendChild(controls);

    if (prep.media_change) {
        const history = document.createElement('div');
        history.className = 'muted';
        history.textContent = `Last saved: ${prep.media_change.media_type} · ${prep.media_change.volume_ml} mL`;
        wrapper.appendChild(history);
    }

    return wrapper;
}

function renderMediaSection() {
    const selected = getSelectedPrepIds();
    const placeholder = document.getElementById('mediaPlaceholder');
    const entriesContainer = document.getElementById('mediaEntries');
    const actions = document.getElementById('mediaActions');
    const bulkControls = document.getElementById('mediaBulkControls');
    const errorBanner = document.getElementById('mediaError');
    errorBanner.hidden = true;
    errorBanner.textContent = '';

    if (!selected.length) {
        placeholder.hidden = false;
        entriesContainer.hidden = true;
        actions.hidden = true;
        bulkControls.hidden = true;
        entriesContainer.innerHTML = '';
        return;
    }

    placeholder.hidden = true;
    entriesContainer.hidden = false;
    actions.hidden = false;
    bulkControls.hidden = selected.length <= 1;
    entriesContainer.innerHTML = '';

    selected.forEach((id) => {
        entriesContainer.appendChild(buildMediaEntry(getPrepById(id)));
    });
}

function applyMediaBulk() {
    const select = document.getElementById('mediaBulkSelect');
    const otherWrapper = document.getElementById('mediaBulkOtherWrapper');
    const otherInput = document.getElementById('mediaBulkOther');
    const volumeInput = document.getElementById('mediaBulkVolume');

    const mediaValue = select.value === 'other' ? otherInput.value : select.value;
    const volumeValue = volumeInput.value;

    if (select.value === 'other') {
        otherWrapper.hidden = false;
    } else {
        otherWrapper.hidden = true;
    }

    getSelectedPrepIds().forEach((id) => {
        const draft = state.mediaDraft.get(id);
        if (!draft) return;
        if (mediaValue) draft.mediaType = mediaValue;
        if (volumeValue !== '') draft.volume = volumeValue;
    });
    renderMediaSection();
}

async function saveMediaChanges() {
    try {
        for (const prepId of getSelectedPrepIds()) {
            const draft = state.mediaDraft.get(prepId);
            if (!draft) continue;
            if (!draft.mediaType) throw new Error('Media type is required for each preparation.');
            if (draft.volume === '' || draft.volume === null) throw new Error('Volume is required for each preparation.');
            await fetchJSON(api.mediaChange(prepId), {
                method: 'POST',
                body: JSON.stringify({
                    media_type: draft.mediaType,
                    volume_ml: Number(draft.volume)
                })
            });
        }
        await refreshActiveExperiment();
    } catch (error) {
        const banner = document.getElementById('mediaError');
        banner.textContent = error.message;
        banner.hidden = false;
    }
}

function buildHarvestEntry(prep) {
    const draft = state.harvestDraft.get(prep.id);
    const wrapper = document.createElement('div');
    wrapper.className = 'stack-item';
    wrapper.dataset.prepId = prep.id;

    const header = document.createElement('header');
    header.innerHTML = `<strong>${prep.transfer_name}</strong><span class="muted">${prep.status && prep.status.media_changed ? 'Media changed' : 'Media pending'}</span>`;
    wrapper.appendChild(header);

    const controls = document.createElement('div');
    controls.className = 'harvest-controls';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = draft.date || isoToday();
    dateInput.addEventListener('change', () => {
        draft.date = dateInput.value;
    });

    const volumeInput = document.createElement('input');
    volumeInput.type = 'number';
    volumeInput.step = 'any';
    volumeInput.min = '0';
    volumeInput.value = draft.volume ?? '';
    volumeInput.placeholder = prep.media_change && prep.media_change.volume_ml != null ? prep.media_change.volume_ml : '';
    volumeInput.addEventListener('input', () => {
        draft.volume = volumeInput.value;
    });

    const fillButton = document.createElement('button');
    fillButton.type = 'button';
    fillButton.className = 'ghost small';
    fillButton.textContent = 'Use media volume';
    const mediaVolume = prep.media_change && prep.media_change.volume_ml != null ? prep.media_change.volume_ml : null;
    if (mediaVolume == null) {
        fillButton.disabled = true;
        fillButton.title = 'No media volume recorded';
    }
    fillButton.addEventListener('click', () => {
        if (mediaVolume == null) return;
        draft.volume = String(mediaVolume);
        volumeInput.value = String(mediaVolume);
    });

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'ghost small';
    copyButton.textContent = 'Copy label';
    copyButton.addEventListener('click', () => {
        const volumeText = draft.volume || prep.harvest?.volume_ml || prep.media_change?.volume_ml || '';
        const text = `${prep.transfer_name} — ${dateInput.value || isoToday()} — ${volumeText} mL`;
        copyToClipboard(copyButton, text);
    });

    controls.append(dateInput, volumeInput, fillButton, copyButton);
    wrapper.appendChild(controls);

    if (prep.harvest) {
        const history = document.createElement('div');
        history.className = 'muted';
        history.textContent = `Last saved: ${formatDate(prep.harvest.harvest_date)} · ${prep.harvest.volume_ml} mL`;
        wrapper.appendChild(history);
    }

    return wrapper;
}

function renderHarvestSection() {
    const selected = getSelectedPrepIds();
    const placeholder = document.getElementById('harvestPlaceholder');
    const entries = document.getElementById('harvestEntries');
    const actions = document.getElementById('harvestActions');
    const errorBanner = document.getElementById('harvestError');
    errorBanner.hidden = true;
    errorBanner.textContent = '';

    if (!selected.length) {
        placeholder.hidden = false;
        entries.hidden = true;
        actions.hidden = true;
        entries.innerHTML = '';
        return;
    }

    placeholder.hidden = true;
    entries.hidden = false;
    actions.hidden = false;
    entries.innerHTML = '';

    selected.forEach((id) => {
        entries.appendChild(buildHarvestEntry(getPrepById(id)));
    });
}

function copyHarvestLabelTable() {
    const button = document.getElementById('copyHarvestTable');
    const selected = getSelectedPrepIds();
    if (!selected.length || !button) return;
    const rows = selected
        .map((id) => {
            const prep = getPrepById(id);
            const draft = state.harvestDraft.get(id);
            if (!prep) return null;
            const date = (draft && draft.date) || prep.harvest?.harvest_date || isoToday();
            const volume = (draft && draft.volume) || prep.harvest?.volume_ml || prep.media_change?.volume_ml || '';
            return `${prep.transfer_name}\t${date}\t${volume} mL`;
        })
        .filter(Boolean);
    if (!rows.length) return;
    const header = 'Transfer name\tDate\tVolume (mL)';
    copyToClipboard(button, [header, ...rows].join('\n'));
}

function setTiterPlanCopy(text) {
    state.titerPlanCopy = text || '';
    const button = document.getElementById('copyTiterPlanLabels');
    if (!button) return;
    const value = state.titerPlanCopy.trim();
    if (value) {
        button.hidden = false;
        button.dataset.clipboard = state.titerPlanCopy;
    } else {
        button.hidden = true;
        button.dataset.clipboard = '';
    }
}

function handleCopyTiterPlanLabels() {
    const button = document.getElementById('copyTiterPlanLabels');
    if (!button) return;
    const text = (button.dataset.clipboard || '').trim();
    if (!text) return;
    copyToClipboard(button, button.dataset.clipboard);
}

async function saveHarvests() {
    try {
        for (const prepId of getSelectedPrepIds()) {
            const draft = state.harvestDraft.get(prepId);
            if (!draft) continue;
            if (!draft.volume && draft.volume !== 0) throw new Error('Harvest volume required for each preparation.');
            await fetchJSON(api.harvest(prepId), {
                method: 'POST',
                body: JSON.stringify({
                    harvest_date: draft.date || null,
                    volume_ml: draft.volume === '' ? null : Number(draft.volume)
                })
            });
        }
        await refreshActiveExperiment();
    } catch (error) {
        const banner = document.getElementById('harvestError');
        banner.textContent = error.message;
        banner.hidden = false;
    }
}

function buildTiterSamples(count) {
    const samples = [];
    for (let i = 1; i <= count; i += 1) {
        samples.push({
            label: `Test ${i}`,
            role: 'test',
            volume: '',
            selection: true,
            locked: false
        });
    }
    samples.push({
        label: 'No LV + Selection',
        role: 'control-selection',
        volume: 0,
        selection: true,
        locked: true
    });
    samples.push({
        label: 'No LV − Selection',
        role: 'control-no-selection',
        volume: 0,
        selection: false,
        locked: true
    });
    return samples;
}

function renderTiterSamples() {
    const container = document.getElementById('titerSamples');
    container.innerHTML = '';
    if (!state.titerSamples.length) {
        const hint = document.createElement('div');
        hint.className = 'muted';
        hint.textContent = 'Generate wells to log virus volumes per condition.';
        container.appendChild(hint);
        return;
    }
    state.titerSamples.forEach((sample, index) => {
        const row = document.createElement('div');
        row.className = 'sample-row';
        row.dataset.index = index;
        const header = document.createElement('header');
        header.textContent = sample.label;
        row.appendChild(header);

        const volumeLabel = document.createElement('label');
        volumeLabel.textContent = 'Virus volume (µL)';
        const volumeInput = document.createElement('input');
        volumeInput.type = 'number';
        volumeInput.step = 'any';
        volumeInput.required = !sample.locked;
        volumeInput.disabled = sample.locked;
        volumeInput.value = sample.volume ?? '';
        volumeInput.addEventListener('input', () => {
            sample.volume = volumeInput.value;
        });
        volumeLabel.appendChild(volumeInput);
        row.appendChild(volumeLabel);

        const selectionLabel = document.createElement('label');
        selectionLabel.textContent = 'Selection applied';
        const selectionCheckbox = document.createElement('input');
        selectionCheckbox.type = 'checkbox';
        selectionCheckbox.checked = sample.selection;
        selectionCheckbox.disabled = sample.locked && sample.role !== 'test';
        selectionCheckbox.addEventListener('change', () => {
            sample.selection = selectionCheckbox.checked;
        });
        selectionLabel.appendChild(selectionCheckbox);
        row.appendChild(selectionLabel);

        container.appendChild(row);
    });
}

function renderTiterSaveControls(selectedIds) {
    const scopeSelect = document.getElementById('titerSaveScope');
    const targetSelect = document.getElementById('titerSaveTarget');
    if (!scopeSelect || !targetSelect) return;

    if (!selectedIds.length) {
        scopeSelect.value = 'all';
        scopeSelect.disabled = true;
        state.titerSaveScope = 'all';
        state.titerSaveTarget = null;
        targetSelect.hidden = true;
        targetSelect.innerHTML = '';
        return;
    }

    scopeSelect.disabled = false;
    scopeSelect.value = state.titerSaveScope;

    if (state.titerSaveScope === 'single') {
        targetSelect.hidden = false;
        targetSelect.innerHTML = '';
        selectedIds.forEach((prepId) => {
            const prep = getPrepById(prepId);
            if (!prep) return;
            const option = document.createElement('option');
            option.value = String(prepId);
            option.textContent = prep.transfer_name;
            targetSelect.appendChild(option);
        });
        if (!selectedIds.includes(state.titerSaveTarget)) {
            state.titerSaveTarget = selectedIds.length ? selectedIds[0] : null;
        }
        if (state.titerSaveTarget != null) {
            targetSelect.value = String(state.titerSaveTarget);
        }
        targetSelect.disabled = selectedIds.length === 0;
        if (!targetSelect.options.length) {
            targetSelect.hidden = true;
        }
    } else {
        targetSelect.hidden = true;
        targetSelect.innerHTML = '';
        state.titerSaveTarget = null;
    }
}

function renderTiterPrepTable() {
    const tableBody = document.querySelector('#titerPrepTable tbody');
    tableBody.innerHTML = '';
    getSelectedPrepIds().forEach((id) => {
        const prep = getPrepById(id);
        const draft = state.titerPrepInputs.get(id) || { cellsSeeded: '' };
        const row = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = prep.transfer_name;
        row.appendChild(nameCell);
        const cellsCell = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = draft.cellsSeeded || '';
        input.placeholder = 'e.g. 1M';
        input.addEventListener('input', () => {
            state.titerPrepInputs.set(id, { cellsSeeded: input.value });
        });
        cellsCell.appendChild(input);
        row.appendChild(cellsCell);
        tableBody.appendChild(row);
    });
}

function renderTiterRunsList() {
    const container = document.getElementById('titerRunsContainer');
    const runs = collectAllRuns();
    if (!runs.length) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }
    container.hidden = false;
    container.innerHTML = '';

    const groups = new Map();
    runs.forEach((entry) => {
        if (!groups.has(entry.prepId)) {
            groups.set(entry.prepId, { prepName: entry.prepName, runs: [] });
        }
        groups.get(entry.prepId).runs.push(entry);
    });

    groups.forEach((group) => {
        const section = document.createElement('div');
        section.className = 'stack-item';
        const header = document.createElement('header');
        header.innerHTML = `<strong>${group.prepName}</strong><span class="muted">${group.runs.length} run${group.runs.length === 1 ? '' : 's'}</span>`;
        section.appendChild(header);
        const list = document.createElement('div');
        list.className = 'run-list';
        group.runs
            .sort((a, b) => new Date(b.data.created_at) - new Date(a.data.created_at))
            .forEach((entry) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'ghost small';
                if (entry.id === state.currentRunId) item.classList.add('active');
                item.textContent = formatDateTime(entry.data.created_at);
                item.addEventListener('click', () => {
                    state.currentRunId = entry.id;
                    renderTiterResultsSection();
                    renderTiterRunsList();
                });
                list.appendChild(item);
            });
        section.appendChild(list);
        container.appendChild(section);
    });
}

function renderTiterSetupSection() {
    const selected = getSelectedPrepIds();
    const placeholder = document.getElementById('titerSetupPlaceholder');
    const form = document.getElementById('titerSetupForm');
    const tableWrapper = document.getElementById('titerPrepTableWrapper');
    const sampleBuilder = document.getElementById('titerSampleBuilder');
    const actions = document.getElementById('titerSetupActions');
    const errorBanner = document.getElementById('titerSetupError');
    errorBanner.hidden = true;
    errorBanner.textContent = '';

    if (!selected.length) {
        setTiterPlanCopy('');
        placeholder.hidden = false;
        form.hidden = true;
        tableWrapper.hidden = true;
        sampleBuilder.hidden = true;
        actions.hidden = true;
        renderTiterSaveControls([]);
        renderTiterRunsList();
        return;
    }

    placeholder.hidden = true;
    form.hidden = false;
    tableWrapper.hidden = false;
    sampleBuilder.hidden = !state.titerSamples.length;
    actions.hidden = false;

    const formState = state.titerForm;
    const cellLineInput = form.querySelector('#titerCellLine');
    cellLineInput.value = formState.cellLine || '';
    form.querySelector('#titerVessel').value = formState.vesselType;
    const selectionReagentSelect = form.querySelector('#selectionReagent');
    const selectionOtherGroup = document.getElementById('selectionOtherGroup');
    const selectionOtherInput = document.getElementById('selectionOtherInput');
    const predefinedReagents = ['Puromycin', 'Blasticidin', 'Hygromycin'];
    if (predefinedReagents.includes(formState.selectionReagent)) {
        selectionReagentSelect.value = formState.selectionReagent;
        selectionOtherGroup.hidden = true;
        selectionOtherInput.value = '';
        selectionOtherInput.disabled = true;
        formState.selectionOther = '';
    } else {
        selectionReagentSelect.value = 'Other';
        selectionOtherGroup.hidden = false;
        selectionOtherInput.disabled = false;
        const customValue = formState.selectionOther || formState.selectionReagent || '';
        selectionOtherInput.value = customValue;
        formState.selectionOther = customValue;
    }
    form.querySelector('#selectionConcentration').value = formState.selectionConcentration;
    form.querySelector('#polybreneInput').value = formState.polybrene;
    form.querySelector('#testsCount').value = formState.testsCount;
    form.querySelector('#titerNotes').value = formState.notes;

    renderTiterSaveControls(selected);
    renderTiterPrepTable();
    renderTiterSamples();
    renderTiterRunsList();
    setTiterPlanCopy(state.titerPlanCopy);
}

function generateTiterSamples() {
    const count = Number(document.getElementById('testsCount').value) || 1;
    state.titerForm.testsCount = count;
    state.titerSamples = buildTiterSamples(count);
    renderTiterSamples();
    document.getElementById('titerSampleBuilder').hidden = false;
}

async function saveTiterSetup() {
    const selected = getSelectedPrepIds();
    if (!selected.length) return;
    const errorBanner = document.getElementById('titerSetupError');
    errorBanner.hidden = true;
    errorBanner.textContent = '';

    let targets = selected;
    if (state.titerSaveScope === 'single') {
        if (state.titerSaveTarget == null || !selected.includes(state.titerSaveTarget)) {
            errorBanner.textContent = 'Choose a preparation to save the titer plan.';
            errorBanner.hidden = false;
            return;
        }
        targets = [state.titerSaveTarget];
    }
    const formState = state.titerForm;
    formState.cellLine = document.getElementById('titerCellLine').value.trim() || formState.cellLine;
    formState.vesselType = document.getElementById('titerVessel').value;
    const selectionValue = document.getElementById('selectionReagent').value;
    if (selectionValue === 'Other') {
        const otherValue = document.getElementById('selectionOtherInput').value.trim();
        if (!otherValue) {
            errorBanner.textContent = 'Enter a selection reagent.';
            errorBanner.hidden = false;
            return;
        }
        formState.selectionReagent = otherValue;
        formState.selectionOther = otherValue;
    } else {
        formState.selectionReagent = selectionValue;
        formState.selectionOther = '';
    }
    formState.selectionConcentration = document.getElementById('selectionConcentration').value;
    formState.polybrene = document.getElementById('polybreneInput').value;
    formState.notes = document.getElementById('titerNotes').value;

    if (!formState.cellLine) {
        errorBanner.textContent = 'Cell line is required.';
        errorBanner.hidden = false;
        return;
    }
    if (!state.titerSamples.length) {
        errorBanner.textContent = 'Generate wells before saving the plan.';
        errorBanner.hidden = false;
        return;
    }

    const labelRows = [];
    try {
        const selectionName = formState.selectionReagent;
        for (const prepId of targets) {
            const prep = getPrepById(prepId);
            const draft = state.titerPrepInputs.get(prepId) || { cellsSeeded: '' };
            const cellsSeeded = parseNumericInput(draft.cellsSeeded);
            if (cellsSeeded === null) throw new Error('Enter cells seeded for each preparation.');
            const cellsLabel = Number(cellsSeeded).toLocaleString();
            const samples = state.titerSamples.map((sample) => ({
                label: sample.label,
                virus_volume_ul: Number(sample.volume) || 0,
                selection_used: !!sample.selection
            }));
            state.titerSamples
                .filter((sample) => sample.role === 'test')
                .forEach((sample) => {
                    const volumeValue = sample.volume === '' || sample.volume == null ? 0 : Number(sample.volume);
                    const volumeText = Number.isFinite(volumeValue) ? volumeValue.toString() : '0';
                    labelRows.push(`${prep?.transfer_name ?? ''} — ${formState.cellLine} — ${cellsLabel} cells — ${volumeText} µL`);
                });
            await fetchJSON(api.titerRuns(prepId), {
                method: 'POST',
                body: JSON.stringify({
                    cell_line: formState.cellLine,
                    cells_seeded: cellsSeeded,
                    vessel_type: formState.vesselType,
                    selection_reagent: formState.selectionReagent,
                    selection_concentration: formState.selectionConcentration !== '' ? Number(formState.selectionConcentration) : null,
                    tests_count: state.titerSamples.filter((sample) => sample.role === 'test').length,
                    notes: formState.notes,
                    polybrene_ug_ml: formState.polybrene !== '' ? Number(formState.polybrene) : null,
                    samples,
                    measurement_media_ml: null,
                    control_cell_concentration: null
                })
            });
        }
        if (labelRows.length) {
            labelRows.push(`No LV + ${selectionName}`);
            labelRows.push(`No LV − ${selectionName}`);
        }
        setTiterPlanCopy(labelRows.join('\n'));
        state.titerSamples = [];
        document.getElementById('titerSampleBuilder').hidden = true;
        await refreshActiveExperiment(targets[0]);
    } catch (error) {
        setTiterPlanCopy('');
        errorBanner.textContent = error.message;
        errorBanner.hidden = false;
    }
}

function renderTiterResultsSection() {
    const runs = collectAllRuns();
    const selectorWrapper = document.getElementById('titerRunSelector');
    const select = document.getElementById('titerRunSelect');
    const placeholder = document.getElementById('titerResultsPlaceholder');
    const form = document.getElementById('titerResultsForm');
    const summary = document.getElementById('titerSummary');
    const copyButton = document.getElementById('copyTiterSummary');

    if (!runs.length) {
        selectorWrapper.hidden = true;
        placeholder.hidden = false;
        form.hidden = true;
        summary.textContent = '';
        copyButton.hidden = true;
        return;
    }

    selectorWrapper.hidden = false;
    placeholder.hidden = true;
    form.hidden = false;

    select.innerHTML = '';
    runs.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.label;
        select.appendChild(option);
    });
    if (!state.currentRunId || !runs.some((entry) => entry.id === state.currentRunId)) {
        state.currentRunId = runs[0].id;
    }
    select.value = state.currentRunId;

    populateTiterResults(runs.find((entry) => entry.id === state.currentRunId));
}

function populateTiterResults(entry) {
    if (!entry) return;
    const run = entry.data;
    const form = document.getElementById('titerResultsForm');
    const measurementInput = document.getElementById('resultsMeasurementVolume');
    const controlInput = document.getElementById('resultsControlConcentration');
    measurementInput.value = run.measurement_media_ml ?? '';
    controlInput.value = run.control_cell_concentration ?? '';

    const samplesContainer = document.getElementById('resultsSamples');
    samplesContainer.innerHTML = '';
    run.samples.forEach((sample) => {
        const row = document.createElement('div');
        row.className = 'sample-row';
        row.dataset.sampleId = sample.id;
        const header = document.createElement('header');
        header.textContent = sample.label;
        row.appendChild(header);

        const volumeLabel = document.createElement('label');
        volumeLabel.textContent = 'Virus volume (µL)';
        const volumeInput = document.createElement('input');
        volumeInput.type = 'number';
        volumeInput.step = 'any';
        volumeInput.value = sample.virus_volume_ul ?? 0;
        volumeInput.disabled = true;
        volumeLabel.appendChild(volumeInput);
        row.appendChild(volumeLabel);

        const selectionLabel = document.createElement('label');
        selectionLabel.textContent = 'Selection applied';
        const selectionCheckbox = document.createElement('input');
        selectionCheckbox.type = 'checkbox';
        selectionCheckbox.checked = sample.selection_used;
        selectionCheckbox.addEventListener('change', () => {
            sample.selection_used = selectionCheckbox.checked;
        });
        selectionLabel.appendChild(selectionCheckbox);
        row.appendChild(selectionLabel);

        const cellsLabel = document.createElement('label');
        cellsLabel.textContent = 'Cell concentration (cells/mL)';
        const cellsInput = document.createElement('input');
        cellsInput.type = 'text';
        cellsInput.value = sample.cell_concentration != null ? formatNumber(sample.cell_concentration) : '';
        cellsInput.placeholder = sample.label.includes('No LV') ? 'Control well' : 'e.g. 750K';
        cellsInput.addEventListener('input', () => {
            sample.cell_concentration = cellsInput.value;
        });
        cellsLabel.appendChild(cellsInput);
        row.appendChild(cellsLabel);

        const percent = document.createElement('div');
        percent.className = 'metric';
        percent.textContent = `% survival: ${sample.measured_percent != null ? sample.measured_percent : '—'}`;
        row.appendChild(percent);

        const moi = document.createElement('div');
        moi.className = 'metric';
        moi.textContent = `MOI: ${sample.moi != null ? sample.moi : '—'}`;
        row.appendChild(moi);

        const titer = document.createElement('div');
        titer.className = 'metric';
        titer.textContent = `Titer (TU/mL): ${sample.titer_tu_ml != null ? sample.titer_tu_ml.toLocaleString() : '—'}`;
        row.appendChild(titer);

        samplesContainer.appendChild(row);
    });

    document.getElementById('titerSummary').textContent = '';
    document.getElementById('copyTiterSummary').hidden = true;
}

async function submitTiterResults(event) {
    event.preventDefault();
    const runs = collectAllRuns();
    const entry = runs.find((run) => run.id === state.currentRunId);
    if (!entry) return;
    const measurementVolume = document.getElementById('resultsMeasurementVolume').value;
    const controlConcentration = document.getElementById('resultsControlConcentration').value;
    const samplesPayload = [];
    document.querySelectorAll('#resultsSamples .sample-row').forEach((row) => {
        const sampleId = Number(row.dataset.sampleId);
        const selection = row.querySelector('input[type="checkbox"]').checked;
        const cellValue = row.querySelector('input[type="text"]').value;
        samplesPayload.push({
            id: sampleId,
            selection_used: selection,
            cell_concentration: cellValue
        });
    });

    try {
        const response = await fetchJSON(api.titerResults(entry.id), {
            method: 'POST',
            body: JSON.stringify({
                measurement_media_ml: measurementVolume !== '' ? Number(measurementVolume) : null,
                control_cell_concentration: controlConcentration,
                samples: samplesPayload
            })
        });
        entry.data.samples = entry.data.samples.map((sample) => {
            const updated = response.samples.find((item) => item.id === sample.id);
            return updated ? { ...sample, ...updated } : sample;
        });
        entry.data.measurement_media_ml = response.measurement_media_ml;
        entry.data.control_cell_concentration = response.control_cell_concentration;
        populateTiterResults(entry);
        if (response.average_titer != null) {
            const summary = document.getElementById('titerSummary');
            summary.textContent = `Average titer: ${response.average_titer.toLocaleString()} TU/mL`;
            const copyButton = document.getElementById('copyTiterSummary');
            copyButton.hidden = false;
            copyButton.dataset.summary = `${entry.prepName} — ${new Date().toLocaleDateString()} — Lentivirus titer = ${response.average_titer.toLocaleString()} TU/mL`;
        }
        await refreshActiveExperiment(entry.prepId);
    } catch (error) {
        alert(error.message);
    }
}

function copyToClipboard(button, text) {
    if (!navigator.clipboard) {
        return;
    }
    navigator.clipboard.writeText(text).catch(() => {
        // Ignore clipboard errors silently
    });
}

function handleCopySummary() {
    const button = document.getElementById('copyTiterSummary');
    if (!button.dataset.summary) return;
    copyToClipboard(button, button.dataset.summary);
}

function handleSelectAllPreps() {
    state.activeExperiment.preps.forEach((prep) => state.selectedPreps.add(prep.id));
    syncDraftsForSelection();
    renderWorkflow();
}

function handleClearSelectedPreps() {
    state.selectedPreps.clear();
    syncDraftsForSelection();
    renderWorkflow();
}

async function submitSeedingForm(event) {
    event.preventDefault();
    if (!state.activeExperiment) return;
    const form = event.target;
    const payload = {
        name: form.querySelector('#detailName').value.trim(),
        cell_line: form.querySelector('#detailCellLine').value,
        cells_to_seed: form.querySelector('#detailCells').value,
        vessel_type: form.querySelector('#detailVessel').value,
        vessels_seeded: Number(form.querySelector('#detailVesselsSeeded').value) || 1,
        media_type: form.querySelector('#detailMedia').value,
        seeding_date: form.querySelector('#detailDate').value
    };
    try {
        await updateExperiment(state.activeExperiment.id, payload);
        await refreshActiveExperiment();
    } catch (error) {
        alert(error.message);
    }
}

async function renameExperiment() {
    if (!state.activeExperiment) return;
    const name = prompt('Rename experiment', state.activeExperiment.name || '');
    if (name === null) return;
    await updateExperiment(state.activeExperiment.id, { name });
    await refreshActiveExperiment();
    await loadExperiments();
}

async function toggleExperimentStatus() {
    if (!state.activeExperiment) return;
    const nextStatus = (state.activeExperiment.status || 'active') === 'finished' ? 'active' : 'finished';
    await updateExperiment(state.activeExperiment.id, { status: nextStatus });
    await refreshActiveExperiment();
    await loadExperiments();
}

async function removeExperiment() {
    if (!state.activeExperiment) return;
    if (!confirm('Delete this experiment and all related records?')) return;
    await deleteExperiment(state.activeExperiment.id);
    state.activeExperiment = null;
    await loadExperiments();
    showDashboard();
}

function attachEventListeners() {
    document.getElementById('createExperimentButton').addEventListener('click', () => toggleNewExperimentPanel(true));
    document.getElementById('cancelExperimentForm').addEventListener('click', () => toggleNewExperimentPanel(false));
    document.getElementById('closeExperimentPanel').addEventListener('click', () => toggleNewExperimentPanel(false));
    document.getElementById('newExperimentForm').addEventListener('submit', createExperiment);
    document.getElementById('backToDashboard').addEventListener('click', showDashboard);
    document.getElementById('seedingDetailForm').addEventListener('submit', submitSeedingForm);
    document.getElementById('renameExperiment').addEventListener('click', renameExperiment);
    document.getElementById('toggleExperimentStatus').addEventListener('click', toggleExperimentStatus);
    document.getElementById('deleteExperiment').addEventListener('click', removeExperiment);
    document.getElementById('prepForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!state.activeExperiment) return;
        const form = event.target;
        const payload = {
            transfer_name: form.querySelector('#transferName').value.trim(),
            transfer_concentration: form.querySelector('#transferConcentration').value,
            plasmid_size_bp: form.querySelector('#plasmidSize').value,
            plate_count: form.querySelector('#plateCountInput').value
        };
        try {
            await fetchJSON(api.experimentPreps(state.activeExperiment.id), {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            form.reset();
            form.querySelector('#plateCountInput').value = 1;
            await refreshActiveExperiment();
        } catch (error) {
            setPrepError(error.message);
        }
    });
    document.getElementById('selectAllPreps').addEventListener('click', handleSelectAllPreps);
    document.getElementById('clearSelectedPreps').addEventListener('click', handleClearSelectedPreps);
    document.getElementById('applyTransfectionBulk').addEventListener('click', applyTransfectionBulk);
    document.getElementById('copyTransfectionLabels').addEventListener('click', copyTransfectionLabels);
    document.getElementById('copyTransfectionTable').addEventListener('click', copyTransfectionLabelTable);
    document.getElementById('saveTransfection').addEventListener('click', saveTransfection);
    document.getElementById('applyMediaBulk').addEventListener('click', applyMediaBulk);
    document.getElementById('saveMediaChanges').addEventListener('click', saveMediaChanges);
    document.getElementById('copyHarvestTable').addEventListener('click', copyHarvestLabelTable);
    document.getElementById('saveHarvests').addEventListener('click', saveHarvests);
    document.getElementById('generateTiterSamples').addEventListener('click', generateTiterSamples);
    document.getElementById('saveTiterSetup').addEventListener('click', saveTiterSetup);
    document.getElementById('copyTiterPlanLabels').addEventListener('click', handleCopyTiterPlanLabels);
    document.getElementById('titerSaveScope').addEventListener('change', (event) => {
        state.titerSaveScope = event.target.value;
        if (state.titerSaveScope !== 'single') {
            state.titerSaveTarget = null;
        }
        renderTiterSaveControls(getSelectedPrepIds());
    });
    document.getElementById('titerSaveTarget').addEventListener('change', (event) => {
        const value = event.target.value;
        state.titerSaveTarget = value === '' ? null : Number(value);
    });
    document.getElementById('titerCellLine').addEventListener('input', (event) => {
        state.titerForm.cellLine = event.target.value;
    });
    document.getElementById('titerVessel').addEventListener('change', (event) => {
        state.titerForm.vesselType = event.target.value;
    });
    document.getElementById('selectionReagent').addEventListener('change', (event) => {
        const otherGroup = document.getElementById('selectionOtherGroup');
        const otherInput = document.getElementById('selectionOtherInput');
        if (event.target.value === 'Other') {
            otherGroup.hidden = false;
            otherInput.disabled = false;
            state.titerForm.selectionReagent = state.titerForm.selectionOther || '';
        } else {
            otherGroup.hidden = true;
            otherInput.disabled = true;
            otherInput.value = '';
            state.titerForm.selectionOther = '';
            state.titerForm.selectionReagent = event.target.value;
        }
    });
    document.getElementById('selectionOtherInput').addEventListener('input', (event) => {
        state.titerForm.selectionOther = event.target.value;
        state.titerForm.selectionReagent = event.target.value;
    });
    document.getElementById('selectionConcentration').addEventListener('input', (event) => {
        state.titerForm.selectionConcentration = event.target.value;
    });
    document.getElementById('polybreneInput').addEventListener('input', (event) => {
        state.titerForm.polybrene = event.target.value;
    });
    document.getElementById('testsCount').addEventListener('input', (event) => {
        state.titerForm.testsCount = Number(event.target.value) || 1;
    });
    document.getElementById('titerNotes').addEventListener('input', (event) => {
        state.titerForm.notes = event.target.value;
    });
    document.getElementById('mediaBulkSelect').addEventListener('change', (event) => {
        document.getElementById('mediaBulkOtherWrapper').hidden = event.target.value !== 'other';
    });
    document.getElementById('titerRunSelect').addEventListener('change', (event) => {
        state.currentRunId = Number(event.target.value);
        renderTiterResultsSection();
    });
    document.getElementById('titerResultsForm').addEventListener('submit', submitTiterResults);
    document.getElementById('copyTiterSummary').addEventListener('click', handleCopySummary);
}

async function init() {
    attachEventListeners();
    await loadExperiments();
}

document.addEventListener('DOMContentLoaded', init);

