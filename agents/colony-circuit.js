// =============================================
// LIGHTDROPS v3 - Colony Circuit
// Circuito viral de colonias de momentum.
// Cada colonia opera con su propio universo de activos.
// La mejor recibe el bono del oráculo de Schrödinger.
// Cuando una colonia acumula suficiente → genera hija.
// momentum-flow.js no se toca.
// =============================================

const { Colony, MomentumAgent } = require('../momentum-flow');
const { fetchBinance, fetchDpricebit } = require('../data/feeds');

const MAX_COLONIES    = parseInt(process.env.MAX_COLONIES     || '5');
const SPAWN_THRESHOLD = parseFloat(process.env.SPAWN_THRESHOLD || '0.05'); // 5% PnL → spawn

// ── PLANTILLAS ──
// Cada plantilla define un universo de activos especializado
const TEMPLATES = {
    crypto: {
        label: 'Crypto α',
        assets: [
            { id: 'btc', symbol: 'BTCUSDT', fetch: (s) => fetchBinance(s),   type: 'crypto' },
            { id: 'eth', symbol: 'ETHUSDT', fetch: (s) => fetchBinance(s),   type: 'crypto' },
        ],
    },
    etf: {
        label: 'ETF β',
        assets: [
            { id: 'spy', symbol: 'SPY', fetch: (s) => fetchDpricebit(s), type: 'etf' },
            { id: 'qqq', symbol: 'QQQ', fetch: (s) => fetchDpricebit(s), type: 'etf' },
        ],
    },
    macro: {
        label: 'Macro γ',
        assets: [
            { id: 'uso', symbol: 'USO', fetch: (s) => fetchDpricebit(s), type: 'etf' },
            { id: 'uup', symbol: 'UUP', fetch: (s) => fetchDpricebit(s), type: 'etf' },
        ],
    },
};

// ── COLONIA FLEXIBLE ──
// Extiende Colony sin tocar momentum-flow.js.
// Solo sobreescribe this.agents con los de la plantilla elegida.
class FlexColony extends Colony {
    constructor(templateKey, capital, paperMode, generation = 1) {
        super(capital, paperMode);
        const tmpl      = TEMPLATES[templateKey];
        this.label      = `${tmpl.label}${generation > 1 ? ' g' + generation : ''}`;
        this.templateKey = templateKey;
        this.generation  = generation;
        this.spawnedAt   = null;

        // Sobreescribir agents del padre con los de esta plantilla
        this.agents = tmpl.assets.map(a => new MomentumAgent(a));
    }
}

// ── CIRCUITO ──
class ColonyCircuit {
    constructor(baseCapital = 1000, paperMode = true) {
        this.baseCapital = baseCapital;
        this.paperMode   = paperMode;
        this.entries     = [];  // [{ id, colony }]
        this.cycleCount  = 0;
        this._nextId     = 1;

        // Tres colonias base, capital dividido en tercios
        const share = Math.floor(baseCapital / 3);
        this._spawn('crypto', share);
        this._spawn('etf',    share);
        this._spawn('macro',  share);

        console.log(`  [circuit] Circuito listo: ${this.entries.length} colonias · $${baseCapital}`);
    }

    // ── CREAR COLONIA ──
    _spawn(templateKey, capital, generation = 1) {
        if (this.entries.length >= MAX_COLONIES) return null;
        const colony = new FlexColony(templateKey, capital, this.paperMode, generation);
        const entry  = { id: this._nextId++, colony };
        this.entries.push(entry);
        console.log(`  [circuit] +Colony #${entry.id} ${colony.label} · $${capital.toFixed(2)}`);
        return entry;
    }

    // ── TICK DEL CIRCUITO ──
    // Secuencial para no saturar las APIs
    async tick() {
        this.cycleCount++;
        const results = [];

        for (const entry of this.entries) {
            try {
                const r = await entry.colony.tick();
                results.push({ id: entry.id, label: entry.colony.label, result: r });
            } catch (e) {
                console.error(`  [circuit] Colony #${entry.id} error:`, e.message);
                results.push({ id: entry.id, label: entry.colony.label, result: null });
            }
        }

        this._checkSpawning();
        this._printSummary();
        return results;
    }

    // ── BONO SORPRESA (oráculo colapsó) ──
    // Busca la colonia positiva más alineada con la señal
    // e inyecta capital extra. El centavo que empuja todo.
    boost(collapsedReport) {
        if (!collapsedReport?.signal) return;

        const longIds = collapsedReport.signal.long  || [];

        // Candidatas: colonias con PnL positivo que tengan algún asset en la señal
        const candidates = this.entries
            .filter(e => e.colony.portfolio.pnl > 0)
            .filter(e => e.colony.agents.some(a => longIds.includes(a.id)))
            .sort((a, b) => b.colony.portfolio.pnl - a.colony.portfolio.pnl);

        if (candidates.length === 0) {
            console.log('  🎰 Bono sorpresa: ninguna colonia positiva alineada — se acumula para el siguiente ciclo');
            return;
        }

        const winner     = candidates[0];
        const boostCash  = winner.colony.portfolio.cash * 0.15;
        if (boostCash < 1) return;

        console.log(`\n  🎰 BONO SORPRESA → #${winner.id} ${winner.colony.label} (PnL +$${winner.colony.portfolio.pnl.toFixed(2)})`);

        for (const id of longIds) {
            const agent = winner.colony.agents.find(a => a.id === id);
            if (!agent?.lastPrice) continue;

            if (winner.colony.portfolio.positions[id]) {
                console.log(`  📌 ${id.toUpperCase()} ya en posición — bono se suma`);
            } else {
                winner.colony.openPosition(id, agent.lastPrice, boostCash);
                console.log(`  ⚡ Bonus LONG ${id.toUpperCase()} · $${boostCash.toFixed(2)}`);
            }
        }
    }

    // ── SPAWN VIRAL ──
    // Colonia que alcanza umbral de ganancia → genera hija con parte de sus ganancias
    _checkSpawning() {
        for (const entry of this.entries) {
            const pnl       = entry.colony.portfolio.pnl;
            const threshold = entry.colony.capital * SPAWN_THRESHOLD;

            if (pnl >= threshold && !entry.colony.spawnedAt && this.entries.length < MAX_COLONIES) {
                entry.colony.spawnedAt = new Date().toISOString();
                const seed = pnl * 0.5; // la hija arranca con 50% de las ganancias

                console.log(`\n  🦠 SPAWN VIRAL: #${entry.id} ${entry.colony.label}`);
                console.log(`     +$${pnl.toFixed(2)} ≥ umbral $${threshold.toFixed(2)} → nueva colonia con $${seed.toFixed(2)}`);

                this._spawn(entry.colony.templateKey, seed, entry.colony.generation + 1);
            }
        }
    }

    // ── MÉTRICAS ──
    totalPnL()  { return this.entries.reduce((s, e) => s + e.colony.portfolio.pnl,  0); }
    totalCash() { return this.entries.reduce((s, e) => s + e.colony.portfolio.cash, 0); }

    snapshot() {
        return this.entries.map(e => ({
            id:      e.id,
            label:   e.colony.label,
            pnl:     e.colony.portfolio.pnl,
            cash:    e.colony.portfolio.cash,
            flows:   e.colony.portfolio.totalFlows,
            openPos: Object.keys(e.colony.portfolio.positions).length,
            gen:     e.colony.generation,
        }));
    }

    _printSummary() {
        const total = this.totalPnL();
        const sign  = total >= 0 ? '+' : '';
        console.log('\n' + '━'.repeat(55));
        console.log(`  🌐 CIRCUITO [${this.entries.length}/${MAX_COLONIES} colonias] | Total: ${sign}$${total.toFixed(4)}`);
        for (const e of this.entries) {
            const p   = e.colony.portfolio.pnl;
            const s   = p >= 0 ? '+' : '';
            const pos = Object.keys(e.colony.portfolio.positions).length;
            console.log(`     #${e.id} ${e.colony.label.padEnd(14)} ${s}$${p.toFixed(2).padStart(8)} | pos:${pos}`);
        }
        console.log('━'.repeat(55) + '\n');
    }
}

module.exports = { ColonyCircuit, FlexColony, TEMPLATES };
