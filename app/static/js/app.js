const api = {
    experiments: '/api/experiments',
    experimentDetail: (id) => `/api/experiments/${id}`,
    experimentExport: (id) => `/api/experiments/${id}/export`,
    experimentPreps: (id) => `/api/experiments/${id}/preps`,
    prep: (id) => `/api/preps/${id}`,
    preps: (experimentId) => `/api/experiments/${experimentId}/preps`,

    transfection: (prepId) => `/api/preps/${prepId}/transfection`,
    mediaChange: (prepId) => `/api/preps/${prepId}/media-change`,
    harvest: (prepId) => `/api/preps/${prepId}/harvest`,
    titerRuns: (prepId) => `/api/preps/${prepId}/titer-runs`,
    titerRun: (runId) => `/api/titer-runs/${runId}`,
    titerResults: (runId) => `/api/titer-runs/${runId}/results`,
    metrics: {
        seeding: '/api/metrics/seeding',

        transfection: '/api/metrics/transfection'
    }
};

let experiments = [];
let preps = [];
let titerRuns = [];
let currentExperimentId = null;
let selectedPrepForLabels = null;
let moiChart;

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
        headers: {'Content-Type': 'application/json'},
        ...options
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Request failed');
    }
    return response.json();
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
    currentRunId: null,
    titerEditingRunId: null,
    titerRunDraft: new Map()
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

function formatVolume(value, digits = 2) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const fixed = number.toFixed(digits);
    if (!fixed.includes('.')) return fixed;
    return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0*$/, '');
}

function joinLabelParts(parts) {
    return parts
        .map((part) => (part ?? '').toString().trim())
        .filter((part) => part.length > 0)
        .join(' - ');
}

function toAsciiString(value) {
    if (value === null || value === undefined) return '';
    const text = value.toString();
    const base = typeof text.normalize === 'function' ? text.normalize('NFKD') : text;
    const normalized = base
        .replace(/[µμ]/g, 'u')
        .replace(/[–—]/g, '-');
    let result = '';
    for (let i = 0; i < normalized.length; i += 1) {
        const code = normalized.charCodeAt(i);
        if (code >= 32 && code <= 126) {
            result += normalized[i];
        } else if (code === 10 || code === 13) {
            result += ' ';
        }
    }
    return result;
}

function escapeCsvValue(value) {
    const ascii = toAsciiString(value);
    const needsQuotes = /[",\r\n]/.test(ascii);
    const escaped = ascii.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
}

function buildSafeFilenameBase(name, fallback) {
    const ascii = toAsciiString(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return ascii || fallback;
}

function downloadCsvFile(filename, rows) {
    if (!rows.length) return;
    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=us-ascii' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
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
    return date.toLocaleString();
}

function updateSeedingVolume() {
    const vessel = document.getElementById('seedingVesselSelect').value;
    const cells = parseFloat(document.querySelector('[name="cells_to_seed"]').value) || null;
    fetchJSON(api.metrics.seeding, {
        method: 'POST',
        body: JSON.stringify({ vessel_type: vessel, target_cells: cells })
    }).then(data => {
        document.getElementById('seedingVolume').value = data.seeding_volume_ml;
    }).catch(console.error);
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
    experiments = data.experiments;
    const tbody = document.querySelector('#experimentsTable tbody');
    tbody.innerHTML = '';
    experiments.forEach(exp => {
        const tr = document.createElement('tr');
        tr.dataset.id = exp.id;
        tr.innerHTML = `
            <td>${exp.id}</td>
            <td>${exp.cell_line}</td>
            <td>${exp.vessel_type}</td>
            <td>${(exp.seeding_volume_ml ?? '—')}</td>
            <td>${exp.media_type ?? '—'}</td>
            <td>${exp.vessels_seeded ?? '—'}</td>
            <td>${formatDateTime(exp.updated_at)}</td>
        `;
        tr.addEventListener('dblclick', () => fillSeedingForm(exp));
        tbody.appendChild(tr);
    });
    populateExperimentSelects();
    const prepSelect = document.getElementById('prepExperimentSelect');
    if (prepSelect) {
        const targetId = currentExperimentId || experiments[0]?.id;
        prepSelect.value = targetId ? targetId.toString() : '';
    }
}

function populateExperimentSelects() {
    const options = experiments.map(exp => `<option value="${exp.id}">#${exp.id} — ${exp.cell_line}</option>`).join('');
    document.getElementById('prepExperimentSelect').innerHTML = `<option value="">Select Experiment</option>${options}`;
    ['mediaPrepSelect', 'harvestPrepSelect', 'titerPrepSelect'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = options;
    });
}

function fillSeedingForm(exp) {
    const form = document.getElementById('seedingForm');
    form.dataset.id = exp.id;
    form.cell_line.value = exp.cell_line;
    form.passage_number.value = exp.passage_number ?? '';
    form.cell_concentration.value = exp.cell_concentration ?? '';
    form.cells_to_seed.value = exp.cells_to_seed ?? '';
    form.vessel_type.value = exp.vessel_type;
    form.seeding_volume_ml.value = exp.seeding_volume_ml ?? '';
    form.media_type.value = exp.media_type ?? '';
    form.vessels_seeded.value = exp.vessels_seeded ?? '';
    form.seeding_date.value = exp.seeding_date ?? '';
}

async function submitSeedingForm(event) {
    event.preventDefault();
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form));
    payload.cell_concentration = payload.cell_concentration ? parseFloat(payload.cell_concentration) : null;
    payload.cells_to_seed = payload.cells_to_seed ? parseFloat(payload.cells_to_seed) : null;
    payload.seeding_volume_ml = payload.seeding_volume_ml ? parseFloat(payload.seeding_volume_ml) : null;
    payload.vessels_seeded = payload.vessels_seeded ? parseInt(payload.vessels_seeded, 10) : null;
    const method = form.dataset.id ? 'PUT' : 'POST';
    const url = form.dataset.id ? `${api.experiments}/${form.dataset.id}` : api.experiments;
    await fetchJSON(url, { method, body: JSON.stringify(payload) });
    form.reset();
    delete form.dataset.id;
    updateSeedingVolume();
    await loadExperiments();
}

async function loadPreps(experimentId) {
    currentExperimentId = experimentId || null;
    if (!experimentId) {
        preps = [];
        renderPreps();
        populatePrepSelects();
        return;
    }
    const data = await fetchJSON(api.preps(experimentId));
    preps = data.preps;
    renderPreps();
    populatePrepSelects();
}

function renderPreps() {
    const list = document.getElementById('prepList');
    list.innerHTML = '';
    preps.forEach(prep => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        const createdDate = new Date(prep.created_at).toLocaleDateString();
        li.innerHTML = `
            <div>
                <div class="fw-semibold">${prep.transfer_name}</div>
                <small class="text-muted">${prep.cell_line_used ?? '—'} · ${createdDate}</small>
            </div>
            <span class="badge text-bg-primary rounded-pill">Prep #${prep.id}</span>
        `;
        li.addEventListener('click', () => {
            selectedPrepForLabels = prep.id;
            updateLabelPreview(prep);
        });
        list.appendChild(li);
    });
    if (preps.length) {
        selectedPrepForLabels = preps[0].id;
        updateLabelPreview(preps[0]);
    } else {
        selectedPrepForLabels = null;
        updateLabelPreview();
    }
}

function populatePrepSelects() {
    const hasPreps = preps.length > 0;
    const options = hasPreps
        ? preps.map(prep => `<option value="${prep.id}">${prep.transfer_name} (Prep #${prep.id})</option>`).join('')
        : '<option value="">No preps saved</option>';
    ['transfectionPrepSelect', 'mediaPrepSelect', 'harvestPrepSelect', 'titerPrepSelect'].forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        select.innerHTML = options;
        if (hasPreps) {
            select.value = preps[0].id;
        } else {
            select.value = '';
        }
    });
    refreshTiterRunSelect(preps[0]?.id);
}

function updateLabelPreview(prep = null) {
    const preview = document.getElementById('labelPreview');
    if (!prep) {
        preview.innerHTML = 'Select a prep to preview labels.';
        return;
    }
    const today = new Date().toLocaleDateString();
    const cellLine = prep.cell_line_used || 'HEK293FT';
    preview.innerHTML = `
        <div class="label-item">${prep.transfer_name} - ${cellLine} - ${today}</div>
        <div class="label-item">Volume: ${(prep.media_change?.volume_ml ?? '—')} mL</div>
    `;
}

function openPrintWindow(content) {
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>Labels</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
        <style>body{padding:24px;font-family:'Segoe UI',sans-serif;text-transform:uppercase}</style>
        </head><body>${content}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
}

function handlePrintPrepLabel() {
    const prep = preps.find(p => p.id === selectedPrepForLabels) || preps[0];
    if (!prep) {
        alert('Select a saved prep to print labels.');
        return;
    }
    const cellLine = prep.cell_line_used || 'HEK293FT';
    const label = `<div class="mb-3">${prep.transfer_name} - ${cellLine} - ${new Date().toLocaleDateString()}</div>`;
    openPrintWindow(label.repeat(4));
}

function handlePrintHarvestLabel() {
    const prepId = parseInt(document.getElementById('harvestPrepSelect').value, 10);
    const prep = preps.find(p => p.id === prepId);
    if (!prep) {
        alert('Select a prep first.');
        return;
    }
    const volume = prep.media_change?.volume_ml ?? document.getElementById('harvestVolume').value || '—';
    const date = document.getElementById('harvestDate').value || new Date().toLocaleDateString();
    const label = `
        <div class="mb-3">
            <div>${prep.transfer_name}</div>
            <div>${date}</div>
            <div>Volume: ${volume} mL</div>
        </div>
    `;
    openPrintWindow(label.repeat(3));
}

async function submitPrepForm(event) {
    event.preventDefault();
    const experimentId = parseInt(document.getElementById('prepExperimentSelect').value, 10);
    if (!experimentId) {
        alert('Select an experiment first.');
        return;
    }
    const payload = {
        transfer_name: document.getElementById('transferName').value,
        transfer_concentration: parseFloat(document.getElementById('transferConcentration').value) || null,
        plasmid_size_bp: parseInt(document.getElementById('plasmidSize').value, 10) || null,
        cell_line_used: document.getElementById('productionCellLine').value || null
    };
    await fetchJSON(api.preps(experimentId), { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('prepForm').reset();
    await loadPreps(experimentId);
}

function parseCustomRatio(value) {
    return value.split(',').map(v => parseFloat(v.trim())).filter(Boolean);
}

async function updateTransfectionMetrics() {
    const vessel = document.getElementById('transfectionVessel').value;
    const mode = document.getElementById('ratioMode').value;
    const ratio = mode === 'custom' ? parseCustomRatio(document.getElementById('customRatio').value) : null;
    if (mode === 'custom' && ratio.length !== 3) {
        document.getElementById('transfectionResults').innerHTML = '<p class="text-muted">Enter a custom ratio (e.g. 5,3,1).</p>';
        return;
    }
    const data = await fetchJSON(api.metrics.transfection, {
        method: 'POST',
        body: JSON.stringify({ vessel_type: vessel, ratio_mode: mode, ratio })
    });
    document.getElementById('transfectionResults').innerHTML = `
        <div class="col-md-6">
            <div class="border rounded p-3 h-100">
                <h6>Scaled Reagents</h6>
                <ul class="list-unstyled mb-0">
                    <li>Opti-MEM: <strong>${data.opti_mem_ml} mL</strong></li>
                    <li>X-tremeGENE 9: <strong>${data.xtremegene_ul} µL</strong></li>
                    <li>Total DNA: <strong>${data.total_plasmid_ug} µg</strong></li>
                </ul>
            </div>
        </div>
        <div class="col-md-6">
            <div class="border rounded p-3 h-100">
                <h6>DNA Distribution</h6>
                <ul class="list-unstyled mb-0">
                    <li>Transfer: <strong>${data.transfer_mass_ug} µg</strong></li>
                    <li>Packaging: <strong>${data.packaging_mass_ug} µg</strong></li>
                    <li>Envelope: <strong>${data.envelope_mass_ug} µg</strong></li>
                </ul>
            </div>
        </div>
    `;
}

async function submitTransfectionForm(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('transfectionPrepSelect').value, 10);
    if (!prepId) {
        alert('Select a lentivirus prep first.');
        return;
    }
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
    if (currentExperimentId) {
        await loadPreps(currentExperimentId);
    }
}

async function submitMediaForm(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('mediaPrepSelect').value, 10);
    if (!prepId) return alert('Select a prep first.');
    const payload = {
        media_type: document.getElementById('mediaType').value,
        volume_ml: parseFloat(document.getElementById('mediaVolume').value)
    };
    await fetchJSON(api.mediaChange(prepId), { method: 'POST', body: JSON.stringify(payload) });
    alert('Media change saved.');
    if (currentExperimentId) {
        await loadPreps(currentExperimentId);
    }
}

async function submitHarvestForm(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('harvestPrepSelect').value, 10);
    if (!prepId) return alert('Select a prep first.');
    const payload = {
        harvest_date: document.getElementById('harvestDate').value || null,
        volume_ml: parseFloat(document.getElementById('harvestVolume').value) || null
    };
    await fetchJSON(api.harvest(prepId), { method: 'POST', body: JSON.stringify(payload) });
    alert('Harvest saved.');
    if (currentExperimentId) {
        await loadPreps(currentExperimentId);
    }
}

function generateTiterInputs() {
    const container = document.getElementById('titerSamplesContainer');
    const tests = parseInt(document.getElementById('titerTests').value, 10) || 1;
    let content = '<div class="row g-2">';
    content += `
        <div class="col-md-6">
            <div class="border rounded p-3 h-100">
                <h6>Control Wells</h6>
                <p class="mb-1">No LV / No Selection</p>
                <p class="mb-0">No LV / + Selection</p>
            </div>
        </div>`;
    content += '<div class="col-md-6"><div class="border rounded p-3 h-100">';
    content += '<h6>Test Conditions</h6>';
    for (let i = 1; i <= tests; i++) {
        content += `
            <div class="mb-2">
                <label class="form-label">Test ${i} Virus Volume (µL)</label>
                <input type="number" step="any" class="form-control" name="test_volume_${i}" required>
                <div class="form-check mt-1">
                    <input class="form-check-input" type="checkbox" name="test_selection_${i}" id="test_selection_${i}">
                    <label class="form-check-label" for="test_selection_${i}">Selection Applied</label>
                </div>
            </div>`;
    }
    content += '</div></div></div>';
    container.innerHTML = content;
}

async function submitTiterSetup(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('titerPrepSelect').value, 10);
    if (!prepId) return alert('Select a prep first.');
    const tests = parseInt(document.getElementById('titerTests').value, 10) || 1;
    const samples = [];
    for (let i = 1; i <= tests; i++) {
        samples.push({
            label: `Test ${i}`,
            virus_volume_ul: parseFloat(document.querySelector(`[name="test_volume_${i}"]`).value) || 0,
            selection_used: document.getElementById(`test_selection_${i}`).checked
        });
    }
    samples.push({ label: 'Control - No Selection', virus_volume_ul: 0, selection_used: false });
    samples.push({ label: 'Control - Selection', virus_volume_ul: 0, selection_used: true });
    const payload = {
        cell_line: document.getElementById('titerCellLine').value,
        cells_seeded: parseFloat(document.getElementById('titerCellsSeeded').value),
        vessel_type: document.getElementById('titerVessel').value,
        selection_reagent: document.getElementById('selectionReagent').value || null,
        selection_concentration: document.getElementById('selectionConcentration').value || null,
        tests_count: tests,
        samples
    };
    await fetchJSON(api.titerRuns(prepId), { method: 'POST', body: JSON.stringify(payload) });
    alert('Titer setup saved.');
    await refreshTiterRunSelect(prepId);
    document.getElementById('titerSetupForm').reset();
    document.getElementById('titerSamplesContainer').innerHTML = '';
}

async function refreshTiterRunSelect(prepId = null) {
    const select = document.getElementById('titerRunSelect');
    if (!select) return;
    const previousSelection = parseInt(select.value, 10);
    const targetPrepId = prepId || parseInt(document.getElementById('titerPrepSelect').value, 10) || selectedPrepForLabels;
    if (!targetPrepId) {
        select.innerHTML = '';
        titerRuns = [];
        document.getElementById('averageTiter').textContent = '—';
        return;
    }
    const data = await fetchJSON(api.titerRuns(targetPrepId));
    titerRuns = data.titer_runs;
    select.innerHTML = titerRuns.map(run => `<option value="${run.id}">Run #${run.id} · ${run.cell_line}</option>`).join('');
    if (titerRuns.length) {
        const match = titerRuns.find(run => run.id === previousSelection);
        select.value = (match ? match.id : titerRuns[0].id).toString();
    }
    renderTiterResultsForm();
}

function renderTiterResultsForm() {
    const select = document.getElementById('titerRunSelect');
    const runId = parseInt(select.value, 10);
    const run = titerRuns.find(r => r.id === runId);
    const container = document.getElementById('titerResultsContainer');
    if (!run) {
        container.innerHTML = '<p class="text-muted">Select a titer run to enter results.</p>';
        document.getElementById('averageTiter').textContent = '—';
        return;
    }
    let content = '';
    run.samples.forEach(sample => {
        if (sample.label.startsWith('Control')) return;
        content += `
            <div class="border rounded p-3 mb-2">
                <div class="d-flex justify-content-between align-items-center">
                    <strong>${sample.label}</strong>
                    <span class="badge text-bg-secondary badge-sample">${sample.virus_volume_ul} µL</span>
                </div>
                <label class="form-label mt-2">Measured % Survival</label>
                <input type="number" class="form-control" data-sample-id="${sample.id}" value="${sample.measured_percent ?? ''}">
                <div class="small text-muted mt-1">MOI: ${sample.moi ?? '—'} | Titer: ${sample.titer_tu_ml ?? '—'} TU/mL</div>
            </div>`;
    });
    container.innerHTML = content;
    updateMoiChart(run.samples);
    updateAverageTiterDisplay(run.samples);
}

function updateMoiChart(samples = []) {
    const ctx = document.getElementById('moiChart');
    const filtered = samples.filter(s => s.moi != null && s.measured_percent != null);
    const labels = filtered.map(s => s.label);
    const data = {
        labels,
        datasets: [{
            label: '% Infected',
            data: filtered.map(s => 100 - s.measured_percent),
            borderColor: '#0d6efd',
            backgroundColor: 'rgba(13,110,253,0.2)',
            tension: 0.3,
            fill: true
        }]
    };
    if (moiChart) {
        moiChart.data = data;
        moiChart.update();
    } else {
        moiChart = new Chart(ctx, {
            type: 'line',
            data,
            options: {
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: context => `MOI ${filtered[context.dataIndex].moi ?? '—'} · % infected ${context.parsed.y.toFixed(2)}`
                        }
                    }
                },
                scales: {
                    y: {
                        title: { display: true, text: '% Infected' }
                    }
                }
            }
        });
    }
}

function calculateAverageTiter(samples = []) {
    const values = samples
        .map(sample => sample.titer_tu_ml)
        .filter(value => typeof value === 'number' && !Number.isNaN(value));
    if (!values.length) {
        return null;
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
}

function updateAverageTiterDisplay(samples) {
    const average = calculateAverageTiter(samples);
    const element = document.getElementById('averageTiter');
    element.textContent = average ? `${Math.round(average).toLocaleString()} TU/mL` : '—';
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

    if (status === 'finished') {
        const exportButton = document.createElement('button');
        exportButton.type = 'button';
        exportButton.className = 'ghost';
        exportButton.textContent = 'Export CSV';
        exportButton.addEventListener('click', () => exportExperimentCsv(experiment.id, experiment.name));
        actions.appendChild(exportButton);
    }

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

async function exportExperimentCsv(id, name) {
    try {
        const response = await fetch(api.experimentExport(id));
        if (!response.ok) {
            throw new Error('Unable to export experiment data.');
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const safeName = (name || 'experiment')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || `experiment-${id}`;
        link.download = `${safeName}-lentivirus.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        alert(error.message || 'Unable to export experiment data.');
    }
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
        const rows = [
            { label: 'Opti-MEM', value: formatVolume(m.opti_mem_ml, 3), unit: 'mL' },
            { label: 'X-tremeGENE 9', value: formatVolume(m.xtremegene_ul, 2), unit: 'µL' },
            { label: 'Transfer DNA', value: formatVolume(m.transfer_volume_ul, 2), unit: 'µL' },
            { label: 'Packaging DNA', value: formatVolume(m.packaging_volume_ul, 2), unit: 'µL' },
            { label: 'Envelope DNA', value: formatVolume(m.envelope_volume_ul, 2), unit: 'µL' }
        ];
        const table = document.createElement('table');
        table.className = 'metrics-table';
        const tbody = document.createElement('tbody');
        rows.forEach((row) => {
            const tr = document.createElement('tr');
            const nameCell = document.createElement('th');
            nameCell.scope = 'row';
            nameCell.textContent = row.label;
            tr.appendChild(nameCell);
            const valueCell = document.createElement('td');
            valueCell.textContent = row.value != null ? `${row.value} ${row.unit}` : '—';
            tr.appendChild(valueCell);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        metricsCell.appendChild(table);
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
        const text = joinLabelParts([
            prep.transfer_name,
            state.activeExperiment?.cell_line,
            isoToday()
        ]);
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
            return joinLabelParts([
                prep.transfer_name,
                state.activeExperiment?.cell_line,
                isoToday()
            ]);
        })
        .filter(Boolean)
        .join('\n');
    if (text) {
        copyToClipboard(button, text);
    }
}

function exportTransfectionCsv() {
    const selected = getSelectedPrepIds();
    if (!selected.length) return;
    const header = [
        'Preparation',
        'Vessel',
        'Molar ratio',
        'Transfer (ng/uL)',
        'Packaging (ng/uL)',
        'Envelope (ng/uL)',
        'Opti-MEM (mL)',
        'X-tremeGENE 9 (uL)',
        'Transfer DNA (uL)',
        'Packaging DNA (uL)',
        'Envelope DNA (uL)'
    ];
    const rows = [header];
    selected.forEach((id) => {
        const prep = getPrepById(id);
        if (!prep) return;
        const draft = state.transfectionDraft.get(id) || null;
        const metrics = draft?.metrics || null;
        const ratioDisplay = draft?.ratioMode || prep.transfection?.ratio_display || '4:3:1';
        const transferConc = draft?.transferConcentration ?? prep.transfer_concentration ?? '';
        const packagingConc = draft?.packagingConcentration ?? '';
        const envelopeConc = draft?.envelopeConcentration ?? '';
        const optiMem = metrics ? formatVolume(metrics.opti_mem_ml, 3) : '';
        const xtremegene = metrics ? formatVolume(metrics.xtremegene_ul, 2) : '';
        const transferVol = metrics ? formatVolume(metrics.transfer_volume_ul, 2) : '';
        const packagingVol = metrics ? formatVolume(metrics.packaging_volume_ul, 2) : '';
        const envelopeVol = metrics ? formatVolume(metrics.envelope_volume_ul, 2) : '';
        rows.push([
            prep.transfer_name || '',
            prep.vessel_type || '',
            ratioDisplay || '',
            transferConc || '',
            packagingConc || '',
            envelopeConc || '',
            optiMem || '',
            xtremegene || '',
            transferVol || '',
            packagingVol || '',
            envelopeVol || ''
        ]);
    });
    if (rows.length === 1) return;
    const experiment = state.activeExperiment;
    let base;
    if (experiment) {
        const fallback = `experiment-${experiment.id || 'transfection'}`;
        base = buildSafeFilenameBase(experiment.name || '', fallback);
        if (!base.endsWith('-transfection')) {
            base = `${base}-transfection`;
        }
    } else {
        base = 'transfection';
    }
    const filename = `${base}.csv`;
    downloadCsvFile(filename, rows);
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
        const volumeRaw = draft.volume || prep.harvest?.volume_ml || prep.media_change?.volume_ml;
        const volumeLabel = volumeRaw !== undefined && volumeRaw !== null && String(volumeRaw).trim() !== ''
            ? `${String(volumeRaw).trim()} mL`
            : null;
        const text = joinLabelParts([
            prep.transfer_name,
            dateInput.value || isoToday(),
            volumeLabel
        ]);
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

function copyHarvestLabels() {
    const button = document.getElementById('copyHarvestLabels');
    const selected = getSelectedPrepIds();
    if (!selected.length || !button) return;
    const text = selected
        .map((id) => {
            const prep = getPrepById(id);
            if (!prep) return null;
            const draft = state.harvestDraft.get(id);
            const date = (draft && draft.date) || prep.harvest?.harvest_date || isoToday();
            const volumeRaw = (draft && draft.volume) || prep.harvest?.volume_ml || prep.media_change?.volume_ml;
            const trimmedVolume = volumeRaw !== undefined && volumeRaw !== null && String(volumeRaw).trim() !== ''
                ? `${String(volumeRaw).trim()} mL`
                : null;
            return joinLabelParts([
                prep.transfer_name,
                date,
                trimmedVolume
            ]);
        })
        .filter(Boolean)
        .join('\n');
    if (text) {
        copyToClipboard(button, text);
    }
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
        label: 'No LV - Selection',
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

function startTiterRunEdit(entry) {
    state.titerEditingRunId = entry.id;
    state.titerRunDraft = new Map(
        entry.data.samples.map((sample) => [
            sample.id,
            {
                virusVolumeUl:
                    sample.virus_volume_ul != null ? String(sample.virus_volume_ul) : '',
                selectionUsed: !!sample.selection_used,
            },
        ])
    );
    renderTiterRunsList();
}

function cancelTiterRunEdit() {
    state.titerEditingRunId = null;
    state.titerRunDraft = new Map();
    renderTiterRunsList();
}

function updateTiterRunDraft(sampleId, updates) {
    const current = state.titerRunDraft.get(sampleId) || {
        virusVolumeUl: '',
        selectionUsed: false,
    };
    state.titerRunDraft.set(sampleId, { ...current, ...updates });
}

async function saveTiterRunEdits(entry) {
    const samplesPayload = [];
    for (const sample of entry.data.samples) {
        const draft = state.titerRunDraft.get(sample.id);
        const rawVolume = draft ? draft.virusVolumeUl : sample.virus_volume_ul;
        const parsedVolume =
            rawVolume === '' || rawVolume === null || rawVolume === undefined
                ? Number.NaN
                : Number(rawVolume);
        if (!Number.isFinite(parsedVolume)) {
            alert(`Enter a virus volume for ${sample.label}.`);
            return;
        }
        samplesPayload.push({
            id: sample.id,
            virus_volume_ul: parsedVolume,
            selection_used: draft ? !!draft.selectionUsed : !!sample.selection_used,
        });
    }

    try {
        await fetchJSON(api.titerRun(entry.id), {
            method: 'PUT',
            body: JSON.stringify({ samples: samplesPayload }),
        });
        state.titerEditingRunId = null;
        state.titerRunDraft = new Map();
        await refreshActiveExperiment(entry.prepId);
    } catch (error) {
        alert(error.message || 'Unable to save titer run.');
    }
}

async function deleteTiterRun(entry) {
    if (!confirm('Delete this titer run? Samples and results will be removed.')) return;
    state.titerEditingRunId = null;
    state.titerRunDraft = new Map();
    try {
        await fetchJSON(api.titerRun(entry.id), { method: 'DELETE' });
        if (state.currentRunId === entry.id) {
            state.currentRunId = null;
        }
        await refreshActiveExperiment(entry.prepId);
    } catch (error) {
        alert(error.message || 'Unable to delete titer run.');
        renderTiterRunsList();
    }
}

function renderTiterRunsList() {
    const container = document.getElementById('titerRunsContainer');
    const runs = collectAllRuns();
    if (!runs.length) {
        container.hidden = true;
        container.innerHTML = '';
        state.titerEditingRunId = null;
        state.titerRunDraft = new Map();
        return;
    }

    if (
        state.titerEditingRunId &&
        !runs.some((entry) => entry.id === state.titerEditingRunId)
    ) {
        state.titerEditingRunId = null;
        state.titerRunDraft = new Map();
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
        header.innerHTML = `<strong>${group.prepName}</strong><span class="muted">${group.runs.length} run${
            group.runs.length === 1 ? '' : 's'
        }</span>`;
        section.appendChild(header);

        const list = document.createElement('div');
        list.className = 'run-list';

        group.runs
            .sort((a, b) => new Date(b.data.created_at) - new Date(a.data.created_at))
            .forEach((entry) => {
                const runItem = document.createElement('div');
                runItem.className = 'run-entry';

                const rowHeader = document.createElement('div');
                rowHeader.className = 'run-entry-header';

                const selectButton = document.createElement('button');
                selectButton.type = 'button';
                selectButton.className = 'ghost small run-select';
                if (entry.id === state.currentRunId) selectButton.classList.add('active');
                selectButton.textContent = formatDateTime(entry.data.created_at);
                selectButton.addEventListener('click', () => {
                    state.currentRunId = entry.id;
                    renderTiterResultsSection();
                    renderTiterRunsList();
                });
                rowHeader.appendChild(selectButton);

                const controls = document.createElement('div');
                controls.className = 'run-entry-controls';

                if (state.titerEditingRunId === entry.id) {
                    const saveButton = document.createElement('button');
                    saveButton.type = 'button';
                    saveButton.className = 'primary small';
                    saveButton.textContent = 'Save';
                    saveButton.addEventListener('click', () => saveTiterRunEdits(entry));
                    controls.appendChild(saveButton);

                    const cancelButton = document.createElement('button');
                    cancelButton.type = 'button';
                    cancelButton.className = 'ghost small';
                    cancelButton.textContent = 'Cancel';
                    cancelButton.addEventListener('click', cancelTiterRunEdit);
                    controls.appendChild(cancelButton);
                } else {
                    const editButton = document.createElement('button');
                    editButton.type = 'button';
                    editButton.className = 'ghost small';
                    editButton.textContent = 'Edit';
                    editButton.addEventListener('click', () => startTiterRunEdit(entry));
                    controls.appendChild(editButton);
                }

                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'ghost small danger';
                deleteButton.textContent = 'Delete';
                deleteButton.addEventListener('click', () => deleteTiterRun(entry));
                controls.appendChild(deleteButton);

                rowHeader.appendChild(controls);
                runItem.appendChild(rowHeader);

                if (state.titerEditingRunId === entry.id) {
                    const editor = document.createElement('div');
                    editor.className = 'run-entry-editor';

                    entry.data.samples.forEach((sample) => {
                        if (!state.titerRunDraft.has(sample.id)) {
                            state.titerRunDraft.set(sample.id, {
                                virusVolumeUl:
                                    sample.virus_volume_ul != null
                                        ? String(sample.virus_volume_ul)
                                        : '',
                                selectionUsed: !!sample.selection_used,
                            });
                        }
                        const sampleDraft = state.titerRunDraft.get(sample.id);

                        const sampleRow = document.createElement('div');
                        sampleRow.className = 'run-sample-row';

                        const title = document.createElement('div');
                        title.className = 'run-sample-title';
                        title.textContent = sample.label;
                        sampleRow.appendChild(title);

                        const volumeField = document.createElement('label');
                        volumeField.className = 'run-sample-field';
                        const volumeLabel = document.createElement('span');
                        volumeLabel.textContent = 'Virus volume (µL)';
                        const volumeInput = document.createElement('input');
                        volumeInput.type = 'number';
                        volumeInput.step = 'any';
                        volumeInput.className = 'inline-input';
                        volumeInput.value = sampleDraft.virusVolumeUl ?? '';
                        volumeInput.addEventListener('input', () => {
                            updateTiterRunDraft(sample.id, {
                                virusVolumeUl: volumeInput.value,
                            });
                        });
                        volumeField.append(volumeLabel, volumeInput);
                        sampleRow.appendChild(volumeField);

                        const selectionField = document.createElement('label');
                        selectionField.className = 'run-sample-check';
                        const selectionCheckbox = document.createElement('input');
                        selectionCheckbox.type = 'checkbox';
                        selectionCheckbox.checked = !!sampleDraft.selectionUsed;
                        selectionCheckbox.addEventListener('change', () => {
                            updateTiterRunDraft(sample.id, {
                                selectionUsed: selectionCheckbox.checked,
                            });
                        });
                        const selectionText = document.createElement('span');
                        selectionText.textContent = 'Selection applied';
                        selectionField.append(selectionCheckbox, selectionText);
                        sampleRow.appendChild(selectionField);

                        editor.appendChild(sampleRow);
                    });

                    runItem.appendChild(editor);
                } else {
                    const summary = document.createElement('div');
                    summary.className = 'run-entry-summary';

                    entry.data.samples.forEach((sample) => {
                        const summaryRow = document.createElement('div');
                        summaryRow.className = 'run-entry-summary-item';

                        const label = document.createElement('span');
                        label.className = 'run-entry-summary-label';
                        label.textContent = sample.label;

                        const details = document.createElement('span');
                        const volume = formatVolume(sample.virus_volume_ul);
                        const volumeText = volume != null ? `${volume} µL` : '—';
                        const selectionText = sample.selection_used
                            ? 'Selection applied'
                            : 'No selection';
                        details.textContent = `${volumeText} · ${selectionText}`;

                        summaryRow.append(label, details);
                        summary.appendChild(summaryRow);
                    });

                    runItem.appendChild(summary);
                }

                list.appendChild(runItem);
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
                    labelRows.push(joinLabelParts([
                        prep?.transfer_name ?? '',
                        formState.cellLine,
                        `${cellsLabel} cells`,
                        `${volumeText} uL`
                    ]));
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
            labelRows.push(`No LV - ${selectionName}`);
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
    const runId = parseInt(document.getElementById('titerRunSelect').value, 10);
    if (!runId) return;
    const controlPercent = parseFloat(document.getElementById('controlPercent').value) || 100;
    const inputs = document.querySelectorAll('#titerResultsContainer input[data-sample-id]');
    const samples = Array.from(inputs).map(input => ({
        id: parseInt(input.dataset.sampleId, 10),
        measured_percent: parseFloat(input.value)
    }));
    const data = await fetchJSON(api.titerResults(runId), {
        method: 'POST',
        body: JSON.stringify({ control_percent: controlPercent, samples })
    });
    if (data.average_titer !== null && data.average_titer !== undefined) {
        document.getElementById('averageTiter').textContent = `${Math.round(data.average_titer).toLocaleString()} TU/mL`;
    } else {
        document.getElementById('averageTiter').textContent = '—';
    }
    await refreshTiterRunSelect();
}

function copySummaryToClipboard() {
    const runId = parseInt(document.getElementById('titerRunSelect').value, 10);
    const run = titerRuns.find(r => r.id === runId);
    if (!run) return alert('Select a titer run first.');
    const prep = preps.find(p => p.id === run.prep_id);
    const average = document.getElementById('averageTiter').textContent;
    const summary = `${prep?.transfer_name ?? 'Lentivirus'} — ${new Date().toLocaleDateString()} — Lentivirus titer = ${average}`;
    navigator.clipboard.writeText(summary).then(() => {
        alert('Summary copied to clipboard!');
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('seedingVesselSelect').addEventListener('change', updateSeedingVolume);
    document.querySelector('[name="cells_to_seed"]').addEventListener('input', updateSeedingVolume);
    document.getElementById('seedingForm').addEventListener('submit', submitSeedingForm);
    document.getElementById('refreshExperiments').addEventListener('click', loadExperiments);
    document.getElementById('prepExperimentSelect').addEventListener('change', (e) => loadPreps(parseInt(e.target.value, 10)));
    document.getElementById('prepForm').addEventListener('submit', submitPrepForm);
    document.getElementById('printPrepLabel').addEventListener('click', handlePrintPrepLabel);
    document.getElementById('transfectionForm').addEventListener('submit', submitTransfectionForm);
    document.getElementById('ratioMode').addEventListener('change', (event) => {
        const isCustom = event.target.value === 'custom';
        document.getElementById('customRatio').disabled = !isCustom;
        updateTransfectionMetrics();
    });
    document.getElementById('customRatio').addEventListener('input', () => {
        if (document.getElementById('ratioMode').value === 'custom') {
            updateTransfectionMetrics();
        }
    });
    document.getElementById('transfectionVessel').addEventListener('change', updateTransfectionMetrics);
    document.getElementById('mediaForm').addEventListener('submit', submitMediaForm);
    document.getElementById('harvestForm').addEventListener('submit', submitHarvestForm);
    document.getElementById('printHarvestLabel').addEventListener('click', handlePrintHarvestLabel);
    document.getElementById('generateTiterInputs').addEventListener('click', generateTiterInputs);
    document.getElementById('titerSetupForm').addEventListener('submit', submitTiterSetup);
    document.getElementById('titerRunSelect').addEventListener('change', renderTiterResultsForm);
    document.getElementById('titerResultsForm').addEventListener('submit', submitTiterResults);
    document.getElementById('copySummary').addEventListener('click', copySummaryToClipboard);

    await loadExperiments();
    if (experiments.length) {
        const firstId = experiments[0].id;
        document.getElementById('prepExperimentSelect').value = firstId;
        await loadPreps(firstId);
    } else {
        await loadPreps(null);
    }
    updateSeedingVolume();
    updateTransfectionMetrics();
});
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
            copyButton.dataset.summary = joinLabelParts([
                entry.prepName,
                new Date().toLocaleDateString(),
                `Lentivirus titer = ${response.average_titer.toLocaleString()} TU/mL`
            ]);
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
    document.getElementById('exportTransfectionCsv').addEventListener('click', exportTransfectionCsv);
    document.getElementById('saveTransfection').addEventListener('click', saveTransfection);
    document.getElementById('applyMediaBulk').addEventListener('click', applyMediaBulk);
    document.getElementById('saveMediaChanges').addEventListener('click', saveMediaChanges);
    document.getElementById('copyHarvestLabels').addEventListener('click', copyHarvestLabels);
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


