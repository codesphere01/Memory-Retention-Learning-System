// API Configuration
const API_BASE = 'http://localhost:5000/api';

// Global State
let concepts = [];
let currentDay = 0;
let lambda = 0.15;
let totalRevisions = 0;
let recentlyRevisedConcepts = new Map(); // Track concepts revised in this session: Map<conceptId, revisedMemoryStrength>

// Charts
let decayChart = null;
let categoryChart = null;
let distributionChart = null;

// ============================================================================
// API FUNCTIONS
// ============================================================================

async function fetchFromAPI(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`API Error: ${response.status} ${response.statusText}`, errorText);
            return { status: 'error', message: `HTTP ${response.status}: ${errorText}` };
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API Error:', error);
        return { status: 'error', message: error.message };
    }
}

async function loadConcepts() {
    const data = await fetchFromAPI('/concepts');
    if (Array.isArray(data)) {
        concepts = data;
        console.log('loadConcepts: Loaded', concepts.length, 'concepts from API');
    } else {
        console.warn('loadConcepts: API returned non-array, using sample data. Response:', data);
        // Fallback to sample data if API fails
        loadSampleData();
    }
}

async function loadStats() {
    const stats = await fetchFromAPI('/stats');
    if (stats && !stats.status) {
        document.getElementById('totalConcepts').textContent = stats.totalConcepts;
        document.getElementById('avgMemory').textContent = `${Math.round(stats.avgMemory)}%`;
        document.getElementById('urgentCount').textContent = stats.urgentCount;
        document.getElementById('totalRevisions').textContent = stats.totalRevisions;
        currentDay = stats.currentDay;
        document.getElementById('currentDay').textContent = currentDay;
    }
}

async function loadRevisionQueue() {
    const queue = await fetchFromAPI('/revision-queue');
    console.log('loadRevisionQueue: Received data:', queue);
    if (Array.isArray(queue)) {
        // Process queue: show all concepts, but move revised ones to bottom with 100% memory
        const processedQueue = queue.map(concept => {
            const wasRevised = recentlyRevisedConcepts.has(concept.id);
            if (wasRevised) {
                // Create a copy with 100% memory strength for display
                return {
                    ...concept,
                    memory_strength: 1.0, // Show as 100%
                    isRevised: true // Flag to identify revised concepts
                };
            }
            return concept;
        });
        
        // Sort: revised concepts go to bottom, others sorted by memory strength (lowest first)
        processedQueue.sort((a, b) => {
            const aRevised = recentlyRevisedConcepts.has(a.id);
            const bRevised = recentlyRevisedConcepts.has(b.id);
            
            // If one is revised and the other isn't, revised goes to bottom
            if (aRevised && !bRevised) return 1;
            if (!aRevised && bRevised) return -1;
            
            // Both revised or both not revised: sort by memory strength (lowest first)
            return a.memory_strength - b.memory_strength;
        });
        
        console.log('loadRevisionQueue: Processed queue with', processedQueue.length, 'items');
        console.log('loadRevisionQueue: Recently revised concepts:', Array.from(recentlyRevisedConcepts.keys()));
        updateRevisionQueueTable(processedQueue);
    } else {
        console.warn('loadRevisionQueue: Received non-array data:', queue);
    }
}

// Track ongoing revisions to prevent duplicate calls
const revisingConcepts = new Set();

async function reviseConceptAPI(conceptId) {
    // Prevent multiple simultaneous revisions of the same concept
    if (revisingConcepts.has(conceptId)) {
        console.log('Revision already in progress for:', conceptId);
        return;
    }
    
    revisingConcepts.add(conceptId);
    console.log('Revising concept:', conceptId);
    
    try {
        const result = await fetchFromAPI(`/revise/${conceptId}`, { method: 'POST' });
        console.log('Revise result:', JSON.stringify(result, null, 2));
        
        // Check if result has status property or if it's a different format
        if (result && (result.status === 'success' || !result.status)) {
            // Mark this concept as recently revised with boosted memory (100%)
            recentlyRevisedConcepts.set(conceptId, 1.0);
            console.log('Marked concept as revised:', conceptId, 'with 100% memory');
            
            // Always update data after revision attempt
            console.log('Updating all data...');
            await updateAllData();
            console.log('Concept revised successfully! Data updated.');
        } else if (result && result.status === 'error') {
            // Show error message
            alert(`Error revising concept: ${result.message || 'Unknown error'}`);
            console.error('Revise error:', result);
        } else {
            // If result format is unexpected, still try to update
            console.warn('Unexpected result format, updating anyway:', result);
            await updateAllData();
        }
    } catch (error) {
        console.error('Exception during revise:', error);
        alert(`Error revising concept: ${error.message}`);
    } finally {
        revisingConcepts.delete(conceptId);
    }
}

// Expose function globally for onclick handlers
window.reviseConceptAPI = reviseConceptAPI;

async function simulateTimeAPI(days) {
    const result = await fetchFromAPI('/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: parseInt(days) })
    });
    if (result.status === 'success') {
        await updateAllData();
    }
}

async function addConceptAPI(name, category, prerequisites) {
    const id = name.toLowerCase().replace(/\s+/g, '_');
    const result = await fetchFromAPI('/concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, id, category, prerequisites })
    });
    if (result.status === 'success') {
        // Newly added concepts should appear in the queue, so refresh data
        await updateAllData();
        document.getElementById('addConceptForm').reset();
        console.log('Concept added:', name, 'with id:', id);
    } else {
        alert(`Error adding concept: ${result.message || 'Unknown error'}`);
    }
}

async function setDecayRateAPI(rate) {
    const result = await fetchFromAPI('/decay-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: parseFloat(rate) })
    });
    if (result.status === 'success') {
        lambda = rate;
        await updateAllData();
    }
}

async function updateAllData() {
    console.log('updateAllData: Starting data refresh...');
    await loadConcepts();
    console.log('updateAllData: Concepts loaded, count:', concepts.length);
    await loadStats();
    console.log('updateAllData: Stats loaded');
    await loadRevisionQueue();
    console.log('updateAllData: Revision queue loaded');
    updateAllVisualizations();
    console.log('updateAllData: All visualizations updated');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getPriorityStatus(memory) {
    if (memory < 0.3) return { status: 'Urgent', class: 'priority-urgent' };
    if (memory < 0.5) return { status: 'High', class: 'priority-high' };
    if (memory < 0.7) return { status: 'Medium', class: 'priority-medium' };
    return { status: 'Low', class: 'priority-low' };
}

function getMemoryColor(memory) {
    if (memory < 0.3) return '#C0152F';
    if (memory < 0.5) return '#E6815F';
    if (memory < 0.7) return '#FFB84D';
    return '#32B8C6';
}

function loadSampleData() {
    const sampleData = [
        { name: "Binary Search", id: "binary_search", category: "Algorithms", initial_weight: 0.85, last_revised_day: 3, prerequisites: ["arrays"], memory_strength: 0.72 },
        { name: "Arrays", id: "arrays", category: "Data Structures", initial_weight: 0.45, last_revised_day: 7, prerequisites: [], memory_strength: 0.45 },
        { name: "Sorting Algorithms", id: "sorting", category: "Algorithms", initial_weight: 0.62, last_revised_day: 5, prerequisites: ["arrays"], memory_strength: 0.62 },
        { name: "Linked Lists", id: "linked_lists", category: "Data Structures", initial_weight: 0.28, last_revised_day: 10, prerequisites: [], memory_strength: 0.28 },
        { name: "Binary Trees", id: "trees", category: "Data Structures", initial_weight: 0.75, last_revised_day: 2, prerequisites: ["linked_lists"], memory_strength: 0.75 },
        { name: "Hash Tables", id: "hash_tables", category: "Data Structures", initial_weight: 0.55, last_revised_day: 6, prerequisites: ["arrays"], memory_strength: 0.55 },
        { name: "Graph Traversal", id: "graphs", category: "Algorithms", initial_weight: 0.35, last_revised_day: 9, prerequisites: ["trees"], memory_strength: 0.35 },
        { name: "Dynamic Programming", id: "dp", category: "Algorithms", initial_weight: 0.90, last_revised_day: 1, prerequisites: ["sorting"], memory_strength: 0.90 }
    ];
    concepts = sampleData;
}

// ============================================================================
// UPDATE FUNCTIONS
// ============================================================================

function updateStatistics() {
    if (concepts.length === 0) {
        document.getElementById('totalConcepts').textContent = '0';
        document.getElementById('avgMemory').textContent = '0%';
        document.getElementById('urgentCount').textContent = '0';
        return;
    }

    const avgMemory = concepts.reduce((sum, c) => sum + c.memory_strength, 0) / concepts.length;
    const urgentCount = concepts.filter(c => c.memory_strength < 0.3).length;

    document.getElementById('totalConcepts').textContent = concepts.length;
    document.getElementById('avgMemory').textContent = `${Math.round(avgMemory * 100)}%`;
    document.getElementById('urgentCount').textContent = urgentCount;
}

function updateRevisionQueueTable(queue) {
    console.log('updateRevisionQueueTable: Called with', queue?.length || 0, 'concepts');
    const tbody = document.getElementById('revisionQueueBody');
    if (!tbody) {
        console.error('updateRevisionQueueTable: tbody element not found!');
        return;
    }
    tbody.innerHTML = '';

    if (!queue || queue.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No concepts available</td></tr>';
        return;
    }

    queue.forEach((concept, index) => {
        console.log(`updateRevisionQueueTable: Processing concept ${index + 1}:`, concept.name, 'memory:', concept.memory_strength);
        const daysSinceRevision = currentDay - (concept.last_revised_day || 0);
        const isRevised = recentlyRevisedConcepts.has(concept.id);
        const displayMemory = isRevised ? 1.0 : concept.memory_strength;
        const priority = getPriorityStatus(displayMemory);
        const color = getMemoryColor(displayMemory);
        
        // For revised concepts, use green color to show 100%
        const displayColor = isRevised ? '#32B8C6' : color;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${concept.name}${isRevised ? ' <span style="color: #32B8C6; font-size: 0.85em;">✓ Revised</span>' : ''}</td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="flex: 1; height: 6px; background: var(--color-secondary); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${displayMemory * 100}%; height: 100%; background: ${displayColor};"></div>
                    </div>
                    <span style="color: ${displayColor}; font-weight: 600; min-width: 45px;">${Math.round(displayMemory * 100)}%</span>
                </div>
            </td>
            <td>${daysSinceRevision} days</td>
            <td><span class="status ${priority.class}">${isRevised ? 'Completed' : priority.status}</span></td>
            <td><button class="btn btn--sm btn--primary" data-concept-id="${concept.id}" ${isRevised ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>${isRevised ? 'Revised' : 'Revise'}</button></td>
        `;
        tbody.appendChild(row);
    });
    console.log('updateRevisionQueueTable: Table updated with', queue.length, 'rows');
}

function updatePrerequisiteCheckboxes() {
    const container = document.getElementById('prereqContainer');
    container.innerHTML = '';

    if (concepts.length === 0) {
        container.innerHTML = '<p style="color: var(--color-text-secondary);">No concepts available yet</p>';
        return;
    }

    concepts.forEach(concept => {
        const checkbox = document.createElement('div');
        checkbox.className = 'prereq-checkbox';
        checkbox.innerHTML = `
            <input type="checkbox" id="prereq_${concept.id}" value="${concept.id}">
            <label for="prereq_${concept.id}">${concept.name}</label>
        `;
        container.appendChild(checkbox);
    });
}

// ============================================================================
// VISUALIZATION FUNCTIONS
// ============================================================================

function updateMemoryStrengthChart() {
    if (concepts.length === 0) return;

    const labels = concepts.map(c => c.name);
    const data = concepts.map(c => Math.round(c.memory_strength * 100));
    const colors = concepts.map(c => getMemoryColor(c.memory_strength));

    const ctx = document.getElementById('memoryChart');
    if (!ctx) return;

    // Destroy previous chart if exists
    if (decayChart) {
        decayChart.destroy();
    }

    decayChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Memory Strength (%)',
                data: data,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: true,
                    labels: { color: 'var(--color-text)' }
                }
            },
            scales: {
                x: {
                    max: 100,
                    ticks: { color: 'var(--color-text)' },
                    grid: { color: 'rgba(0,0,0,0.1)' }
                },
                y: {
                    ticks: { color: 'var(--color-text)' },
                    grid: { color: 'rgba(0,0,0,0.1)' }
                }
            }
        }
    });
}

function updateCategoryChart() {
    if (concepts.length === 0) return;

    const categories = {};
    concepts.forEach(c => {
        categories[c.category] = (categories[c.category] || 0) + 1;
    });

    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;

    if (categoryChart) {
        categoryChart.destroy();
    }

    categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(categories),
            datasets: [{
                data: Object.values(categories),
                backgroundColor: [
                    '#FF6384',
                    '#36A2EB',
                    '#FFCE56',
                    '#4BC0C0',
                    '#9966FF',
                    '#FF9F40'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: 'var(--color-text)' }
                }
            }
        }
    });
}

function updateDistributionChart() {
    if (concepts.length === 0) return;

    const urgent = concepts.filter(c => c.memory_strength < 0.3).length;
    const high = concepts.filter(c => c.memory_strength >= 0.3 && c.memory_strength < 0.5).length;
    const medium = concepts.filter(c => c.memory_strength >= 0.5 && c.memory_strength < 0.7).length;
    const low = concepts.filter(c => c.memory_strength >= 0.7).length;

    const ctx = document.getElementById('distributionChart');
    if (!ctx) return;

    if (distributionChart) {
        distributionChart.destroy();
    }

    distributionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Urgent', 'High', 'Medium', 'Low'],
            datasets: [{
                label: 'Concepts by Priority',
                data: [urgent, high, medium, low],
                backgroundColor: ['#C0152F', '#E6815F', '#FFB84D', '#32B8C6'],
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: 'var(--color-text)' }
                }
            },
            scales: {
                y: {
                    ticks: { color: 'var(--color-text)' },
                    grid: { color: 'rgba(0,0,0,0.1)' }
                },
                x: {
                    ticks: { color: 'var(--color-text)' },
                    grid: { color: 'rgba(0,0,0,0.1)' }
                }
            }
        }
    });
}
function updateDependencyGraph() {
    if (concepts.length === 0) return;
    
    const nodes = new vis.DataSet(
        concepts.map(c => ({
            id: c.id,
            label: c.name,
            title: `${c.name} (${Math.round(c.memory_strength * 100)}%)`,
            color: {
                background: getMemoryColor(c.memory_strength),
                border: '#333'
            },
            font: { size: 14 }
        }))
    );
    
    const edges = [];
    concepts.forEach(concept => {
        if (concept.prerequisites && concept.prerequisites.length > 0) {
            concept.prerequisites.forEach(prereq => {
                edges.push({
                    from: prereq,
                    to: concept.id,
                    arrows: 'to'
                });
            });
        }
    });
    
    const edgesData = new vis.DataSet(edges);
    const container = document.getElementById('dependencyGraph');
    if (!container) return;
    
    const data = { nodes: nodes, edges: edgesData };
    const options = {
        physics: { enabled: true, stabilization: { iterations: 200 } },
        nodes: { shape: 'dot', margin: 10, widthConstraint: { maximum: 200 } },
        edges: { smooth: { type: 'continuous' }, color: { inherit: 'from' } }
    };
    
    const network = new vis.Network(container, data, options);
}


function updateAllVisualizations() {
    updateStatistics();
    updateMemoryStrengthChart();
    updateCategoryChart();
    updateDistributionChart();
    updateDependencyGraph();
    updatePrerequisiteCheckboxes();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
    // Decay rate slider
    const decayRateSlider = document.getElementById('decayRate');
    if (decayRateSlider) {
        decayRateSlider.addEventListener('input', (e) => {
            const rate = parseFloat(e.target.value);
            document.getElementById('decayRateValue').textContent = rate.toFixed(2);
            setDecayRateAPI(rate);
        });
    }

    // Simulate time passage
    const simulateBtn = document.getElementById('simulateTimeBtn');
    if (simulateBtn) {
        simulateBtn.addEventListener('click', () => {
            const daysInput = document.getElementById('daysToSimulate');
            const days = daysInput ? daysInput.value : 1;
            simulateTimeAPI(days);
        });
    }

    // Add concept form
    const addConceptForm = document.getElementById('addConceptForm');
    if (addConceptForm) {
        addConceptForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('conceptName')?.value || '';
            const category = document.getElementById('conceptCategory')?.value || '';
            const prereqCheckboxes = document.querySelectorAll('#prereqContainer input[type="checkbox"]:checked');
            const prerequisites = Array.from(prereqCheckboxes).map(cb => cb.value);

            if (name && category) {
                addConceptAPI(name, category, prerequisites);
            }
        });
    }

    // Event delegation for revise buttons (more reliable than inline onclick)
    const revisionQueueBody = document.getElementById('revisionQueueBody');
    if (revisionQueueBody) {
        revisionQueueBody.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn') && e.target.textContent.trim() === 'Revise') {
                const row = e.target.closest('tr');
                if (row) {
                    const conceptId = e.target.getAttribute('data-concept-id');
                    if (conceptId) {
                        reviseConceptAPI(conceptId);
                    }
                }
            }
        });
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener('DOMContentLoaded', async () => {
    console.log('Initializing Memory-Retention Learning System...');
    console.log('API Base:', API_BASE);

    // Try loading from API, fallback to sample data
    await updateAllData();
    setupEventListeners();

    console.log('System initialized successfully!');
});
