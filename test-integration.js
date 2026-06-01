// =============================================
// LightDrops v3 - Integration Test: Full Flow
// Simula: Momentum → Central → Arbitrer → Oracle
// =============================================

const Chain = require('./agents/chain');

console.log('\n  🔗 INTEGRATION TEST — Full Flow Simulation\n');

// ── MOCK COMPONENTS ──

class MockTriangle {
    constructor(name) {
        this.name = name;
        this.zscore = 0;
        this.agents = [
            { id: 'a1', symbol: 'ASSET1', confidence: 50, price: 100 },
            { id: 'a2', symbol: 'ASSET2', confidence: 60, price: 200 },
            { id: 'a3', symbol: 'ASSET3', confidence: 40, price: 300 },
        ];
    }

    tick() {
        // Use fixed high zscore for testing (ensures it crosses thresholds)
        this.zscore = 2.0;
        return {
            name: this.name,
            nucleus: this.name,
            zscore: this.zscore,
            agents: this.agents,
            signal: Math.abs(this.zscore) > 1.5 ? {
                long: ['a1'],
                short: ['a2', 'a3'],
                description: `TEST SIGNAL ${this.zscore > 0 ? 'LONG' : 'SHORT'}`
            } : null,
            strength: Math.min(100, Math.round((Math.abs(this.zscore) / 3) * 100))
        };
    }
}

class MockArbitrer {
    constructor() {
        this.chain = new Chain();
        this.pendingSignals = [];
        this.executedSignals = [];
        this.portfolio = { cash: 100, pnl: 0, positions: {}, totalTrades: 0 };
    }

    process(triangleReport, momentumStore) {
        // 1. Chain evaluation
        const chainRes = this.chain.evaluate(triangleReport);
        if (!chainRes.ok) return null;

        // 2. Confirm by momentum
        const confirmed = this.confirmByMomentum(triangleReport, momentumStore);
        
        if (!confirmed) {
            // Enter superposition
            this.pendingSignals.push({ report: triangleReport, attempts: 1 });
            return { status: 'SUPERPOSITION', zscore: triangleReport.zscore };
        }

        // 3. Execute
        this.executedSignals.push(triangleReport);
        this.portfolio.totalTrades++;
        return { status: 'EXECUTED', zscore: triangleReport.zscore, trades: this.portfolio.totalTrades };
    }

    confirmByMomentum(report, momentumStore) {
        if (!momentumStore) return false;
        const longSymbols = (report.signal?.long || []).map(id => {
            const a = report.agents.find(x => x.id === id);
            return a ? a.symbol : null;
        }).filter(Boolean);
        if (!longSymbols.length) return false;
        const moments = longSymbols.map(sym => {
            const s = (momentumStore.snapshots || []).find(ms => (ms.symbol || '').toUpperCase() === sym.toUpperCase());
            return s ? (s.momentum || 0) : 0;
        });
        if (!moments.length) return false;
        const avg = moments.reduce((a, b) => a + b, 0) / moments.length;
        return avg > 0;
    }
}

// ── MOCK MOMENTUM DATA ──
const momentumSnapshots = [
    { id: 'a1', symbol: 'ASSET1', momentum: 0.6, confidence: 50 },
    { id: 'a2', symbol: 'ASSET2', momentum: -0.2, confidence: 40 },
    { id: 'a3', symbol: 'ASSET3', momentum: 0.3, confidence: 60 },
];

// ── SCENARIO 1: POSITIVE MOMENTUM (Collapse) ──
console.log('  🎬 SCENARIO 1: Positive Momentum (Collapse)\n');

const tri1 = new MockTriangle('macro');
const arb1 = new MockArbitrer();

// Simulate 5 cycles
let results1 = [];
for (let i = 0; i < 5; i++) {
    const report = tri1.tick();
    const result = arb1.process(report, { snapshots: momentumSnapshots });
    results1.push(result);
    if (result) {
        console.log(`  Ciclo ${i + 1}: zscore=${report.zscore.toFixed(3)}, status=${result.status}`);
    }
}

const collapsed1 = arb1.executedSignals.length > 0;
console.log(`\n  Expected: Señal colapsa a EXECUTED (momentum positivo)\n  Result: ${collapsed1 ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── SCENARIO 2: NEGATIVE MOMENTUM (Superposition) ──
console.log('  🎬 SCENARIO 2: Negative Momentum (Stays in Superposition)\n');

const tri2 = new MockTriangle('crypto');
const arb2 = new MockArbitrer();
const momentumNegative = [
    { id: 'a1', symbol: 'ASSET1', momentum: -0.8, confidence: 50 },  // ← NEGATIVE
    { id: 'a2', symbol: 'ASSET2', momentum: -0.2, confidence: 40 },
    { id: 'a3', symbol: 'ASSET3', momentum: -0.3, confidence: 60 },
];

for (let i = 0; i < 5; i++) {
    const report = tri2.tick();
    const result = arb2.process(report, { snapshots: momentumNegative });
    if (result) {
        console.log(`  Ciclo ${i + 1}: zscore=${report.zscore.toFixed(3)}, status=${result.status}`);
    }
}

const inSuperposition2 = arb2.pendingSignals.length > 0 && arb2.executedSignals.length === 0;
console.log(`\n  Expected: Señal permanece en SUPERPOSITION (momentum negativo)\n  Result: ${inSuperposition2 ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── SCENARIO 3: CHAIN REJECTION (Low Confidence) ──
console.log('  🎬 SCENARIO 3: Chain Rejection (Low Confidence)\n');

const tri3 = new MockTriangle('mixed');
const arb3 = new MockArbitrer();

// Override agents with low confidence
tri3.agents = [
    { id: 'a1', symbol: 'ASSET1', confidence: 5, price: 100 },    // ← LOW
    { id: 'a2', symbol: 'ASSET2', confidence: 8, price: 200 },    // ← LOW
    { id: 'a3', symbol: 'ASSET3', confidence: 12, price: 300 },   // ← LOW
];

let rejectedByChain = 0;
for (let i = 0; i < 5; i++) {
    const report = tri3.tick();
    const result = arb3.process(report, { snapshots: momentumSnapshots });
    if (result === null) rejectedByChain++;
}

console.log(`  Ciclos rechazados por Chain: ${rejectedByChain}/5`);
console.log(`\n  Expected: Todos rechazados (confianza < 30%)\n  Result: ${rejectedByChain === 5 ? '✅ CORRECTO' : '❌ FALLO'}\n`);

// ── SUMMARY ──
const allPass = collapsed1 && inSuperposition2 && rejectedByChain === 5;

console.log(`  ╔════════════════════════════════════════╗`);
console.log(`  ║ INTEGRATION TEST: ${allPass ? '✅ PASS' : '❌ FAIL'}           ║`);
console.log(`  ║ Scenario 1 (Collapse):  ${collapsed1 ? '✅ CORRECTO' : '❌ FALLO'}        ║`);
console.log(`  ║ Scenario 2 (Superpos):  ${inSuperposition2 ? '✅ CORRECTO' : '❌ FALLO'}        ║`);
console.log(`  ║ Scenario 3 (Reject):    ${rejectedByChain === 5 ? '✅ CORRECTO' : '❌ FALLO'}        ║`);
console.log(`  ╚════════════════════════════════════════╝\n`);

process.exit(allPass ? 0 : 1);
