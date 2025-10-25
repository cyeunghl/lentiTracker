const api = {
    experiments: '/api/experiments',
    preps: (experimentId) => `/api/experiments/${experimentId}/preps`,
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
    preps: [],
    titerRuns: [],
    currentExperimentId: null,
    selectedPrepId: null,
    moiChart: null
};

const DEFAULT_MEDIA_TYPE = 'DMEM + 10% FBS';
const SHORTHAND_MULTIPLIERS = { K: 1e3, M: 1e6, B: 1e9 };

function isoToday() {
    return new Date().toISOString().split('T')[0];
}

function initStepNavigation() {
    const buttons = document.querySelectorAll('.step-link');
    const panels = document.querySelectorAll('.step-panel');
    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            buttons.forEach((btn) => btn.classList.toggle('active', btn === button));
            panels.forEach((panel) => panel.classList.toggle('active', panel.id === button.dataset.target));
        });
    });
}

function fetchJSON(url, options = {}) {
    return fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    }).then(async (response) => {
        if (!response.ok) {
            const text = await response.text();
            let message = text || 'Request failed';
            try {
                const payload = JSON.parse(text);
                message = payload.error || payload.details || message;
            } catch (err) {
                // ignore parsing failures and use original text
            }
            throw new Error(message);
        }
        return response.json();
    });
}

function parseNumericInput(rawValue) {
    if (rawValue === undefined || rawValue === null) return null;
    const normalized = rawValue.toString().trim().replace(/,/g, '');
    if (!normalized) return null;
    const direct = Number(normalized);
    if (!Number.isNaN(direct)) return direct;
    const shorthand = normalized.match(/^(-?\d*\.?\d+)\s*([KMB])(?:[A-Z]*)?$/i);
    if (shorthand) {
        const [, base, suffix] = shorthand;
        return Number(base) * SHORTHAND_MULTIPLIERS[suffix.toUpperCase()];
    }
    return null;
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return date.toLocaleString();
}

function resetSeedingDefaults(force = false) {
    const form = document.getElementById('seedingForm');
    if (!form) return;
    if (force || !form.dataset.id) {
        const mediaInput = form.querySelector('[name="media_type"]');
        if (mediaInput && !mediaInput.value) {
            mediaInput.value = DEFAULT_MEDIA_TYPE;
        }
        const dateInput = form.querySelector('[name="seeding_date"]');
        if (dateInput && (!dateInput.value || force)) {
            dateInput.value = isoToday();
        }
    }
}

async function loadExperiments() {
    const data = await fetchJSON(api.experiments);
    state.experiments = data.experiments;
    renderExperimentsTable();
    if (!state.experiments.length) {
        populateExperimentSelects();
        await loadPreps(null);
        return;
    }
    if (!state.currentExperimentId && state.experiments.length) {
        state.currentExperimentId = state.experiments[0].id;
    }
    if (state.currentExperimentId && !state.experiments.some((exp) => exp.id === state.currentExperimentId)) {
        state.currentExperimentId = state.experiments[0].id;
    }
    populateExperimentSelects();
    if (state.currentExperimentId) {
        await loadPreps(state.currentExperimentId);
    }
}

function renderExperimentsTable() {
    const tbody = document.querySelector('#experimentsTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.experiments.forEach((exp) => {
        const tr = document.createElement('tr');
        tr.dataset.id = exp.id;
        tr.innerHTML = `
            <td>${exp.id}</td>
            <td>${exp.cell_line}</td>
            <td>${exp.vessel_type}</td>
            <td>${exp.cells_to_seed ? Number(exp.cells_to_seed).toLocaleString() : '—'}</td>
            <td>${exp.media_type ?? '—'}</td>
            <td>${exp.vessels_seeded ?? '—'}</td>
            <td>${formatDateTime(exp.updated_at)}</td>`;
        tr.addEventListener('dblclick', () => fillSeedingForm(exp));
        tbody.appendChild(tr);
    });
}

function populateExperimentSelects() {
    const experimentSelect = document.getElementById('prepExperimentSelect');
    if (!experimentSelect) return;
    const options = state.experiments
        .map((exp) => `<option value="${exp.id}">#${exp.id} · ${exp.cell_line}</option>`)
        .join('');
    experimentSelect.innerHTML = `<option value="">Select experiment</option>${options}`;
    if (state.currentExperimentId) {
        experimentSelect.value = state.currentExperimentId.toString();
    }
}

function fillSeedingForm(exp) {
    const form = document.getElementById('seedingForm');
    if (!form) return;
    form.dataset.id = exp.id;
    form.cell_line.value = exp.cell_line;
    form.passage_number.value = exp.passage_number ?? '';
    form.cells_to_seed.value = exp.cells_to_seed ? Number(exp.cells_to_seed).toLocaleString() : '';
    form.vessel_type.value = exp.vessel_type;
    form.media_type.value = exp.media_type ?? DEFAULT_MEDIA_TYPE;
    form.vessels_seeded.value = exp.vessels_seeded ?? 1;
    form.seeding_date.value = exp.seeding_date ?? isoToday();
}

async function handleSeedingSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form));
    payload.media_type = payload.media_type || DEFAULT_MEDIA_TYPE;
    payload.seeding_date = payload.seeding_date || isoToday();
    payload.cells_to_seed = parseNumericInput(payload.cells_to_seed);
    payload.vessels_seeded = payload.vessels_seeded ? parseInt(payload.vessels_seeded, 10) : null;
    if (payload.cells_to_seed === null || Number.isNaN(payload.cells_to_seed)) {
        alert('Enter the total cells to seed (use 750K, 1.5M, etc.).');
        return;
    }
    const method = form.dataset.id ? 'PUT' : 'POST';
    const url = form.dataset.id ? `${api.experiments}/${form.dataset.id}` : api.experiments;
    await fetchJSON(url, { method, body: JSON.stringify(payload) });
    form.reset();
    delete form.dataset.id;
    resetSeedingDefaults(true);
    await loadExperiments();
    alert(method === 'POST' ? 'Experiment saved.' : 'Experiment updated.');
}

function handleSeedingReset() {
    const form = document.getElementById('seedingForm');
    if (!form) return;
    delete form.dataset.id;
    resetSeedingDefaults(true);
}

async function loadPreps(experimentId) {
    if (!experimentId) {
        state.currentExperimentId = null;
        state.preps = [];
        state.selectedPrepId = null;
        renderPrepList();
        populatePrepDependentSelects();
        return;
    }
    state.currentExperimentId = experimentId;
    const data = await fetchJSON(api.preps(experimentId));
    state.preps = data.preps;
    state.selectedPrepId = state.preps[0]?.id ?? null;
    renderPrepList();
    populatePrepDependentSelects();
    updateHarvestPreview();
}

function renderPrepList() {
    const list = document.getElementById('prepList');
    if (!list) return;
    list.innerHTML = '';
    if (!state.preps.length) {
        list.innerHTML = '<li class="empty">No lentivirus preparations saved yet.</li>';
        return;
    }
    state.preps.forEach((prep) => {
        const li = document.createElement('li');
        li.dataset.id = prep.id;
        li.innerHTML = `
            <strong>${prep.transfer_name}</strong>
            <span>${prep.cell_line_used ?? 'HEK293FT'} · ${new Date(prep.created_at).toLocaleDateString()}</span>`;
        if (state.selectedPrepId === prep.id) {
            li.classList.add('is-selected');
        }
        li.addEventListener('click', () => {
            state.selectedPrepId = prep.id;
            document.querySelectorAll('#prepList li').forEach((item) => item.classList.toggle('is-selected', item === li));
            ['transfectionPrepSelect', 'mediaPrepSelect', 'harvestPrepSelect', 'titerPrepSelect'].forEach((id) => {
                const select = document.getElementById(id);
                if (select) {
                    select.value = prep.id;
                }
            });
            updateHarvestPreview();
        });
        list.appendChild(li);
    });
}

function populatePrepDependentSelects() {
    const hasPreps = state.preps.length > 0;
    const optionMarkup = hasPreps
        ? state.preps.map((prep) => `<option value="${prep.id}">${prep.transfer_name} · Prep #${prep.id}</option>`).join('')
        : '<option value="">No preps available</option>';
    ['transfectionPrepSelect', 'mediaPrepSelect', 'harvestPrepSelect', 'titerPrepSelect'].forEach((id) => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = optionMarkup;
        if (hasPreps) {
            select.value = state.selectedPrepId ?? state.preps[0].id;
        } else {
            select.value = '';
        }
    });
    renderMediaSummary();
    refreshTiterRuns();
}

function renderMediaSummary() {
    const board = document.getElementById('mediaSummary');
    if (!board) return;
    board.innerHTML = '';
    const entries = state.preps
        .filter((prep) => prep.media_change)
        .sort((a, b) => new Date(b.media_change.created_at) - new Date(a.media_change.created_at));
    if (!entries.length) {
        board.innerHTML = '<p>No media changes recorded yet.</p>';
        return;
    }
    entries.forEach((prep) => {
        const div = document.createElement('div');
        div.className = 'entry';
        div.innerHTML = `
            <strong>${prep.transfer_name}</strong>
            <div>${prep.media_change.media_type ?? DEFAULT_MEDIA_TYPE}</div>
            <div>${prep.media_change.volume_ml ?? '—'} mL · ${new Date(prep.media_change.created_at).toLocaleDateString()}</div>`;
        board.appendChild(div);
    });
}

function findSelectedPrep() {
    const select = document.getElementById('harvestPrepSelect');
    const prepId = parseInt(select?.value, 10) || state.selectedPrepId;
    return state.preps.find((prep) => prep.id === prepId) || null;
}

function updateHarvestPreview() {
    const preview = document.getElementById('harvestLabelPreview');
    if (!preview) return;
    const prep = findSelectedPrep();
    if (!prep) {
        preview.textContent = 'Select a prep to preview its harvest label.';
        return;
    }
    const harvest = prep.harvest || {};
    const dateInput = document.getElementById('harvestDate')?.value;
    const labelDate = dateInput || harvest.harvest_date || isoToday();
    const volumeInput = document.getElementById('harvestVolume')?.value;
    const volume = volumeInput !== '' && volumeInput !== undefined
        ? volumeInput
        : (harvest.volume_ml ?? prep.media_change?.volume_ml ?? '—');
    const cellLine = prep.cell_line_used || 'HEK293FT';
    preview.textContent = `${prep.transfer_name} — ${cellLine} — ${labelDate}\nVolume: ${volume} mL`;
}

function parseCustomRatio(value) {
    if (!value) return null;
    const parts = value.split(',').map((part) => Number(part.trim()));
    return parts.every((num) => !Number.isNaN(num) && num > 0) ? parts : null;
}

async function updateTransfectionMetrics() {
    const vessel = document.getElementById('transfectionVessel')?.value;
    if (!vessel) return;
    const mode = document.getElementById('ratioMode').value;
    const ratio = mode === 'custom' ? parseCustomRatio(document.getElementById('customRatio').value) : null;
    const payload = { vessel_type: vessel };
    if (ratio) payload.ratio = ratio;
    const data = await fetchJSON(api.metrics.transfection, { method: 'POST', body: JSON.stringify(payload) });
    const container = document.getElementById('transfectionResults');
    container.innerHTML = `
        <div class="metric-card"><span>Opti-MEM</span><strong>${data.opti_mem_ml} mL</strong></div>
        <div class="metric-card"><span>X-tremeGENE 9</span><strong>${data.xtremegene_ul} µL</strong></div>
        <div class="metric-card"><span>Total DNA</span><strong>${data.total_plasmid_ug} µg</strong></div>
        <div class="metric-card"><span>Transfer Mass</span><strong>${data.transfer_mass_ug} µg</strong></div>
        <div class="metric-card"><span>Packaging Mass</span><strong>${data.packaging_mass_ug} µg</strong></div>
        <div class="metric-card"><span>Envelope Mass</span><strong>${data.envelope_mass_ug} µg</strong></div>`;
}

async function handlePrepSubmit(event) {
    event.preventDefault();
    const experimentId = parseInt(document.getElementById('prepExperimentSelect').value, 10);
    if (!experimentId) {
        alert('Select an experiment first.');
        return;
    }
    const payload = {
        transfer_name: document.getElementById('transferName').value,
        transfer_concentration: parseFloat(document.getElementById('transferConcentration').value) || null,
        plasmid_size_bp: parseFloat(document.getElementById('plasmidSize').value) || null,
        cell_line_used: document.getElementById('productionCellLine').value || null
    };
    await fetchJSON(api.preps(experimentId), { method: 'POST', body: JSON.stringify(payload) });
    alert('Lentivirus prep saved.');
    event.target.reset();
    await loadPreps(experimentId);
}

function openPrintWindow(content) {
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>Labels</title>
        <style>
            body{font-family:'Inter',sans-serif;padding:32px;background:#f4f7ff;color:#17203a;}
            .label{border:2px solid #5a8dee;border-radius:16px;padding:20px;margin-bottom:18px;}
            h3{margin:0 0 8px;font-size:1.1rem;letter-spacing:0.08em;text-transform:uppercase;color:#3a6fdc;}
            p{margin:4px 0;font-size:0.95rem;}
        </style>
        </head><body>${content}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
}

function handlePrintPrepLabel() {
    const prep = state.preps.find((p) => p.id === state.selectedPrepId) || state.preps[0];
    if (!prep) {
        alert('Save a lentivirus prep before printing labels.');
        return;
    }
    const today = new Date().toLocaleDateString();
    const cellLine = prep.cell_line_used || 'HEK293FT';
    const markup = `<div class="label"><h3>${prep.transfer_name}</h3><p>${cellLine}</p><p>${today}</p></div>`;
    openPrintWindow(markup);
}

async function handleTransfectionSubmit(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('transfectionPrepSelect').value, 10);
    if (!prepId) return alert('Select a lentivirus prep first.');
    const mode = document.getElementById('ratioMode').value;
    const ratio = mode === 'custom' ? parseCustomRatio(document.getElementById('customRatio').value) : null;
    await fetchJSON(api.transfection(prepId), {
        method: 'POST',
        body: JSON.stringify({
            vessel_type: document.getElementById('transfectionVessel').value,
            ratio_mode: mode,
            ratio
        })
    });
    alert('Transfection saved.');
    if (state.currentExperimentId) {
        await loadPreps(state.currentExperimentId);
    }
}

async function handleMediaSubmit(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('mediaPrepSelect').value, 10);
    if (!prepId) return alert('Select a prep first.');
    const payload = {
        media_type: document.getElementById('mediaTypeSelect').value,
        volume_ml: parseFloat(document.getElementById('mediaVolume').value) || null
    };
    await fetchJSON(api.mediaChange(prepId), { method: 'POST', body: JSON.stringify(payload) });
    alert('Media change saved.');
    if (state.currentExperimentId) {
        await loadPreps(state.currentExperimentId);
    }
}

async function handleHarvestSubmit(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('harvestPrepSelect').value, 10);
    if (!prepId) return alert('Select a prep first.');
    const payload = {
        harvest_date: document.getElementById('harvestDate').value || null,
        volume_ml: parseFloat(document.getElementById('harvestVolume').value) || null
    };
    await fetchJSON(api.harvest(prepId), { method: 'POST', body: JSON.stringify(payload) });
    alert('Harvest saved.');
    if (state.currentExperimentId) {
        await loadPreps(state.currentExperimentId);
    }
}

function handlePrintHarvestLabel() {
    const prep = findSelectedPrep();
    if (!prep) return alert('Select a prep first.');
    const date = document.getElementById('harvestDate').value || new Date().toLocaleDateString();
    const volume = document.getElementById('harvestVolume').value || prep.media_change?.volume_ml || '—';
    const cellLine = prep.cell_line_used || 'HEK293FT';
    const markup = `<div class="label"><h3>${prep.transfer_name}</h3><p>${cellLine}</p><p>${date}</p><p>Volume: ${volume} mL</p></div>`;
    openPrintWindow(markup);
}

function generateTiterInputs() {
    const tests = parseInt(document.getElementById('titerConditions').value, 10) || 1;
    const container = document.getElementById('titerInputContainer');
    container.innerHTML = '';
    const controls = document.createElement('div');
    controls.className = 'titer-row';
    controls.innerHTML = '<strong>Controls</strong><div>• No LV / No Selection</div><div>• No LV / + Selection</div>';
    container.appendChild(controls);
    for (let index = 1; index <= tests; index += 1) {
        const row = document.createElement('div');
        row.className = 'titer-row';
        row.dataset.type = 'test';
        row.dataset.index = index;
        row.innerHTML = `
            <div class="titer-field"><label for="testVolume-${index}">Test ${index} Virus Volume (µL)</label>
            <input type="number" step="any" id="testVolume-${index}" required></div>
            <div class="titer-field selection-field">
                <label><input type="checkbox" id="testSelection-${index}"> Selection Applied</label>
            </div>`;
        container.appendChild(row);
    }
}

function splitSelection(selection) {
    if (!selection) return { reagent: null, concentration: null };
    const match = selection.match(/^(.*?)(\d.*)$/);
    if (match) {
        return { reagent: match[1].trim(), concentration: match[2].trim() };
    }
    return { reagent: selection.trim(), concentration: null };
}

async function handleTiterSetupSubmit(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('titerPrepSelect').value, 10);
    if (!prepId) return alert('Select a prep first.');
    const cellsSeeded = parseNumericInput(document.getElementById('titerCellsSeeded').value);
    if (cellsSeeded === null || Number.isNaN(cellsSeeded)) {
        alert('Enter the number of cells seeded per well.');
        return;
    }
    const selection = splitSelection(document.getElementById('titerSelection').value);
    const rows = document.querySelectorAll('#titerInputContainer .titer-row[data-type="test"]');
    const samples = Array.from(rows).map((row) => {
        const index = row.dataset.index;
        return {
            label: `Test ${index}`,
            virus_volume_ul: parseFloat(document.getElementById(`testVolume-${index}`).value) || 0,
            selection_used: document.getElementById(`testSelection-${index}`).checked
        };
    });
    samples.push({ label: 'Control - No Selection', virus_volume_ul: 0, selection_used: false });
    samples.push({ label: 'Control - Selection', virus_volume_ul: 0, selection_used: true });
    const payload = {
        cell_line: document.getElementById('titerCellLine').value || null,
        cells_seeded: cellsSeeded,
        vessel_type: document.getElementById('titerVessel').value,
        selection_reagent: selection.reagent,
        selection_concentration: selection.concentration,
        tests_count: rows.length || 0,
        samples
    };
    await fetchJSON(api.titerRuns(prepId), { method: 'POST', body: JSON.stringify(payload) });
    alert('Titer setup saved.');
    document.getElementById('titerSetupForm').reset();
    document.getElementById('titerInputContainer').innerHTML = '';
    await refreshTiterRuns(prepId);
}

async function refreshTiterRuns(prepId = null) {
    const select = document.getElementById('titerRunSelect');
    if (!select) return;
    const previousSelection = parseInt(select.value, 10);
    const targetPrepId = prepId || parseInt(document.getElementById('titerPrepSelect').value, 10);
    if (!targetPrepId) {
        select.innerHTML = '';
        state.titerRuns = [];
        updateMoiChart();
        document.getElementById('averageTiter').textContent = '—';
        return;
    }
    const data = await fetchJSON(api.titerRuns(targetPrepId));
    state.titerRuns = data.titer_runs;
    if (!state.titerRuns.length) {
        select.innerHTML = '';
        updateMoiChart();
        document.getElementById('averageTiter').textContent = '—';
        document.getElementById('titerResultsContainer').innerHTML = '<p>No titer runs yet.</p>';
        return;
    }
    select.innerHTML = state.titerRuns
        .map((run) => `<option value="${run.id}">Run #${run.id} · ${run.cell_line ?? run.vessel_type}</option>`)
        .join('');
    const preserved = state.titerRuns.find((run) => run.id === previousSelection) || state.titerRuns[0];
    select.value = preserved.id;
    renderTiterResultsForm();
}

function renderTiterResultsForm() {
    const select = document.getElementById('titerRunSelect');
    const runId = parseInt(select?.value, 10);
    const run = state.titerRuns.find((item) => item.id === runId);
    const container = document.getElementById('titerResultsContainer');
    if (!run) {
        container.innerHTML = '<p>Select a titer run to enter results.</p>';
        updateMoiChart();
        document.getElementById('averageTiter').textContent = '—';
        return;
    }
    const rows = run.samples
        .filter((sample) => !sample.label.startsWith('Control'))
        .map((sample) => `
            <div class="titer-row">
                <div class="titer-field">
                    <strong>${sample.label}</strong>
                    <span>${sample.virus_volume_ul} µL</span>
                </div>
                <div class="titer-field">
                    <label for="sample-${sample.id}">Measured % survival</label>
                    <input type="number" step="any" id="sample-${sample.id}" data-sample-id="${sample.id}" value="${sample.measured_percent ?? ''}">
                    <span class="field-hint">MOI: ${sample.moi ?? '—'} · Titer: ${sample.titer_tu_ml ?? '—'} TU/mL</span>
                </div>
            </div>`)
        .join('');
    container.innerHTML = rows || '<p>Run contains only controls.</p>';
    updateMoiChart(run.samples);
    updateAverageTiterDisplay(run.samples);
}

function updateMoiChart(samples = []) {
    const ctx = document.getElementById('moiChart');
    if (!ctx) return;
    const filtered = samples.filter((sample) => sample.moi != null && sample.measured_percent != null);
    const data = {
        labels: filtered.map((sample) => sample.label),
        datasets: [{
            label: '% infected',
            data: filtered.map((sample) => 100 - sample.measured_percent),
            borderColor: '#3a6fdc',
            backgroundColor: 'rgba(90, 141, 238, 0.25)',
            pointBackgroundColor: '#5a8dee',
            tension: 0.35,
            fill: true
        }]
    };
    if (state.moiChart) {
        state.moiChart.data = data;
        state.moiChart.update();
        return;
    }
    state.moiChart = new Chart(ctx, {
        type: 'line',
        data,
        options: {
            scales: {
                y: { title: { display: true, text: '% infected' } },
                x: { title: { display: true, text: 'Condition' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const sample = filtered[context.dataIndex];
                            return `MOI ${sample?.moi ?? '—'} · % infected ${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

function calculateAverageTiter(samples = []) {
    const values = samples
        .map((sample) => sample.titer_tu_ml)
        .filter((value) => typeof value === 'number' && !Number.isNaN(value));
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function updateAverageTiterDisplay(samples = []) {
    const average = calculateAverageTiter(samples);
    document.getElementById('averageTiter').textContent = average ? `${Math.round(average).toLocaleString()} TU/mL` : '—';
}

async function handleTiterResultsSubmit(event) {
    event.preventDefault();
    const runId = parseInt(document.getElementById('titerRunSelect').value, 10);
    if (!runId) return;
    const controlPercent = parseFloat(document.getElementById('controlPercent').value) || 100;
    const inputs = document.querySelectorAll('#titerResultsContainer input[data-sample-id]');
    const samples = Array.from(inputs).map((input) => ({
        id: parseInt(input.dataset.sampleId, 10),
        measured_percent: parseFloat(input.value)
    }));
    const data = await fetchJSON(api.titerResults(runId), {
        method: 'POST',
        body: JSON.stringify({ control_percent: controlPercent, samples })
    });
    updateAverageTiterDisplay(
        state.titerRuns.find((run) => run.id === runId)?.samples ?? []
    );
    await refreshTiterRuns();
    if (data.average_titer !== null && data.average_titer !== undefined) {
        document.getElementById('averageTiter').textContent = `${Math.round(data.average_titer).toLocaleString()} TU/mL`;
    }
}

function copySummaryToClipboard() {
    const runId = parseInt(document.getElementById('titerRunSelect').value, 10);
    const run = state.titerRuns.find((item) => item.id === runId);
    if (!run) return alert('Select a titer run first.');
    const prep = state.preps.find((item) => item.id === run.prep_id);
    const average = document.getElementById('averageTiter').textContent;
    const summary = `${prep?.transfer_name ?? 'Lentivirus'} — ${new Date().toLocaleDateString()} — Lentivirus titer = ${average}`;
    navigator.clipboard.writeText(summary).then(() => alert('Summary copied to clipboard.'));
}

function attachEventListeners() {
    document.getElementById('seedingForm')?.addEventListener('submit', handleSeedingSubmit);
    document.getElementById('resetSeeding')?.addEventListener('click', handleSeedingReset);
    document.getElementById('refreshExperiments')?.addEventListener('click', loadExperiments);
    document.getElementById('prepExperimentSelect')?.addEventListener('change', (event) => {
        const experimentId = parseInt(event.target.value, 10);
        if (experimentId) {
            state.currentExperimentId = experimentId;
        }
        loadPreps(experimentId || null);
    });
    document.getElementById('prepForm')?.addEventListener('submit', handlePrepSubmit);
    document.getElementById('printPrepLabel')?.addEventListener('click', handlePrintPrepLabel);
    document.getElementById('ratioMode')?.addEventListener('change', (event) => {
        const isCustom = event.target.value === 'custom';
        const customInput = document.getElementById('customRatio');
        customInput.disabled = !isCustom;
        if (!isCustom) {
            customInput.value = '';
        }
        updateTransfectionMetrics();
    });
    document.getElementById('customRatio')?.addEventListener('input', () => {
        if (document.getElementById('ratioMode').value === 'custom') {
            updateTransfectionMetrics();
        }
    });
    document.getElementById('transfectionVessel')?.addEventListener('change', updateTransfectionMetrics);
    document.getElementById('transfectionForm')?.addEventListener('submit', handleTransfectionSubmit);
    document.getElementById('mediaForm')?.addEventListener('submit', handleMediaSubmit);
    document.getElementById('harvestForm')?.addEventListener('submit', handleHarvestSubmit);
    document.getElementById('harvestPrepSelect')?.addEventListener('change', (event) => {
        state.selectedPrepId = parseInt(event.target.value, 10) || state.selectedPrepId;
        updateHarvestPreview();
    });
    document.getElementById('harvestDate')?.addEventListener('change', updateHarvestPreview);
    document.getElementById('harvestVolume')?.addEventListener('input', updateHarvestPreview);
    document.getElementById('printHarvestLabel')?.addEventListener('click', handlePrintHarvestLabel);
    document.getElementById('generateTiterInputs')?.addEventListener('click', generateTiterInputs);
    document.getElementById('titerSetupForm')?.addEventListener('submit', handleTiterSetupSubmit);
    document.getElementById('titerPrepSelect')?.addEventListener('change', () => refreshTiterRuns());
    document.getElementById('titerRunSelect')?.addEventListener('change', renderTiterResultsForm);
    document.getElementById('titerResultsForm')?.addEventListener('submit', handleTiterResultsSubmit);
    document.getElementById('copySummary')?.addEventListener('click', copySummaryToClipboard);
}

document.addEventListener('DOMContentLoaded', async () => {
    initStepNavigation();
    attachEventListeners();
    resetSeedingDefaults(true);
    await loadExperiments();
    updateTransfectionMetrics();
    updateHarvestPreview();
});
