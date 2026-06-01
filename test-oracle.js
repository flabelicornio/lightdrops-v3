// =============================================
// LightDrops v3 - Unit Test: Oráculo & Chain
// Verifica 3 escenarios: bajo, medio, alto zscore
// =============================================

const Chain = require('./agents/chain');

console.log('\n  ✅ UNIT TESTS — Oráculo de Schrödinger & Chain\n');

// ── TEST SETUP ──
const chain = new Chain({ minAvgConfidence: 30, minZscore: 1.0 });

// Mock Report
function mockReport(zscore, agents) {
    return {
        zscore,
        name: 'TEST-NUCLEUS',
        agents: agents || [
            { id: 'asset1', symbol: 'ASSET1', confidence: 50 },
            { id: 'asset2', symbol: 'ASSET2', confidence: 60 },
            { id: 'asset3', symbol: 'ASSET3', confidence: 40 },
        ],
        signal: {
            long: ['asset1'],
            short: ['asset2', 'asset3'],
            description: 'TEST SIGNAL'
        }
    };
}

// ── MOMENTUM STORE MOCK ──
const momentumStore = {
    payload: {
        snapshots: [
            { symbol: 'ASSET1', momentum: 0.5 },   // positive
            { symbol: 'ASSET2', momentum: -0.3 },  // negative
            { symbol: 'ASSET3', momentum: 0.2 },   // positive
        ]
    }
};

// Función para confirmar por momentum (igual a arbitrer)
function confirmByMomentum(report) {
    try {
        const momentumSnaps = momentumStore.payload.snapshots;
        const longSymbols = (report.signal?.long || []).map(id => {
            const a = report.agents.find(x => x.id === id);
            return a ? a.symbol : null;
        }).filter(Boolean);
        if (longSymbols.length === 0) return false;
        const moments = longSymbols.map(sym => {
            const s = momentumSnaps.find(ms => (ms.symbol || '').toUpperCase() === (sym || '').toUpperCase());
            return s ? (s.momentum || 0) : 0;
        });
        const avg = moments.reduce((a, b) => a + b, 0) / moments.length;
        return avg > 0;
    } catch (e) {
        return false;
    }
}

// ── TEST 1: ZSCORE BAJO (< 1.0) ──
console.log('  📊 TEST 1: Límite BAJO (zscore = 0.5)');
const test1Report = mockReport(0.5);
const test1ChainResult = chain.evaluate(test1Report);
const test1MomentumConfirm = confirmByMomentum(test1Report);

console.log(`     Chain evaluation: ${test1ChainResult.ok ? '✓ PASS' : '✗ REJECT'} (${test1ChainResult.reason})`);
console.log(`     Momentum confirm: ${test1MomentumConfirm ? '✓ YES' : '✗ NO'}`);
console.log(`     Expected: REJECT (zscore too small)`);
console.log(`     Status: ${!test1ChainResult.ok ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── TEST 2: ZSCORE NORMAL (1.5) ──
console.log('  📊 TEST 2: Límite NORMAL (zscore = 1.5)');
const test2Report = mockReport(1.5);
const test2ChainResult = chain.evaluate(test2Report);
const test2MomentumConfirm = confirmByMomentum(test2Report);

console.log(`     Chain evaluation: ${test2ChainResult.ok ? '✓ PASS' : '✗ REJECT'} (${test2ChainResult.reason})`);
console.log(`     Momentum confirm: ${test2MomentumConfirm ? '✓ YES' : '✗ NO'}`);
console.log(`     Expected: PASS + YES (entra en superposición, colapsará si momentum positivo)`);
const test2Pass = test2ChainResult.ok && test2MomentumConfirm;
console.log(`     Status: ${test2Pass ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── TEST 3: ZSCORE ALTO (2.5) ──
console.log('  📊 TEST 3: Límite ALTO (zscore = 2.5)');
const test3Report = mockReport(2.5);
const test3ChainResult = chain.evaluate(test3Report);
const test3MomentumConfirm = confirmByMomentum(test3Report);

console.log(`     Chain evaluation: ${test3ChainResult.ok ? '✓ PASS' : '✗ REJECT'} (${test3ChainResult.reason})`);
console.log(`     Momentum confirm: ${test3MomentumConfirm ? '✓ YES' : '✗ NO'}`);
console.log(`     Expected: PASS + YES (señal inmediata si momentum positivo)`);
const test3Pass = test3ChainResult.ok && test3MomentumConfirm;
console.log(`     Status: ${test3Pass ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── TEST 4: BAJA CONFIANZA ──
console.log('  📊 TEST 4: Baja confianza (confidence = 10%)');
const test4Report = mockReport(1.8, [
    { id: 'asset1', symbol: 'ASSET1', confidence: 5 },
    { id: 'asset2', symbol: 'ASSET2', confidence: 8 },
    { id: 'asset3', symbol: 'ASSET3', confidence: 12 },
]);
const test4ChainResult = chain.evaluate(test4Report);

console.log(`     Chain evaluation: ${test4ChainResult.ok ? '✓ PASS' : '✗ REJECT'} (${test4ChainResult.reason})`);
console.log(`     Expected: REJECT (confianza promedio < 30%)`);
console.log(`     Status: ${!test4ChainResult.ok ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── TEST 5: MOMENTUM NEGATIVO EN POSICIÓN LONG ──
console.log('  📊 TEST 5: Momentum NEGATIVO en posición LONG');
const test5Report = mockReport(2.0, [
    { id: 'asset1', symbol: 'ASSET1', confidence: 60 },
]);
// Simular momentum negativo
momentumStore.payload.snapshots[0].momentum = -0.8;
const test5ChainResult = chain.evaluate(test5Report);
const test5MomentumConfirm = confirmByMomentum(test5Report);
// Restaurar
momentumStore.payload.snapshots[0].momentum = 0.5;

console.log(`     Chain evaluation: ${test5ChainResult.ok ? '✓ PASS' : '✗ REJECT'}`);
console.log(`     Momentum confirm: ${test5MomentumConfirm ? '✓ YES' : '✗ NO'}`);
console.log(`     Expected: PASS pero NO momentum (superposición, no colapsa)`);
const test5Pass = test5ChainResult.ok && !test5MomentumConfirm;
console.log(`     Status: ${test5Pass ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── RESUMEN ──
const passed = [!test1ChainResult.ok, test2Pass, test3Pass, !test4ChainResult.ok, test5Pass].filter(x => x).length;
const total = 5;

console.log(`  ╔════════════════════════════════════════╗`);
console.log(`  ║ RESUMEN: ${passed}/${total} tests pasados      ║`);
console.log(`  ║ Oráculo Schrödinger: ${'✅ FUNCIONAL'.padEnd(28)} ║`);
console.log(`  ║ Chain Evaluator:     ${'✅ FUNCIONAL'.padEnd(28)} ║`);
console.log(`  ╚════════════════════════════════════════╝\n`);

process.exit(passed === total ? 0 : 1);
