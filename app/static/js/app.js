const api = {
    experiments: '/api/experiments',
    preps: (experimentId) => `/api/experiments/${experimentId}/preps`,
    transfection: (prepId) => `/api/preps/${prepId}/transfection`,
    mediaChange: (prepId) => `/api/preps/${prepId}/media-change`,
    harvest: (prepId) => `/api/preps/${prepId}/harvest`,
    titerRuns: (prepId) => `/api/preps/${prepId}/titer-runs`,
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
const DEFAULT_MEDIA_TYPE = 'DMEM + 10% FBS';

function isoToday() {
    return new Date().toISOString().split('T')[0];
}

function setDefaultSeedingDate(force = false) {
    const form = document.getElementById('seedingForm');
    const input = form?.querySelector('[name="seeding_date"]');
    if (!input) return;
    if (force || !input.value || !form.dataset.id) {
        input.value = isoToday();
    }
}

function resetSeedingDefaults() {
    const form = document.getElementById('seedingForm');
    if (!form) return;
    if (!form.dataset.id) {
        const mediaInput = form.querySelector('[name="media_type"]');
        if (mediaInput && !mediaInput.value) {
            mediaInput.value = DEFAULT_MEDIA_TYPE;
        }
        setDefaultSeedingDate(true);
    }
}

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
    form.media_type.value = exp.media_type ?? DEFAULT_MEDIA_TYPE;
    form.vessels_seeded.value = exp.vessels_seeded ?? '';
    form.seeding_date.value = exp.seeding_date ?? '';
}

async function submitSeedingForm(event) {
    event.preventDefault();
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form));
    if (!payload.media_type) {
        payload.media_type = DEFAULT_MEDIA_TYPE;
    }
    payload.cell_concentration = payload.cell_concentration ? parseFloat(payload.cell_concentration) : null;
    payload.cells_to_seed = payload.cells_to_seed ? parseFloat(payload.cells_to_seed) : null;
    payload.seeding_volume_ml = payload.seeding_volume_ml ? parseFloat(payload.seeding_volume_ml) : null;
    payload.vessels_seeded = payload.vessels_seeded ? parseInt(payload.vessels_seeded, 10) : null;
    const method = form.dataset.id ? 'PUT' : 'POST';
    const url = form.dataset.id ? `${api.experiments}/${form.dataset.id}` : api.experiments;
    await fetchJSON(url, { method, body: JSON.stringify(payload) });
    form.reset();
    delete form.dataset.id;
    resetSeedingDefaults();
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
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79,70,229,0.18)',
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
    resetSeedingDefaults();
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
    resetSeedingDefaults();
    updateSeedingVolume();
    updateTransfectionMetrics();
});
