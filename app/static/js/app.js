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

const state = {
    experiments: [],
    activeExperiment: null,
    selectedPrepId: null,
    selectedRunId: null,
    sampleDraftGenerated: false
};

const SHORTHAND_MULTIPLIERS = { K: 1e3, M: 1e6, B: 1e9 };

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

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!response.ok) {
        let message = 'Request failed';
        try {
            const payload = await response.json();
            message = payload.error || payload.details || message;
        } catch (error) {
            const text = await response.text();
            if (text) message = text;
        }
        throw new Error(message);
    }
    return response.json();
}

function isoToday() {
    return new Date().toISOString().split('T')[0];
}

function showDashboard() {
    document.getElementById('dashboardView').classList.add('active');
    document.getElementById('workflowView').classList.remove('active');
    state.activeExperiment = null;
    state.selectedPrepId = null;
    state.selectedRunId = null;
}

function showWorkflow() {
    document.getElementById('dashboardView').classList.remove('active');
    document.getElementById('workflowView').classList.add('active');
}

function toggleNewExperimentPanel(show) {
    const panel = document.getElementById('newExperimentPanel');
    panel.hidden = !show;
    if (show) {
        document.getElementById('experimentName').focus();
    }
}

function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    if (number >= 1e6) return `${(number / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return number.toLocaleString();
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

async function loadExperiments() {
    const data = await fetchJSON(api.experiments);
    state.experiments = data.experiments || [];
    renderDashboard();
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

function createExperimentCard(experiment) {
    const card = document.createElement('article');
    card.className = 'experiment-card';
    const status = experiment.status || 'active';
    const vesselsSeeded = experiment.vessels_seeded || 0;
    const prepCount = experiment.prep_count || 0;
    const progressText = vesselsSeeded ? `${prepCount}/${vesselsSeeded} preparations saved` : `${prepCount} preparations`;

    card.innerHTML = `
        <span class="status-chip">${status === 'finished' ? 'Finished' : 'Active'}</span>
        <h3>${experiment.name || 'Untitled experiment'}</h3>
        <dl>
            <dt>Cell line</dt><dd>${experiment.cell_line}</dd>
            <dt>Cells to seed</dt><dd>${formatNumber(experiment.cells_to_seed)}</dd>
            <dt>Vessel</dt><dd>${experiment.vessel_type}</dd>
            <dt>Vessels seeded</dt><dd>${vesselsSeeded || '—'}</dd>
        </dl>
        <div class="prep-progress">${progressText}</div>
    `;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const openButton = document.createElement('button');
    openButton.className = 'primary';
    openButton.type = 'button';
    openButton.textContent = 'Open';
    openButton.addEventListener('click', () => openExperimentDetail(experiment.id));
    actions.appendChild(openButton);

    const toggleButton = document.createElement('button');
    toggleButton.className = 'ghost';
    toggleButton.type = 'button';
    toggleButton.textContent = status === 'finished' ? 'Mark active' : 'Mark finished';
    toggleButton.addEventListener('click', async () => {
        await updateExperiment(experiment.id, { status: status === 'finished' ? 'active' : 'finished' });
        await loadExperiments();
    });
    actions.appendChild(toggleButton);

    card.appendChild(actions);
    return card;
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

async function createExperiment(event) {
    event.preventDefault();
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form));
    payload.cells_to_seed = parseNumericInput(payload.cells_to_seed);
    payload.vessels_seeded = payload.vessels_seeded ? Number(payload.vessels_seeded) : 1;
    payload.media_type = payload.media_type || APP_DEFAULT_MEDIA;
    payload.seeding_date = payload.seeding_date || isoToday();
    if (payload.cells_to_seed === null) {
        alert('Enter the number of cells to seed. Shorthand like 750K is supported.');
        return;
    }
    await fetchJSON(api.experiments, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    form.reset();
    toggleNewExperimentPanel(false);
    await loadExperiments();
}

async function openExperimentDetail(id) {
    const data = await fetchJSON(api.experimentDetail(id));
    state.activeExperiment = data.experiment;
    state.selectedPrepId = (state.activeExperiment.preps[0] && state.activeExperiment.preps[0].id) || null;
    state.selectedRunId = null;
    showWorkflow();
    renderExperimentDetail();
}

async function refreshActiveExperiment(selectPrepId) {
    if (!state.activeExperiment) return;
    const data = await fetchJSON(api.experimentDetail(state.activeExperiment.id));
    state.activeExperiment = data.experiment;
    if (selectPrepId) {
        state.selectedPrepId = selectPrepId;
    } else if (state.selectedPrepId && !state.activeExperiment.preps.some((prep) => prep.id === state.selectedPrepId)) {
        state.selectedPrepId = state.activeExperiment.preps[0] ? state.activeExperiment.preps[0].id : null;
    }
    if (state.selectedRunId && !getCurrentRun()) {
        state.selectedRunId = null;
    }
    renderExperimentDetail();
}

function renderExperimentDetail() {
    if (!state.activeExperiment) return;
    const experiment = state.activeExperiment;
    document.getElementById('workflowExperimentName').textContent = experiment.name || 'Untitled experiment';
    const metaParts = [
        `${experiment.cell_line}`,
        `Vessel: ${experiment.vessel_type}`,
        `Cells: ${formatNumber(experiment.cells_to_seed)}`,
        `Status: ${(experiment.status || 'active').toUpperCase()}`
    ];
    document.getElementById('workflowExperimentMeta').textContent = metaParts.join(' · ');

    const toggleButton = document.getElementById('toggleExperimentStatus');
    const status = experiment.status || 'active';
    toggleButton.textContent = status === 'finished' ? 'Mark as active' : 'Mark as finished';

    populateSeedingDetail(experiment);
    renderPrepSection();
    renderTransfectionSection();
    renderMediaSection();
    renderHarvestSection();
    renderTiterSection();
}

function populateSeedingDetail(experiment) {
    const form = document.getElementById('seedingDetailForm');
    form.dataset.id = experiment.id;
    form.elements['name'].value = experiment.name || '';
    form.elements['cell_line'].value = experiment.cell_line;
    form.elements['cells_to_seed'].value = experiment.cells_to_seed ? formatNumber(experiment.cells_to_seed) : '';
    form.elements['vessel_type'].value = experiment.vessel_type;
    form.elements['vessels_seeded'].value = experiment.vessels_seeded || 1;
    form.elements['media_type'].value = experiment.media_type || APP_DEFAULT_MEDIA;
    form.elements['seeding_date'].value = experiment.seeding_date || isoToday();

    const meta = document.getElementById('seedingMeta');
    meta.innerHTML = `
        <dt>Created</dt><dd>${formatDateTime(experiment.created_at)}</dd>
        <dt>Updated</dt><dd>${formatDateTime(experiment.updated_at)}</dd>
        <dt>Finished</dt><dd>${formatDateTime(experiment.finished_at)}</dd>
    `;
}

async function submitSeedingDetail(event) {
    event.preventDefault();
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form));
    payload.cells_to_seed = parseNumericInput(payload.cells_to_seed);
    payload.vessels_seeded = payload.vessels_seeded ? Number(payload.vessels_seeded) : 1;
    payload.media_type = payload.media_type || APP_DEFAULT_MEDIA;
    if (payload.cells_to_seed === null) {
        alert('Enter the number of cells to seed.');
        return;
    }
    await updateExperiment(state.activeExperiment.id, payload);
    await refreshActiveExperiment();
    alert('Experiment updated.');
}

function renderPrepSection() {
    const experiment = state.activeExperiment;
    const progress = document.getElementById('prepProgress');
    const vesselsSeeded = experiment.vessels_seeded || 0;
    const prepCount = experiment.preps.length;
    progress.textContent = vesselsSeeded ? `${prepCount} of ${vesselsSeeded} preparations saved` : `${prepCount} preparations saved`;

    const list = document.getElementById('prepList');
    list.innerHTML = '';

    if (!experiment.preps.length) {
        const empty = document.createElement('li');
        empty.className = 'callout muted';
        empty.textContent = 'No preparations saved yet. Add a plasmid to begin.';
        list.appendChild(empty);
    } else {
        experiment.preps.forEach((prep) => {
            const item = document.createElement('li');
            item.className = 'prep-item';
            if (prep.id === state.selectedPrepId) {
                item.classList.add('active');
            }
            const name = document.createElement('header');
            const title = document.createElement('h3');
            title.textContent = prep.transfer_name;
            const meta = document.createElement('span');
            meta.className = 'prep-meta';
            const concText = prep.transfer_concentration ? `${prep.transfer_concentration} ng/µL` : 'Concentration NA';
            meta.textContent = `${concText} · ${prep.plasmid_size_bp || 'bp NA'}`;
            name.appendChild(title);
            name.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'actions';

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'ghost';
            openBtn.textContent = 'Select';
            openBtn.addEventListener('click', () => {
                state.selectedPrepId = prep.id;
                state.selectedRunId = null;
                renderTransfectionSection();
                renderMediaSection();
                renderHarvestSection();
                renderTiterSection();
                renderPrepSection();
            });
            actions.appendChild(openBtn);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'ghost';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => editPrep(prep));
            actions.appendChild(editBtn);

            name.appendChild(actions);
            item.appendChild(name);
            if (prep.transfection) {
                const detail = document.createElement('div');
                detail.className = 'metric';
                detail.textContent = `Transfection saved · ${formatDateTime(prep.transfection.created_at)}`;
                item.appendChild(detail);
            }
            list.appendChild(item);
        });
    }
}

async function savePrep(event) {
    event.preventDefault();
    if (!state.activeExperiment) return;
    const form = event.target;
    const payload = {
        transfer_name: document.getElementById('transferName').value.trim(),
        transfer_concentration: document.getElementById('transferConcentration').value ? Number(document.getElementById('transferConcentration').value) : null,
        plasmid_size_bp: document.getElementById('plasmidSize').value ? Number(document.getElementById('plasmidSize').value) : null
    };
    if (!payload.transfer_name) {
        alert('Enter a transfer plasmid name.');
        return;
    }
    await fetchJSON(api.experimentPreps(state.activeExperiment.id), {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    form.reset();
    await refreshActiveExperiment();
}

async function editPrep(prep) {
    const newName = prompt('Transfer plasmid name', prep.transfer_name || '');
    if (newName === null) return;
    const newConc = prompt('Concentration (ng/µL)', prep.transfer_concentration != null ? prep.transfer_concentration : '');
    if (newConc === null) return;
    const newSize = prompt('Plasmid size (bp)', prep.plasmid_size_bp != null ? prep.plasmid_size_bp : '');
    const payload = {
        transfer_name: newName.trim() || prep.transfer_name,
        transfer_concentration: newConc ? Number(newConc) : null,
        plasmid_size_bp: newSize ? Number(newSize) : null
    };
    await fetchJSON(api.prep(prep.id), {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    await refreshActiveExperiment(prep.id);
}

function getSelectedPrep() {
    if (!state.activeExperiment) return null;
    return state.activeExperiment.preps.find((prep) => prep.id === state.selectedPrepId) || null;
}

function renderTransfectionSection() {
    const prep = getSelectedPrep();
    const summary = document.getElementById('transfectionSummary');
    const form = document.getElementById('transfectionForm');
    if (!prep) {
        summary.textContent = 'Select a preparation to begin.';
        summary.classList.remove('muted');
        form.hidden = true;
        return;
    }
    form.hidden = false;
    document.getElementById('transfectionVessel').value = state.activeExperiment.vessel_type;
    const transferInput = document.getElementById('transferConcentrationInput');
    transferInput.value = prep.transfer_concentration != null ? prep.transfer_concentration : '';

    const existing = prep.transfection;
    if (existing) {
        document.getElementById('ratioMode').value = existing.ratio_mode || 'optimal';
        if (existing.ratio_mode === 'custom') {
            document.getElementById('customRatio').disabled = false;
            document.getElementById('customRatio').value = existing.ratio_display || '';
        } else {
            document.getElementById('customRatio').disabled = true;
            document.getElementById('customRatio').value = '';
        }
        document.getElementById('packagingConcentrationInput').value = existing.packaging_concentration_ng_ul ?? '';
        document.getElementById('envelopeConcentrationInput').value = existing.envelope_concentration_ng_ul ?? '';
        renderTransfectionMetrics(existing);
        summary.textContent = `Last saved ${formatDateTime(existing.created_at)}`;
        summary.classList.add('muted');
    } else {
        document.getElementById('ratioMode').value = 'optimal';
        document.getElementById('customRatio').value = '';
        document.getElementById('customRatio').disabled = true;
        document.getElementById('packagingConcentrationInput').value = '';
        document.getElementById('envelopeConcentrationInput').value = '';
        document.getElementById('transfectionMetrics').innerHTML = '';
        summary.textContent = 'Scale reagents from the seeded vessel. Provide concentrations to compute pipetting volumes.';
        summary.classList.remove('muted');
        refreshTransfectionMetrics();
    }
}

function renderTransfectionMetrics(metrics) {
    const container = document.getElementById('transfectionMetrics');
    if (!metrics) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <div><strong>Opti-MEM</strong>${metrics.opti_mem_ml ?? '—'} mL</div>
        <div><strong>X-tremeGENE 9</strong>${metrics.xtremegene_ul ?? '—'} µL</div>
        <div><strong>Total DNA</strong>${metrics.total_plasmid_ug ?? '—'} µg (ratio ${metrics.ratio_display || `${metrics.transfer_ratio}:${metrics.packaging_ratio}:${metrics.envelope_ratio}`})</div>
        <div><strong>Transfer mass</strong>${metrics.transfer_mass_ug ?? '—'} µg · ${metrics.transfer_volume_ul ? `${metrics.transfer_volume_ul} µL` : 'volume NA'}</div>
        <div><strong>Packaging mass</strong>${metrics.packaging_mass_ug ?? '—'} µg · ${metrics.packaging_volume_ul ? `${metrics.packaging_volume_ul} µL` : 'volume NA'}</div>
        <div><strong>Envelope mass</strong>${metrics.envelope_mass_ug ?? '—'} µg · ${metrics.envelope_volume_ul ? `${metrics.envelope_volume_ul} µL` : 'volume NA'}</div>
    `;
}

function getRatioPayload() {
    const ratioMode = document.getElementById('ratioMode').value;
    if (ratioMode === 'custom') {
        const text = document.getElementById('customRatio').value.trim();
        if (!text) return null;
        const parts = text.split(',').map((value) => Number(value.trim()));
        if (parts.some((value) => Number.isNaN(value) || value <= 0)) return null;
        return parts;
    }
    return null;
}

async function refreshTransfectionMetrics() {
    const prep = getSelectedPrep();
    if (!prep) return;
    const ratioMode = document.getElementById('ratioMode').value;
    const ratio = getRatioPayload();
    const payload = {
        vessel_type: state.activeExperiment.vessel_type,
        ratio_mode: ratioMode
    };
    if (ratio) payload.ratio = ratio;
    const transferConc = document.getElementById('transferConcentrationInput').value;
    const packagingConc = document.getElementById('packagingConcentrationInput').value;
    const envelopeConc = document.getElementById('envelopeConcentrationInput').value;
    if (transferConc) payload.transfer_concentration_ng_ul = Number(transferConc);
    if (packagingConc) payload.packaging_concentration_ng_ul = Number(packagingConc);
    if (envelopeConc) payload.envelope_concentration_ng_ul = Number(envelopeConc);
    try {
        const metrics = await fetchJSON(api.metrics.transfection, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        renderTransfectionMetrics(metrics);
    } catch (error) {
        console.warn(error);
    }
}

async function submitTransfection(event) {
    event.preventDefault();
    const prep = getSelectedPrep();
    if (!prep) return;
    const ratioMode = document.getElementById('ratioMode').value;
    const ratio = getRatioPayload();
    if (ratioMode === 'custom' && !ratio) {
        alert('Enter a valid custom ratio using comma-separated numbers.');
        return;
    }
    const payload = {
        ratio_mode: ratioMode,
        transfer_concentration_ng_ul: document.getElementById('transferConcentrationInput').value ? Number(document.getElementById('transferConcentrationInput').value) : null,
        packaging_concentration_ng_ul: document.getElementById('packagingConcentrationInput').value ? Number(document.getElementById('packagingConcentrationInput').value) : null,
        envelope_concentration_ng_ul: document.getElementById('envelopeConcentrationInput').value ? Number(document.getElementById('envelopeConcentrationInput').value) : null
    };
    if (ratio) payload.ratio = ratio;
    await fetchJSON(api.transfection(prep.id), {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    await refreshActiveExperiment(prep.id);
    alert('Transfection saved.');
}

function renderMediaSection() {
    const prep = getSelectedPrep();
    const form = document.getElementById('mediaForm');
    const summary = document.getElementById('mediaSummary');
    if (!prep) {
        form.hidden = true;
        summary.textContent = 'Select a preparation to log media changes.';
        summary.classList.remove('muted');
        return;
    }
    form.hidden = false;
    summary.classList.add('muted');
    const mediaChange = prep.media_change;
    if (mediaChange) {
        summary.textContent = `${mediaChange.media_type} · ${mediaChange.volume_ml} mL (${formatDateTime(mediaChange.created_at)})`;
    } else {
        summary.textContent = 'No media change logged yet.';
    }
}

async function submitMediaChange(event) {
    event.preventDefault();
    const prep = getSelectedPrep();
    if (!prep) return;
    const typeSelect = document.getElementById('mediaTypeSelect');
    const selected = typeSelect.value;
    let mediaType = selected;
    if (selected === 'other') {
        mediaType = document.getElementById('mediaOtherInput').value.trim();
        if (!mediaType) {
            alert('Enter a custom media description.');
            return;
        }
    }
    const volume = document.getElementById('mediaVolume').value ? Number(document.getElementById('mediaVolume').value) : null;
    if (volume === null) {
        alert('Enter the volume used.');
        return;
    }
    await fetchJSON(api.mediaChange(prep.id), {
        method: 'POST',
        body: JSON.stringify({ media_type: mediaType, volume_ml: volume })
    });
    document.getElementById('mediaVolume').value = '';
    await refreshActiveExperiment(prep.id);
}

function handleMediaTypeChange() {
    const typeSelect = document.getElementById('mediaTypeSelect');
    const otherGroup = document.getElementById('mediaOtherGroup');
    otherGroup.hidden = typeSelect.value !== 'other';
}

function renderHarvestSection() {
    const prep = getSelectedPrep();
    const form = document.getElementById('harvestForm');
    const summary = document.getElementById('harvestSummary');
    const label = document.getElementById('harvestLabel');
    const labelText = document.getElementById('harvestLabelText');
    if (!prep) {
        form.hidden = true;
        summary.textContent = 'Select a preparation to record harvest details.';
        summary.classList.remove('muted');
        label.hidden = true;
        return;
    }
    form.hidden = false;
    summary.classList.add('muted');
    const harvest = prep.harvest;
    if (harvest) {
        const text = `${prep.transfer_name} — ${harvest.harvest_date ? formatDate(harvest.harvest_date) : formatDateTime(harvest.created_at)} — ${harvest.volume_ml ?? 'volume NA'} mL`;
        summary.textContent = text;
        labelText.textContent = text;
        label.hidden = false;
    } else {
        summary.textContent = 'No harvest recorded yet.';
        label.hidden = true;
    }
}

async function submitHarvest(event) {
    event.preventDefault();
    const prep = getSelectedPrep();
    if (!prep) return;
    const date = document.getElementById('harvestDate').value;
    const volume = document.getElementById('harvestVolume').value ? Number(document.getElementById('harvestVolume').value) : null;
    if (volume === null) {
        alert('Enter the harvest volume.');
        return;
    }
    await fetchJSON(api.harvest(prep.id), {
        method: 'POST',
        body: JSON.stringify({ harvest_date: date || null, volume_ml: volume })
    });
    await refreshActiveExperiment(prep.id);
}

async function copyHarvestLabel() {
    const text = document.getElementById('harvestLabelText').textContent;
    try {
        await navigator.clipboard.writeText(text);
        alert('Label text copied to clipboard.');
    } catch (error) {
        alert('Unable to copy label text.');
    }
}

function renderTiterSection() {
    const prep = getSelectedPrep();
    const setupForm = document.getElementById('titerSetupForm');
    const runsList = document.getElementById('titerRunsList');
    clearSampleDraft();
    if (!prep) {
        setupForm.hidden = true;
        runsList.className = 'callout muted';
        runsList.textContent = 'Select a preparation to configure titering.';
        renderTiterResults();
        return;
    }
    setupForm.hidden = false;
    runsList.className = 'prep-list';
    runsList.innerHTML = '';
    if (!prep.titer_runs || !prep.titer_runs.length) {
        const empty = document.createElement('div');
        empty.className = 'callout muted';
        empty.textContent = 'No titer runs saved yet.';
        runsList.appendChild(empty);
    } else {
        prep.titer_runs
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .forEach((run) => {
                const item = document.createElement('div');
                item.className = 'prep-item';
                if (run.id === state.selectedRunId) item.classList.add('active');
                const header = document.createElement('header');
                const title = document.createElement('h3');
                title.textContent = `${run.cell_line} · ${run.vessel_type}`;
                const meta = document.createElement('span');
                meta.className = 'prep-meta';
                meta.textContent = `${run.tests_count} tests · ${formatDateTime(run.created_at)}`;
                header.appendChild(title);
                header.appendChild(meta);
                const actions = document.createElement('div');
                actions.className = 'actions';
                const open = document.createElement('button');
                open.type = 'button';
                open.className = 'ghost';
                open.textContent = 'Open';
                open.addEventListener('click', () => {
                    state.selectedRunId = run.id;
                    renderTiterResults();
                    renderTiterSection();
                });
                actions.appendChild(open);
                header.appendChild(actions);
                item.appendChild(header);
                runsList.appendChild(item);
            });
        if (!state.selectedRunId && prep.titer_runs[0]) {
            state.selectedRunId = prep.titer_runs[0].id;
        }
    }
    renderTiterResults();
}

function buildSampleRow(label, volume = '', selectionUsed = true) {
    const row = document.createElement('div');
    row.className = 'sample-row';
    row.innerHTML = `
        <header>${label}</header>
        <label>Virus volume (µL)<input type="number" step="any" value="${volume}"></label>
        <label>Selection applied <input type="checkbox" ${selectionUsed ? 'checked' : ''}></label>
    `;
    return row;
}

function buildResultRow(sample) {
    const row = document.createElement('div');
    row.className = 'sample-row';
    row.dataset.sampleId = sample.id;
    row.innerHTML = `
        <header>${sample.label}</header>
        <label>Virus volume (µL)<input type="number" step="any" value="${sample.virus_volume_ul}" disabled></label>
        <label>Selection applied <input type="checkbox" ${sample.selection_used ? 'checked' : ''}></label>
        <label>Cell concentration (cells/mL)<input type="text" value="${sample.cell_concentration != null ? sample.cell_concentration : ''}"></label>
        <div class="metric">% survival: ${sample.measured_percent != null ? sample.measured_percent.toFixed(2) : '—'}</div>
        <div class="metric">MOI: ${sample.moi != null ? sample.moi : '—'}</div>
        <div class="metric">Titer (TU/mL): ${sample.titer_tu_ml != null ? sample.titer_tu_ml : '—'}</div>
    `;
    return row;
}

function clearSampleDraft() {
    document.getElementById('titerSamples').innerHTML = '';
    state.sampleDraftGenerated = false;
}

function handleSelectionReagentChange() {
    const selection = document.getElementById('selectionReagent');
    const other = document.getElementById('selectionOtherGroup');
    other.hidden = selection.value !== 'Other';
}

function generateSampleDraft() {
    const count = Number(document.getElementById('testsCount').value) || 1;
    const container = document.getElementById('titerSamples');
    container.innerHTML = '';
    for (let i = 1; i <= count; i += 1) {
        const row = document.createElement('div');
        row.className = 'sample-row';
        row.dataset.role = 'test';
        row.dataset.label = `Test ${i}`;
        row.innerHTML = `
            <header>Test ${i}</header>
            <label>Virus volume (µL)<input type="number" step="any" required></label>
            <label>Selection applied <input type="checkbox" checked></label>
        `;
        container.appendChild(row);
    }
    const posControl = document.createElement('div');
    posControl.className = 'sample-row';
    posControl.dataset.role = 'control-selection';
    posControl.dataset.label = 'No LV + Selection';
    posControl.innerHTML = `
        <header>No LV + Selection</header>
        <label>Virus volume (µL)<input type="number" step="any" value="0" disabled></label>
        <label>Selection applied <input type="checkbox" checked></label>
    `;
    container.appendChild(posControl);

    const negControl = document.createElement('div');
    negControl.className = 'sample-row';
    negControl.dataset.role = 'control-no-selection';
    negControl.dataset.label = 'No LV − Selection';
    negControl.innerHTML = `
        <header>No LV − Selection</header>
        <label>Virus volume (µL)<input type="number" step="any" value="0" disabled></label>
        <label>Selection applied <input type="checkbox"></label>
    `;
    container.appendChild(negControl);
    state.sampleDraftGenerated = true;
}

async function submitTiterSetup(event) {
    event.preventDefault();
    const prep = getSelectedPrep();
    if (!prep) return;
    const samplesContainer = document.getElementById('titerSamples');
    if (!state.sampleDraftGenerated || !samplesContainer.children.length) {
        alert('Generate wells before saving the plan.');
        return;
    }
    const samples = [];
    samplesContainer.querySelectorAll('.sample-row').forEach((row) => {
        const label = row.dataset.label;
        const volumeInput = row.querySelector('input[type="number"]');
        const checkbox = row.querySelector('input[type="checkbox"]');
        samples.push({
            label,
            virus_volume_ul: Number(volumeInput.value) || 0,
            selection_used: checkbox.checked
        });
    });
    const selectionValue = document.getElementById('selectionReagent').value;
    const payload = {
        cell_line: document.getElementById('titerCellLine').value.trim(),
        cells_seeded: document.getElementById('titerCellsSeeded').value.trim(),
        vessel_type: document.getElementById('titerVessel').value,
        selection_reagent: selectionValue === 'Other' ? document.getElementById('selectionOtherInput').value.trim() : selectionValue,
        selection_concentration: document.getElementById('selectionConcentration').value.trim(),
        tests_count: Number(document.getElementById('testsCount').value) || 1,
        notes: document.getElementById('titerNotes').value.trim(),
        polybrene_ug_ml: document.getElementById('polybreneInput').value ? Number(document.getElementById('polybreneInput').value) : null,
        samples,
        measurement_media_ml: null,
        control_cell_concentration: null
    };
    if (!payload.cell_line || !payload.cells_seeded) {
        alert('Provide the cell line and number of cells seeded.');
        return;
    }
    await fetchJSON(api.titerRuns(prep.id), {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    document.getElementById('titerSetupForm').reset();
    clearSampleDraft();
    await refreshActiveExperiment(prep.id);
}

function getCurrentRun() {
    const prep = getSelectedPrep();
    if (!prep || !prep.titer_runs) return null;
    return prep.titer_runs.find((run) => run.id === state.selectedRunId) || null;
}

function renderTiterResults() {
    const run = getCurrentRun();
    const panel = document.getElementById('titerResultsPanel');
    const form = document.getElementById('titerResultsForm');
    const samplesContainer = document.getElementById('resultsSamples');
    const summary = document.getElementById('titerSummary');
    const copyButton = document.getElementById('copyTiterSummary');
    if (!run) {
        panel.textContent = 'Select a titer run to record results.';
        panel.classList.remove('muted');
        form.hidden = true;
        samplesContainer.innerHTML = '';
        summary.textContent = '';
        copyButton.hidden = true;
        return;
    }
    panel.textContent = `Run created ${formatDateTime(run.created_at)} · ${run.cell_line}`;
    panel.classList.add('muted');
    form.hidden = false;
    document.getElementById('resultsMeasurementVolume').value = run.measurement_media_ml ?? '';
    document.getElementById('resultsControlConcentration').value = run.control_cell_concentration ?? '';
    samplesContainer.innerHTML = '';
    run.samples.forEach((sample) => {
        const row = buildResultRow(sample);
        samplesContainer.appendChild(row);
    });
    summary.textContent = '';
    copyButton.hidden = true;
}

async function submitTiterResults(event) {
    event.preventDefault();
    const run = getCurrentRun();
    if (!run) return;
    const measurementVolume = document.getElementById('resultsMeasurementVolume').value;
    const controlConc = document.getElementById('resultsControlConcentration').value;
    const samplesPayload = [];
    let missingConcentration = false;
    document.querySelectorAll('#resultsSamples .sample-row').forEach((row) => {
        const sampleId = Number(row.dataset.sampleId);
        const concentrationInput = row.querySelector('input[type="text"]');
        const checkbox = row.querySelector('input[type="checkbox"]');
        const value = concentrationInput.value.trim();
        if (!value) missingConcentration = true;
        samplesPayload.push({
            id: sampleId,
            cell_concentration: value,
            selection_used: checkbox.checked
        });
    });
    if (missingConcentration) {
        if (!confirm('Some samples have blank concentrations. They will be skipped in calculations. Continue?')) {
            return;
        }
    }
    const payload = {
        measurement_media_ml: measurementVolume ? Number(measurementVolume) : null,
        control_cell_concentration: controlConc,
        samples: samplesPayload
    };
    const response = await fetchJSON(api.titerResults(run.id), {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    await refreshActiveExperiment(state.selectedPrepId);
    const updatedRun = getCurrentRun();
    if (updatedRun) {
        const summary = document.getElementById('titerSummary');
        if (response.average_titer != null) {
            summary.textContent = `Average titer: ${response.average_titer.toLocaleString()} TU/mL`;
            document.getElementById('copyTiterSummary').hidden = false;
            document.getElementById('copyTiterSummary').dataset.summary = response.average_titer;
        } else {
            summary.textContent = 'Average titer unavailable. Provide concentrations for at least one sample.';
            document.getElementById('copyTiterSummary').hidden = true;
        }
    }
}

async function copyTiterSummary() {
    const run = getCurrentRun();
    const prep = getSelectedPrep();
    const average = document.getElementById('copyTiterSummary').dataset.summary;
    if (!run || !prep || !average) return;
    const text = `${prep.transfer_name} — ${new Date().toLocaleDateString()} — Lentivirus titer = ${Number(average).toLocaleString()} TU/mL`;
    try {
        await navigator.clipboard.writeText(text);
        alert('Titer summary copied to clipboard.');
    } catch (error) {
        alert('Unable to copy titer summary.');
    }
}

async function renameExperiment() {
    if (!state.activeExperiment) return;
    const name = prompt('Experiment name', state.activeExperiment.name || '');
    if (name === null) return;
    await updateExperiment(state.activeExperiment.id, { name });
    await refreshActiveExperiment();
}

async function toggleExperimentStatus() {
    if (!state.activeExperiment) return;
    const status = state.activeExperiment.status === 'finished' ? 'active' : 'finished';
    await updateExperiment(state.activeExperiment.id, { status });
    await refreshActiveExperiment();
    await loadExperiments();
}

async function deleteCurrentExperiment() {
    if (!state.activeExperiment) return;
    if (!confirm('Delete this experiment and all associated records?')) return;
    await deleteExperiment(state.activeExperiment.id);
    await loadExperiments();
    showDashboard();
}

function attachEventListeners() {
    document.getElementById('createExperimentButton').addEventListener('click', () => toggleNewExperimentPanel(true));
    document.getElementById('closeExperimentPanel').addEventListener('click', () => toggleNewExperimentPanel(false));
    document.getElementById('cancelExperimentForm').addEventListener('click', () => toggleNewExperimentPanel(false));
    document.getElementById('newExperimentForm').addEventListener('submit', createExperiment);
    document.getElementById('backToDashboard').addEventListener('click', showDashboard);
    document.getElementById('seedingDetailForm').addEventListener('submit', submitSeedingDetail);
    document.getElementById('prepForm').addEventListener('submit', savePrep);
    document.getElementById('ratioMode').addEventListener('change', (event) => {
        const custom = document.getElementById('customRatio');
        if (event.target.value === 'custom') {
            custom.disabled = false;
        } else {
            custom.disabled = true;
            custom.value = '';
        }
        refreshTransfectionMetrics();
    });
    document.getElementById('customRatio').addEventListener('input', () => {
        if (document.getElementById('ratioMode').value === 'custom') {
            refreshTransfectionMetrics();
        }
    });
    ['transferConcentrationInput', 'packagingConcentrationInput', 'envelopeConcentrationInput'].forEach((id) => {
        document.getElementById(id).addEventListener('input', () => {
            refreshTransfectionMetrics();
        });
    });
    document.getElementById('transfectionForm').addEventListener('submit', submitTransfection);
    document.getElementById('mediaForm').addEventListener('submit', submitMediaChange);
    document.getElementById('mediaTypeSelect').addEventListener('change', handleMediaTypeChange);
    document.getElementById('harvestForm').addEventListener('submit', submitHarvest);
    document.getElementById('copyHarvestLabel').addEventListener('click', copyHarvestLabel);
    document.getElementById('selectionReagent').addEventListener('change', handleSelectionReagentChange);
    document.getElementById('buildSamples').addEventListener('click', generateSampleDraft);
    document.getElementById('titerSetupForm').addEventListener('submit', submitTiterSetup);
    document.getElementById('titerResultsForm').addEventListener('submit', submitTiterResults);
    document.getElementById('copyTiterSummary').addEventListener('click', copyTiterSummary);
    document.getElementById('renameExperiment').addEventListener('click', renameExperiment);
    document.getElementById('toggleExperimentStatus').addEventListener('click', toggleExperimentStatus);
    document.getElementById('deleteExperiment').addEventListener('click', deleteCurrentExperiment);
}

window.addEventListener('DOMContentLoaded', async () => {
    attachEventListeners();
    toggleNewExperimentPanel(false);
    document.getElementById('experimentMedia').value = APP_DEFAULT_MEDIA;
    document.getElementById('detailMedia').value = APP_DEFAULT_MEDIA;
    document.getElementById('mediaTypeSelect').value = 'DMEM + 10% FBS';
    handleMediaTypeChange();
    handleSelectionReagentChange();
    document.getElementById('harvestDate').value = isoToday();
    await loadExperiments();
});
