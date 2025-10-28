const api = {
    experiments: '/api/experiments',
    preps: (experimentId) => `/api/experiments/${experimentId}/preps`,
    prepDetail: (prepId) => `/api/preps/${prepId}`,
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

const STATUS_STEPS = [
    { key: 'logged', label: 'Logged' },
    { key: 'transfected', label: 'Transfection' },
    { key: 'media_changed', label: 'Media' },
    { key: 'harvested', label: 'Harvest' },
    { key: 'titered', label: 'Titer' }
];

let experiments = [];
let preps = [];
let titerRuns = [];
let currentExperimentId = null;
let selectedPrepForLabels = null;
let moiChart;
const transfectionPrintData = new Map();

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!response.ok) {
        const text = await response.text();
        try {
            const payload = JSON.parse(text);
            throw new Error(payload.error || text || 'Request failed');
        } catch (err) {
            if (err instanceof SyntaxError) {
                throw new Error(text || 'Request failed');
            }
            throw err;
        }
    }
    return response.json();
}

function showFeedback(elementId, message, type = 'danger') {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = message;
    element.className = `alert alert-${type} mt-3`;
}

function clearFeedback(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.textContent = '';
    element.className = 'alert d-none mt-3';
}

function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return date.toLocaleString();
}

function getPrepById(prepId) {
    return preps.find((prep) => prep.id === prepId) || null;
}

function getSelectedPrepIds() {
    return Array.from(document.querySelectorAll('.prep-select:checked')).map((input) => parseInt(input.value, 10));
}

function renderStatusBar(status = {}) {
    const steps = STATUS_STEPS.map((step) => {
        const active = status[step.key];
        return `<span class="status-pill${active ? ' active' : ''}" title="${step.label}">${step.label}</span>`;
    });
    return `<div class="status-stack">${steps.join('')}</div>`;
}

function formatAmount(value, maximumFractionDigits = 3) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '—';
    }
    return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits,
    });
}

function renderTransfectionSummary(data, options = {}) {
    const { contextLabel = '', allowPrint = false, printKey = null } = options;
    const ratioLabel = Array.isArray(data?.ratio) ? data.ratio.join(':') : null;
    const headerLabel = contextLabel ? `<div class="text-muted small">${escapeHtml(contextLabel)}</div>` : '';
    const ratioBadge = ratioLabel
        ? `<span class="badge bg-light text-dark border">DNA ratio ${ratioLabel}</span>`
        : '';
    const reagentRows = [
        { label: 'Opti-MEM', value: formatAmount(data?.opti_mem_ml), unit: 'mL' },
        { label: 'X-tremeGENE 9', value: formatAmount(data?.xtremegene_ul), unit: 'uL' },
        { label: 'Total plasmid DNA', value: formatAmount(data?.total_plasmid_ug), unit: 'ug' },
    ];
    const dnaRows = [
        { label: 'Transfer plasmid DNA', value: formatAmount(data?.transfer_mass_ug), unit: 'ug' },
        { label: 'Packaging plasmid DNA', value: formatAmount(data?.packaging_mass_ug), unit: 'ug' },
        { label: 'Envelope plasmid DNA', value: formatAmount(data?.envelope_mass_ug), unit: 'ug' },
    ];
    const tableRows = [
        ...reagentRows.map((row) => `
            <tr>
                <td>${row.label}</td>
                <td class="text-end">${row.value}</td>
                <td>${row.unit}</td>
            </tr>
        `),
        '<tr class="table-section"><th colspan="3">DNA Distribution</th></tr>',
        ...dnaRows.map((row) => `
            <tr>
                <td>${row.label}</td>
                <td class="text-end">${row.value}</td>
                <td>${row.unit}</td>
            </tr>
        `),
    ].join('');

    const printButton = allowPrint && printKey
        ? `<div class="text-end mt-3"><button type="button" class="btn btn-outline-secondary btn-sm reagent-print-button" data-print-key="${printKey}">Print Table</button></div>`
        : '';

    return `
        <div class="col-12">
            <div class="reagent-summary border rounded p-3">
                <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                    <div>
                        <h6 class="mb-1">Transfection Reagent Plan</h6>
                        ${headerLabel}
                    </div>
                    ${ratioBadge}
                </div>
                <div class="table-responsive">
                    <table class="table table-sm reagent-table mb-0">
                        <thead>
                            <tr>
                                <th>Component</th>
                                <th class="text-end">Amount</th>
                                <th>Units</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
                ${printButton}
            </div>
        </div>
    `;
}

function sanitizeNumber(value) {
    if (value === '' || value === null || value === undefined) {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function roundToSignificant(value, digits = 3) {
    if (!value || !Number.isFinite(value)) {
        return 0;
    }
    const magnitude = Math.floor(Math.log10(Math.abs(value)));
    const factor = 10 ** (digits - 1 - magnitude);
    return Math.round(value * factor) / factor;
}

function updateSeedingVolume() {
    const vessel = document.getElementById('seedingVesselSelect').value;
    const cells = parseFloat(document.querySelector('[name="cells_to_seed"]').value) || null;
    fetchJSON(api.metrics.seeding, {
        method: 'POST',
        body: JSON.stringify({ vessel_type: vessel, target_cells: cells })
    })
        .then((data) => {
            document.getElementById('seedingVolume').value = data.seeding_volume_ml;
        })
        .catch(console.error);
}

async function loadExperiments() {
    const data = await fetchJSON(api.experiments);
    experiments = data.experiments;
    const tbody = document.querySelector('#experimentsTable tbody');
    tbody.innerHTML = '';
    experiments.forEach((exp) => {
        const tr = document.createElement('tr');
        tr.dataset.id = exp.id;
        tr.innerHTML = `
            <td>${exp.id}</td>
            <td>${exp.cell_line}</td>
            <td>${exp.vessel_type}</td>
            <td>${exp.seeding_volume_ml ?? '—'}</td>
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
    const options = experiments.map((exp) => `<option value="${exp.id}">#${exp.id} - ${exp.cell_line}</option>`).join('');
    document.getElementById('prepExperimentSelect').innerHTML = `<option value="">Select Experiment</option>${options}`;
    ['mediaPrepSelect', 'harvestPrepSelect', 'titerPrepSelect'].forEach((id) => {
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
    clearFeedback('prepFeedback');
    if (!experimentId) {
        preps = [];
        renderPreps();
        populatePrepSelects();
        refreshBulkForms();
        return;
    }
    const data = await fetchJSON(api.preps(experimentId));
    preps = data.preps;
    renderPreps();
    populatePrepSelects();
    refreshBulkForms();
}

function renderPreps() {
    const tbody = document.getElementById('prepTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    preps.forEach((prep) => {
        const tr = document.createElement('tr');
        tr.dataset.id = prep.id;
        tr.innerHTML = `
            <td><input class="form-check-input prep-select" type="checkbox" value="${prep.id}"></td>
            <td>
                <input type="text" class="form-control form-control-sm prep-field" data-field="transfer_name" value="${prep.transfer_name}">
                <div class="small text-muted mt-1">Prep #${prep.id}</div>
            </td>
            <td><input type="text" class="form-control form-control-sm prep-field" data-field="cell_line_used" value="${prep.cell_line_used ?? ''}"></td>
            <td><input type="number" step="any" class="form-control form-control-sm prep-field" data-field="transfer_concentration" value="${prep.transfer_concentration ?? ''}"></td>
            <td><input type="number" class="form-control form-control-sm prep-field" data-field="plasmid_size_bp" value="${prep.plasmid_size_bp ?? ''}"></td>
            <td><input type="number" min="1" class="form-control form-control-sm prep-field" data-field="plate_count" value="${prep.plate_count ?? 1}"></td>
            <td class="status-cell">${renderStatusBar(prep.status || {})}</td>
            <td>
                <div class="btn-group btn-group-sm" role="group">
                    <button type="button" class="btn btn-outline-primary prep-save" data-id="${prep.id}">Save</button>
                    <button type="button" class="btn btn-outline-danger prep-delete" data-id="${prep.id}">Delete</button>
                </div>
            </td>
        `;
        tr.addEventListener('click', (event) => {
            if (event.target.closest('.prep-save') || event.target.closest('.prep-delete')) {
                return;
            }
            selectedPrepForLabels = prep.id;
            updateLabelPreview(prep);
            populateTransfectionDetails();
            populateMediaLabel();
            populateHarvestLabel();
        });
        tr.querySelector('.prep-save').addEventListener('click', () => handlePrepRowSave(prep.id, tr));
        tr.querySelector('.prep-delete').addEventListener('click', () => handlePrepRowDelete(prep.id));
        tr.querySelector('.prep-select').addEventListener('change', refreshBulkForms);
        tbody.appendChild(tr);
    });
    const selectAll = document.getElementById('selectAllPreps');
    if (selectAll) {
        selectAll.checked = false;
    }
    if (preps.length) {
        if (!selectedPrepForLabels || !preps.some((prep) => prep.id === selectedPrepForLabels)) {
            selectedPrepForLabels = preps[0].id;
        }
        updateLabelPreview(getPrepById(selectedPrepForLabels));
    } else {
        selectedPrepForLabels = null;
        updateLabelPreview();
    }
}
async function handlePrepRowSave(prepId, row) {
    const payload = {};
    row.querySelectorAll('.prep-field').forEach((input) => {
        const field = input.dataset.field;
        const value = input.value.trim();
        if (value === '') {
            payload[field] = null;
        } else {
            payload[field] = value;
        }
    });
    try {
        await fetchJSON(api.prepDetail(prepId), { method: 'PUT', body: JSON.stringify(payload) });
        await loadPreps(currentExperimentId);
        showFeedback('prepFeedback', 'Prep updated successfully.', 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to update prep.');
    }
}

async function handlePrepRowDelete(prepId) {
    if (!confirm('Delete this prep? This will remove all associated records.')) {
        return;
    }
    try {
        await fetchJSON(api.prepDetail(prepId), { method: 'DELETE' });
        await loadPreps(currentExperimentId);
        showFeedback('prepFeedback', 'Prep deleted.', 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to delete prep.');
    }
}

function populatePrepSelects() {
    const hasPreps = preps.length > 0;
    const options = hasPreps
        ? preps.map((prep) => `<option value="${prep.id}">${prep.transfer_name} (Prep #${prep.id})</option>`).join('')
        : '<option value="">No preps saved</option>';
    ['transfectionPrepSelect', 'mediaPrepSelect', 'harvestPrepSelect', 'titerPrepSelect'].forEach((id) => {
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
    populateTransfectionDetails();
    populateMediaLabel();
    populateHarvestLabel();
}

function updateLabelPreview(prep = null) {
    const preview = document.getElementById('labelPreview');
    if (!preview) return;
    if (!prep) {
        preview.innerHTML = 'Select a prep to preview labels.';
        return;
    }
    const today = new Date().toLocaleDateString();
    const cellLine = prep.cell_line_used || 'HEK293FT';
    const volume = prep.harvest?.volume_ml ?? prep.media_change?.volume_ml ?? '—';
    const statusHtml = renderStatusBar(prep.status || {});
    preview.innerHTML = `
        <div class="label-item">
            <div><strong>${prep.transfer_name}</strong></div>
            <div>${cellLine}</div>
            <div>${today}</div>
        </div>
        <div class="label-item">Volume: ${volume} mL · Plates: ${prep.plate_count ?? '—'}</div>
        <div>${statusHtml}</div>
    `;
}

function openPrintWindow(content, options = {}) {
    const { title = 'Print', uppercase = true } = options;
    const textTransform = uppercase ? 'uppercase' : 'none';
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>${escapeHtml(title)}</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css">
        <style>body{padding:24px;font-family:'Segoe UI',sans-serif;text-transform:${textTransform}}</style>
        </head><body>${content}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
}

function handlePrintPrepLabel() {
    const prep = getPrepById(selectedPrepForLabels) || preps[0];
    if (!prep) {
        showFeedback('prepFeedback', 'Select a saved prep to print labels.');
        return;
    }
    const cellLine = prep.cell_line_used || 'HEK293FT';
    const label = `<div class="mb-3">${prep.transfer_name} - ${cellLine} - ${new Date().toLocaleDateString()}</div>`;
    openPrintWindow(label.repeat(4));
}

function handlePrintHarvestLabel() {
    const prepId = parseInt(document.getElementById('harvestPrepSelect').value, 10);
    const prep = getPrepById(prepId);
    if (!prep) {
        showFeedback('prepFeedback', 'Select a prep first.');
        return;
    }
    const volume = document.getElementById('harvestVolume').value || prep.media_change?.volume_ml || '—';
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

function copyHarvestLabel() {
    const prepId = parseInt(document.getElementById('harvestPrepSelect').value, 10);
    const prep = getPrepById(prepId);
    if (!prep) {
        showFeedback('prepFeedback', 'Select a prep first.');
        return;
    }
    const volume = document.getElementById('harvestVolume').value || prep.media_change?.volume_ml || '—';
    const date = document.getElementById('harvestDate').value || new Date().toLocaleDateString();
    const text = `${prep.transfer_name} - ${date} - ${volume} mL`;
    navigator.clipboard.writeText(text).then(() => {
        const button = document.getElementById('copyHarvestLabel');
        const original = button.textContent;
        button.textContent = 'Label Copied!';
        button.disabled = true;
        setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
        }, 2000);
    });
}

async function submitPrepForm(event) {
    event.preventDefault();
    const experimentId = parseInt(document.getElementById('prepExperimentSelect').value, 10);
    if (!experimentId) {
        showFeedback('prepFeedback', 'Select an experiment first.');
        return;
    }
    const plateCountInput = parseInt(document.getElementById('plateCount').value, 10) || 1;
    const experiment = experiments.find((exp) => exp.id === experimentId);
    if (experiment?.vessels_seeded) {
        const totalPlates = preps.reduce((acc, prep) => acc + (prep.plate_count || 0), 0) + plateCountInput;
        if (totalPlates > experiment.vessels_seeded) {
            showFeedback('prepFeedback', 'Plate count exceeds the number seeded for this experiment.');
            return;
        }
    }
    const payload = {
        transfer_name: document.getElementById('transferName').value,
        transfer_concentration: document.getElementById('transferConcentration').value || null,
        plasmid_size_bp: document.getElementById('plasmidSize').value || null,
        cell_line_used: document.getElementById('productionCellLine').value || null,
        plate_count: plateCountInput
    };
    try {
        await fetchJSON(api.preps(experimentId), { method: 'POST', body: JSON.stringify(payload) });
        document.getElementById('prepForm').reset();
        document.getElementById('plateCount').value = 1;
        await loadPreps(experimentId);
        showFeedback('prepFeedback', 'Lentivirus prep saved.', 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save prep.');
    }
}

function parseCustomRatio(value) {
    return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => Number(v));
}

async function updateTransfectionMetrics() {
    const vessel = document.getElementById('transfectionVessel').value;
    const mode = document.getElementById('ratioMode').value;
    const customRatioInput = document.getElementById('customRatio').value;
    let ratio = null;
    if (mode === 'custom') {
        ratio = parseCustomRatio(customRatioInput);
        if (ratio.length !== 3 || ratio.some((value) => !Number.isFinite(value))) {
            transfectionPrintData.delete('individual');
            document.getElementById('transfectionResults').innerHTML = '<p class="text-muted">Enter a custom ratio (e.g. 5,3,1).</p>';
            return;
        }
    }
    try {
        const data = await fetchJSON(api.metrics.transfection, {
            method: 'POST',
            body: JSON.stringify({ vessel_type: vessel, ratio_mode: mode, ratio })
        });
        const select = document.getElementById('transfectionPrepSelect');
        const prepId = parseInt(select?.value, 10);
        const prep = Number.isInteger(prepId) ? getPrepById(prepId) : null;
        const pieces = [];
        if (prep?.transfer_name) {
            pieces.push(prep.transfer_name);
        }
        if (vessel) {
            pieces.push(`Vessel: ${vessel}`);
        }
        const contextLabel = pieces.join(' - ');
        transfectionPrintData.set('individual', { data, contextLabel });
        document.getElementById('transfectionResults').innerHTML = renderTransfectionSummary(data, {
            contextLabel,
            allowPrint: true,
            printKey: 'individual'
        });
    } catch (error) {
        transfectionPrintData.delete('individual');
        document.getElementById('transfectionResults').innerHTML = `<p class="text-danger mb-0">${error.message}</p>`;
    }
}

function populateTransfectionDetails() {
    const select = document.getElementById('transfectionPrepSelect');
    if (!select) return;
    const label = document.getElementById('transfectionPrepLabel');
    const transferInput = document.getElementById('transfectionTransferConc');
    const packagingInput = document.getElementById('transfectionPackagingConc');
    const envelopeInput = document.getElementById('transfectionEnvelopeConc');
    const prepId = parseInt(select.value, 10);
    const prep = getPrepById(prepId);
    if (!prep) {
        label.textContent = 'Select a prep to view details.';
        transferInput.value = '';
        packagingInput.value = '';
        envelopeInput.value = '';
        updateTransfectionMetrics();
        return;
    }
    label.textContent = `${prep.transfer_name} - ${prep.cell_line_used ?? 'Cell line not specified'}`;
    transferInput.value = prep.transfection?.transfer_concentration ?? prep.transfer_concentration ?? '';
    packagingInput.value = prep.transfection?.packaging_concentration ?? '';
    envelopeInput.value = prep.transfection?.envelope_concentration ?? '';
    if (prep.transfection?.vessel_type) {
        document.getElementById('transfectionVessel').value = prep.transfection.vessel_type;
    }
    if (prep.transfection?.ratio_mode === 'custom') {
        document.getElementById('ratioMode').value = 'custom';
        document.getElementById('customRatio').disabled = false;
        document.getElementById('customRatio').value = [
            prep.transfection.transfer_ratio,
            prep.transfection.packaging_ratio,
            prep.transfection.envelope_ratio
        ].join(',');
    } else {
        document.getElementById('ratioMode').value = 'optimal';
        document.getElementById('customRatio').disabled = true;
        document.getElementById('customRatio').value = '';
    }
    updateTransfectionMetrics();
}

async function submitTransfectionForm(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('transfectionPrepSelect').value, 10);
    if (!prepId) {
        showFeedback('prepFeedback', 'Select a lentivirus prep first.');
        return;
    }
    const mode = document.getElementById('ratioMode').value;
    let ratio = null;
    if (mode === 'custom') {
        ratio = parseCustomRatio(document.getElementById('customRatio').value);
        if (ratio.length !== 3 || ratio.some((value) => !Number.isFinite(value))) {
            showFeedback('prepFeedback', 'Enter a valid custom ratio (e.g. 5,3,1).');
            return;
        }
    }
    const payload = {
        vessel_type: document.getElementById('transfectionVessel').value,
        ratio_mode: mode,
        ratio,
        transfer_concentration: sanitizeNumber(document.getElementById('transfectionTransferConc').value),
        packaging_concentration: sanitizeNumber(document.getElementById('transfectionPackagingConc').value),
        envelope_concentration: sanitizeNumber(document.getElementById('transfectionEnvelopeConc').value)
    };
    try {
        await fetchJSON(api.transfection(prepId), { method: 'POST', body: JSON.stringify(payload) });
        showFeedback('prepFeedback', 'Transfection saved.', 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        if (currentExperimentId) {
            await loadPreps(currentExperimentId);
        }
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save transfection.');
    }
}
function renderBulkTransfectionTable() {
    const tbody = document.getElementById('transfectionBulkBody');
    if (!tbody) return;
    const selected = getSelectedPrepIds().map((id) => getPrepById(id)).filter(Boolean);
    if (!selected.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Select preps from the table above to begin bulk entry.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    selected.forEach((prep) => {
        const row = document.createElement('tr');
        const ratioValue = prep.transfection?.ratio_mode === 'custom'
            ? [prep.transfection.transfer_ratio, prep.transfection.packaging_ratio, prep.transfection.envelope_ratio].join(',')
            : '';
        row.dataset.prepId = prep.id;
        row.innerHTML = `
            <td>
                <div class="fw-semibold">${prep.transfer_name}</div>
                <div class="small text-muted">Prep #${prep.id}</div>
            </td>
            <td><input type="number" step="any" class="form-control form-control-sm bulk-transfer-conc" value="${prep.transfection?.transfer_concentration ?? prep.transfer_concentration ?? ''}" placeholder="ng/µL"></td>
            <td>
                <select class="form-select form-select-sm bulk-vessel">
                    ${Object.keys(SURFACE_AREAS).map((vessel) => `<option value="${vessel}" ${prep.transfection?.vessel_type === vessel ? 'selected' : ''}>${vessel}</option>`).join('')}
                </select>
            </td>
            <td>
                <select class="form-select form-select-sm bulk-ratio-mode">
                    <option value="optimal" ${prep.transfection?.ratio_mode !== 'custom' ? 'selected' : ''}>4:3:1</option>
                    <option value="custom" ${prep.transfection?.ratio_mode === 'custom' ? 'selected' : ''}>Custom</option>
                </select>
                <input type="text" class="form-control form-control-sm mt-1 bulk-custom-ratio" value="${ratioValue}" placeholder="e.g. 5,3,1" ${prep.transfection?.ratio_mode === 'custom' ? '' : 'disabled'}>
            </td>
            <td class="bulk-results text-muted">—</td>
        `;
        row.querySelector('.bulk-vessel').addEventListener('change', () => updateBulkTransfectionMetrics(prep.id));
        row.querySelector('.bulk-ratio-mode').addEventListener('change', (event) => {
            const customInput = row.querySelector('.bulk-custom-ratio');
            const isCustom = event.target.value === 'custom';
            customInput.disabled = !isCustom;
            if (!isCustom) {
                customInput.value = '';
            }
            updateBulkTransfectionMetrics(prep.id);
        });
        row.querySelector('.bulk-custom-ratio').addEventListener('input', () => {
            if (!row.querySelector('.bulk-custom-ratio').disabled) {
                updateBulkTransfectionMetrics(prep.id);
            }
        });
        tbody.appendChild(row);
        updateBulkTransfectionMetrics(prep.id);
    });
}

async function updateBulkTransfectionMetrics(prepId) {
    const row = document.querySelector(`#transfectionBulkBody tr[data-prep-id="${prepId}"]`);
    if (!row) return;
    const vessel = row.querySelector('.bulk-vessel').value;
    const mode = row.querySelector('.bulk-ratio-mode').value;
    const ratioInput = row.querySelector('.bulk-custom-ratio').value;
    let ratio = null;
    if (mode === 'custom') {
        ratio = parseCustomRatio(ratioInput);
        if (ratio.length !== 3 || ratio.some((value) => !Number.isFinite(value))) {
            row.querySelector('.bulk-results').innerHTML = '<span class="text-muted">Enter a custom ratio.</span>';
            transfectionPrintData.delete(`bulk-${prepId}`);
            return;
        }
    }
    try {
        const data = await fetchJSON(api.metrics.transfection, {
            method: 'POST',
            body: JSON.stringify({ vessel_type: vessel, ratio_mode: mode, ratio })
        });
        const prep = getPrepById(prepId);
        const vesselLabel = vessel ? `Vessel: ${vessel}` : '';
        const contextPieces = [prep?.transfer_name, prep ? `Prep #${prep.id}` : null, vesselLabel].filter(Boolean);
        const contextLabel = contextPieces.join(' - ');
        const printKey = `bulk-${prepId}`;
        transfectionPrintData.set(printKey, { data, contextLabel });
        row.querySelector('.bulk-results').innerHTML = renderTransfectionSummary(data, {
            contextLabel,
            allowPrint: true,
            printKey
        });
    } catch (error) {
        transfectionPrintData.delete(`bulk-${prepId}`);
        row.querySelector('.bulk-results').innerHTML = `<span class="text-danger">${error.message}</span>`;
    }
}

async function submitTransfectionBulkForm(event) {
    event.preventDefault();
    const selected = getSelectedPrepIds();
    if (!selected.length) {
        showFeedback('prepFeedback', 'Select at least one prep for bulk transfection.');
        return;
    }
    const packagingConc = sanitizeNumber(document.getElementById('bulkPackagingConc').value);
    const envelopeConc = sanitizeNumber(document.getElementById('bulkEnvelopeConc').value);
    try {
        for (const prepId of selected) {
            const row = document.querySelector(`#transfectionBulkBody tr[data-prep-id="${prepId}"]`);
            if (!row) continue;
            const vessel = row.querySelector('.bulk-vessel').value;
            const mode = row.querySelector('.bulk-ratio-mode').value;
            const ratioInput = row.querySelector('.bulk-custom-ratio').value;
            let ratio = null;
            if (mode === 'custom') {
                ratio = parseCustomRatio(ratioInput);
                if (ratio.length !== 3 || ratio.some((value) => !Number.isFinite(value))) {
                    throw new Error('Enter valid custom ratios for all selected preps.');
                }
            }
            const payload = {
                vessel_type: vessel,
                ratio_mode: mode,
                ratio,
                transfer_concentration: sanitizeNumber(row.querySelector('.bulk-transfer-conc').value),
                packaging_concentration: packagingConc,
                envelope_concentration: envelopeConc
            };
            await fetchJSON(api.transfection(prepId), { method: 'POST', body: JSON.stringify(payload) });
        }
        showFeedback('prepFeedback', `Saved transfections for ${selected.length} prep(s).`, 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        if (currentExperimentId) {
            await loadPreps(currentExperimentId);
        }
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save bulk transfections.');
    }
}

async function submitMediaForm(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('mediaPrepSelect').value, 10);
    if (!prepId) {
        showFeedback('prepFeedback', 'Select a prep first.');
        return;
    }
    const payload = {
        media_type: document.getElementById('mediaType').value,
        volume_ml: parseFloat(document.getElementById('mediaVolume').value)
    };
    try {
        await fetchJSON(api.mediaChange(prepId), { method: 'POST', body: JSON.stringify(payload) });
        showFeedback('prepFeedback', 'Media change saved.', 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        if (currentExperimentId) {
            await loadPreps(currentExperimentId);
        }
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save media change.');
    }
}

async function submitMediaBulkForm(event) {
    event.preventDefault();
    const selected = getSelectedPrepIds();
    if (!selected.length) {
        showFeedback('prepFeedback', 'Select at least one prep for bulk media logging.');
        return;
    }
    const payload = {
        media_type: document.getElementById('mediaBulkType').value,
        volume_ml: parseFloat(document.getElementById('mediaBulkVolume').value)
    };
    try {
        for (const prepId of selected) {
            await fetchJSON(api.mediaChange(prepId), { method: 'POST', body: JSON.stringify(payload) });
        }
        showFeedback('prepFeedback', `Media changes saved for ${selected.length} prep(s).`, 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        if (currentExperimentId) {
            await loadPreps(currentExperimentId);
        }
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save bulk media changes.');
    }
}

async function submitHarvestForm(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('harvestPrepSelect').value, 10);
    if (!prepId) {
        showFeedback('prepFeedback', 'Select a prep first.');
        return;
    }
    const payload = {
        harvest_date: document.getElementById('harvestDate').value || null,
        volume_ml: sanitizeNumber(document.getElementById('harvestVolume').value)
    };
    try {
        await fetchJSON(api.harvest(prepId), { method: 'POST', body: JSON.stringify(payload) });
        showFeedback('prepFeedback', 'Harvest saved.', 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        if (currentExperimentId) {
            await loadPreps(currentExperimentId);
        }
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save harvest.');
    }
}

async function submitHarvestBulkForm(event) {
    event.preventDefault();
    const selected = getSelectedPrepIds();
    if (!selected.length) {
        showFeedback('prepFeedback', 'Select at least one prep for bulk harvest logging.');
        return;
    }
    const payload = {
        harvest_date: document.getElementById('harvestBulkDate').value || null,
        volume_ml: sanitizeNumber(document.getElementById('harvestBulkVolume').value)
    };
    try {
        for (const prepId of selected) {
            await fetchJSON(api.harvest(prepId), { method: 'POST', body: JSON.stringify(payload) });
        }
        showFeedback('prepFeedback', `Harvests saved for ${selected.length} prep(s).`, 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        if (currentExperimentId) {
            await loadPreps(currentExperimentId);
        }
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save bulk harvests.');
    }
}
function renderTiterSampleInputs(containerId, tests) {
    const container = document.getElementById(containerId);
    if (!container) return;
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
    for (let i = 1; i <= tests; i += 1) {
        content += `
            <div class="mb-2" data-sample-index="${i}">
                <label class="form-label">Test ${i} Virus Volume (µL)</label>
                <input type="number" step="any" class="form-control" data-field="volume">
                <div class="form-check mt-1">
                    <input class="form-check-input" type="checkbox" data-field="selection" id="sample_${containerId}_${i}">
                    <label class="form-check-label" for="sample_${containerId}_${i}">Selection Applied</label>
                </div>
            </div>`;
    }
    content += '</div></div></div>';
    container.innerHTML = content;
}

async function submitTiterSetup(event) {
    event.preventDefault();
    const prepId = parseInt(document.getElementById('titerPrepSelect').value, 10);
    if (!prepId) {
        showFeedback('prepFeedback', 'Select a prep first.');
        return;
    }
    const tests = parseInt(document.getElementById('titerTests').value, 10) || 1;
    const container = document.getElementById('titerSamplesContainer');
    const sampleElements = container.querySelectorAll('[data-sample-index]');
    if (!sampleElements.length) {
        renderTiterSampleInputs('titerSamplesContainer', tests);
        showFeedback('prepFeedback', 'Enter sample volumes before saving.');
        return;
    }
    const samples = Array.from(sampleElements).map((element) => ({
        label: `Test ${element.dataset.sampleIndex}`,
        virus_volume_ul: parseFloat(element.querySelector('[data-field="volume"]').value) || 0,
        selection_used: element.querySelector('[data-field="selection"]').checked
    }));
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
    try {
        await fetchJSON(api.titerRuns(prepId), { method: 'POST', body: JSON.stringify(payload) });
        showFeedback('prepFeedback', 'Titer setup saved.', 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        await refreshTiterRunSelect(prepId);
        document.getElementById('titerSetupForm').reset();
        document.getElementById('titerSamplesContainer').innerHTML = '';
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save titer setup.');
    }
}

async function submitTiterBulkForm(event) {
    event.preventDefault();
    const selected = getSelectedPrepIds();
    if (!selected.length) {
        showFeedback('prepFeedback', 'Select at least one prep for bulk titer setup.');
        return;
    }
    const tests = parseInt(document.getElementById('titerBulkTests').value, 10) || 1;
    const container = document.getElementById('titerBulkSamplesContainer');
    const sampleElements = container.querySelectorAll('[data-sample-index]');
    if (!sampleElements.length) {
        renderTiterSampleInputs('titerBulkSamplesContainer', tests);
        showFeedback('prepFeedback', 'Enter sample volumes before saving.');
        return;
    }
    const baseSamples = Array.from(sampleElements).map((element) => ({
        label: `Test ${element.dataset.sampleIndex}`,
        virus_volume_ul: parseFloat(element.querySelector('[data-field="volume"]').value) || 0,
        selection_used: element.querySelector('[data-field="selection"]').checked
    }));
    baseSamples.push({ label: 'Control - No Selection', virus_volume_ul: 0, selection_used: false });
    baseSamples.push({ label: 'Control - Selection', virus_volume_ul: 0, selection_used: true });
    const basePayload = {
        cell_line: document.getElementById('titerBulkCellLine').value,
        cells_seeded: parseFloat(document.getElementById('titerBulkCellsSeeded').value),
        vessel_type: document.getElementById('titerBulkVessel').value,
        selection_reagent: document.getElementById('titerBulkSelectionReagent').value || null,
        selection_concentration: document.getElementById('titerBulkSelectionConcentration').value || null,
        tests_count: tests,
        samples: baseSamples
    };
    try {
        for (const prepId of selected) {
            await fetchJSON(api.titerRuns(prepId), { method: 'POST', body: JSON.stringify(basePayload) });
        }
        showFeedback('prepFeedback', `Titer setups saved for ${selected.length} prep(s).`, 'success');
        setTimeout(() => clearFeedback('prepFeedback'), 4000);
        if (selected[0]) {
            await refreshTiterRunSelect(selected[0]);
        }
        document.getElementById('titerBulkForm').reset();
        document.getElementById('titerBulkSamplesContainer').innerHTML = '';
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to save bulk titer setups.');
    }
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
    select.innerHTML = titerRuns.map((run) => `<option value="${run.id}">Run #${run.id} · ${run.cell_line}</option>`).join('');
    if (titerRuns.length) {
        const match = titerRuns.find((run) => run.id === previousSelection);
        select.value = (match ? match.id : titerRuns[0].id).toString();
    }
    renderTiterResultsForm();
}

function renderTiterResultsForm() {
    const select = document.getElementById('titerRunSelect');
    const runId = parseInt(select.value, 10);
    const run = titerRuns.find((r) => r.id === runId);
    const container = document.getElementById('titerResultsContainer');
    if (!run) {
        container.innerHTML = '<p class="text-muted">Select a titer run to enter results.</p>';
        document.getElementById('averageTiter').textContent = '—';
        return;
    }
    let content = '';
    run.samples.forEach((sample) => {
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
    const filtered = samples.filter((s) => s.moi != null && s.measured_percent != null);
    const labels = filtered.map((s) => s.label);
    const data = {
        labels,
        datasets: [{
            label: '% Infected',
            data: filtered.map((s) => 100 - s.measured_percent),
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
                            label: (context) => `MOI ${filtered[context.dataIndex].moi ?? '—'} · % infected ${context.parsed.y.toFixed(2)}`
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
        .map((sample) => sample.titer_tu_ml)
        .filter((value) => typeof value === 'number' && !Number.isNaN(value));
    if (!values.length) {
        return null;
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
}

function updateAverageTiterDisplay(samples) {
    const average = calculateAverageTiter(samples);
    const element = document.getElementById('averageTiter');
    if (average == null) {
        element.textContent = '—';
        return;
    }
    const rounded = roundToSignificant(average);
    element.textContent = `${rounded.toLocaleString()} TU/mL`;
}

async function submitTiterResults(event) {
    event.preventDefault();
    const runId = parseInt(document.getElementById('titerRunSelect').value, 10);
    if (!runId) return;
    const controlPercent = parseFloat(document.getElementById('controlPercent').value) || 100;
    const inputs = document.querySelectorAll('#titerResultsContainer input[data-sample-id]');
    const samples = Array.from(inputs).map((input) => ({
        id: parseInt(input.dataset.sampleId, 10),
        measured_percent: parseFloat(input.value)
    }));
    try {
        const data = await fetchJSON(api.titerResults(runId), {
            method: 'POST',
            body: JSON.stringify({ control_percent: controlPercent, samples })
        });
        const rounded = data.rounded_average_titer;
        document.getElementById('averageTiter').textContent = rounded != null ? `${rounded.toLocaleString()} TU/mL` : '—';
        await refreshTiterRunSelect();
    } catch (error) {
        showFeedback('prepFeedback', error.message || 'Unable to calculate titer.');
    }
}

function copySummaryToClipboard() {
    const runId = parseInt(document.getElementById('titerRunSelect').value, 10);
    const run = titerRuns.find((r) => r.id === runId);
    if (!run) {
        showFeedback('prepFeedback', 'Select a titer run first.');
        return;
    }
    const prep = getPrepById(run.prep_id);
    const average = document.getElementById('averageTiter').textContent;
    const summary = `${prep?.transfer_name ?? 'Lentivirus'} - ${new Date().toLocaleDateString()} - Lentivirus titer = ${average}`;
    navigator.clipboard.writeText(summary).then(() => {
        const button = document.getElementById('copySummary');
        const original = button.textContent;
        button.textContent = 'Summary Copied!';
        button.disabled = true;
        setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
        }, 2000);
    });
}
function populateMediaLabel() {
    const select = document.getElementById('mediaPrepSelect');
    const label = document.getElementById('mediaPrepLabel');
    const prepId = parseInt(select?.value, 10);
    const prep = getPrepById(prepId);
    if (!label) return;
    if (!prep) {
        label.textContent = 'Select a prep to continue.';
        return;
    }
    label.textContent = `${prep.transfer_name} - Plates: ${prep.plate_count ?? '—'}`;
    if (prep.media_change?.volume_ml) {
        document.getElementById('mediaVolume').value = prep.media_change.volume_ml;
        document.getElementById('mediaType').value = prep.media_change.media_type;
    }
}

function populateHarvestLabel() {
    const select = document.getElementById('harvestPrepSelect');
    const label = document.getElementById('harvestPrepLabel');
    const prepId = parseInt(select?.value, 10);
    const prep = getPrepById(prepId);
    if (!label) return;
    if (!prep) {
        label.textContent = 'Select a prep with a media change recorded.';
        return;
    }
    label.textContent = `${prep.transfer_name} - Media volume ${prep.media_change?.volume_ml ?? '—'} mL`;
    if (prep.media_change?.volume_ml && !document.getElementById('harvestVolume').value) {
        document.getElementById('harvestVolume').value = prep.media_change.volume_ml;
    }
    if (prep.harvest?.harvest_date) {
        document.getElementById('harvestDate').value = prep.harvest.harvest_date;
        if (prep.harvest.volume_ml) {
            document.getElementById('harvestVolume').value = prep.harvest.volume_ml;
        }
    }
}

function refreshBulkForms() {
    renderBulkTransfectionTable();
    const selected = getSelectedPrepIds().map((id) => getPrepById(id)).filter(Boolean);
    if (selected.length) {
        const first = selected[0];
        if (document.getElementById('mediaBulkVolume')) {
            document.getElementById('mediaBulkVolume').value = first.media_change?.volume_ml ?? '';
            if (first.media_change?.media_type) {
                document.getElementById('mediaBulkType').value = first.media_change.media_type;
            }
        }
        if (document.getElementById('harvestBulkVolume')) {
            document.getElementById('harvestBulkVolume').value = first.media_change?.volume_ml ?? '';
        }
    }
}

function populateTiterDefaults() {
    const select = document.getElementById('titerPrepSelect');
    const prepId = parseInt(select?.value, 10);
    const prep = getPrepById(prepId);
    if (!prep) return;
    if (!document.getElementById('titerCellLine').value) {
        document.getElementById('titerCellLine').value = prep.cell_line_used ?? '';
    }
}

function toggleSelectAllPreps(event) {
    const checked = event.target.checked;
    document.querySelectorAll('.prep-select').forEach((input) => {
        input.checked = checked;
    });
    refreshBulkForms();
}

function generateIndividualTiterInputs() {
    const tests = parseInt(document.getElementById('titerTests').value, 10) || 1;
    renderTiterSampleInputs('titerSamplesContainer', tests);
}

function generateBulkTiterInputs() {
    const tests = parseInt(document.getElementById('titerBulkTests').value, 10) || 1;
    renderTiterSampleInputs('titerBulkSamplesContainer', tests);
}

function printTransfectionTable(data, contextLabel = '') {
    if (!data) {
        return;
    }
    const ratioLabel = Array.isArray(data.ratio) ? data.ratio.join(':') : null;
    const contextLine = contextLabel ? `<p style="margin:0 0 12px;font-size:14px;">${escapeHtml(contextLabel)}</p>` : '';
    const ratioLine = ratioLabel
        ? `<p style="margin:0 0 16px;font-size:13px;">DNA ratio (transfer:packaging:envelope): ${escapeHtml(ratioLabel)}</p>`
        : '';
    const rows = [
        { label: 'Opti-MEM', value: formatAmount(data.opti_mem_ml), unit: 'mL' },
        { label: 'X-tremeGENE 9', value: formatAmount(data.xtremegene_ul), unit: 'uL' },
        { label: 'Total plasmid DNA', value: formatAmount(data.total_plasmid_ug), unit: 'ug' },
        { separator: true, label: 'DNA Distribution' },
        { label: 'Transfer plasmid DNA', value: formatAmount(data.transfer_mass_ug), unit: 'ug' },
        { label: 'Packaging plasmid DNA', value: formatAmount(data.packaging_mass_ug), unit: 'ug' },
        { label: 'Envelope plasmid DNA', value: formatAmount(data.envelope_mass_ug), unit: 'ug' },
    ];
    const tableRows = rows
        .map((row) => {
            if (row.separator) {
                return `<tr><th colspan="3" style="text-align:left;padding:8px;background:#f1f3f5;font-size:13px;">${escapeHtml(row.label)}</th></tr>`;
            }
            return `<tr>
                <td style="padding:8px;border-bottom:1px solid #dee2e6;font-size:13px;">${escapeHtml(row.label)}</td>
                <td style="padding:8px;border-bottom:1px solid #dee2e6;font-size:13px;text-align:right;">${escapeHtml(row.value)}</td>
                <td style="padding:8px;border-bottom:1px solid #dee2e6;font-size:13px;">${escapeHtml(row.unit)}</td>
            </tr>`;
        })
        .join('');
    const content = `
        <div>
            <h1 style="font-size:18px;margin-bottom:8px;">Transfection Reagent Plan</h1>
            ${contextLine}
            ${ratioLine}
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                <thead>
                    <tr>
                        <th style="text-align:left;padding:8px;border-bottom:2px solid #000;font-size:13px;">Component</th>
                        <th style="text-align:right;padding:8px;border-bottom:2px solid #000;font-size:13px;">Amount</th>
                        <th style="text-align:left;padding:8px;border-bottom:2px solid #000;font-size:13px;">Units</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
    openPrintWindow(content, { title: 'Transfection Reagents', uppercase: false });
}

document.addEventListener('click', (event) => {
    const button = event.target.closest('.reagent-print-button');
    if (!button) {
        return;
    }
    const key = button.dataset.printKey;
    const entry = transfectionPrintData.get(key);
    if (!entry) {
        return;
    }
    printTransfectionTable(entry.data, entry.contextLabel);
});

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('seedingVesselSelect').addEventListener('change', updateSeedingVolume);
    document.querySelector('[name="cells_to_seed"]').addEventListener('input', updateSeedingVolume);
    document.getElementById('seedingForm').addEventListener('submit', submitSeedingForm);
    document.getElementById('refreshExperiments').addEventListener('click', loadExperiments);
    document.getElementById('prepExperimentSelect').addEventListener('change', (e) => loadPreps(parseInt(e.target.value, 10)));
    document.getElementById('prepForm').addEventListener('submit', submitPrepForm);
    document.getElementById('printPrepLabel').addEventListener('click', handlePrintPrepLabel);
    document.getElementById('transfectionForm').addEventListener('submit', submitTransfectionForm);
    document.getElementById('transfectionBulkForm').addEventListener('submit', submitTransfectionBulkForm);
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
    document.getElementById('transfectionPrepSelect').addEventListener('change', () => {
        populateTransfectionDetails();
    });
    document.getElementById('mediaForm').addEventListener('submit', submitMediaForm);
    document.getElementById('mediaBulkForm').addEventListener('submit', submitMediaBulkForm);
    document.getElementById('mediaPrepSelect').addEventListener('change', populateMediaLabel);
    document.getElementById('harvestForm').addEventListener('submit', submitHarvestForm);
    document.getElementById('harvestBulkForm').addEventListener('submit', submitHarvestBulkForm);
    document.getElementById('harvestPrepSelect').addEventListener('change', populateHarvestLabel);
    document.getElementById('printHarvestLabel').addEventListener('click', handlePrintHarvestLabel);
    document.getElementById('copyHarvestLabel').addEventListener('click', copyHarvestLabel);
    document.getElementById('generateTiterInputs').addEventListener('click', generateIndividualTiterInputs);
    document.getElementById('generateTiterBulkInputs').addEventListener('click', generateBulkTiterInputs);
    document.getElementById('titerSetupForm').addEventListener('submit', submitTiterSetup);
    document.getElementById('titerBulkForm').addEventListener('submit', submitTiterBulkForm);
    document.getElementById('titerPrepSelect').addEventListener('change', () => {
        populateTiterDefaults();
        refreshTiterRunSelect(parseInt(document.getElementById('titerPrepSelect').value, 10));
    });
    document.getElementById('titerRunSelect').addEventListener('change', renderTiterResultsForm);
    document.getElementById('titerResultsForm').addEventListener('submit', submitTiterResults);
    document.getElementById('copySummary').addEventListener('click', copySummaryToClipboard);
    const selectAll = document.getElementById('selectAllPreps');
    if (selectAll) {
        selectAll.addEventListener('change', toggleSelectAllPreps);
    }

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
