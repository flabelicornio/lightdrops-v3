// =============================================
// LIGHTDROPS v3 - Núcleo F: Momentum Flow
// Agentes hormiga — capital fluye hacia el
// activo con mayor momentum ascendente.
// Filosofía: cada gota cae hacia el mar más rápido.
// =============================================

require('dotenv').config();
const { fetchBinance, fetchTwelveData, fetchCoinGecko } = require('./data/feeds');

// ── CONFIGURACIÓN DE LA COLONIA ──
const ASSETS = [
    { id: 'btc',  symbol: 'BTCUSDT', fetch: (s) => fetchCoinGecko(s),          type: 'crypto' },
    { id: 'eth',  symbol: 'ETHUSDT', fetch: (s) => fetchCoinGecko(s),          type: 'crypto' },
    { id: 'spy',  symbol: 'SPY',     fetch: (s) => fetchTwelveData(s, '5min'), type: 'etf'    },
    { id: 'qqq',  symbol: 'QQQ',     fetch: (s) => fetchTwelveData(s, '5min'), type: 'etf'    },
    { id: 'uso',  symbol: 'USO',     fetch: (s) => fetchTwelveData(s, '5min'), type: 'etf'    },
    { id: 'uup',  symbol: 'UUP',     fetch: (s) => fetchTwelveData(s, '5min'), type: 'etf'    },
];

// ── HORMIGA (MomentumAgent) ──
class MomentumAgent {
    constructor(config) {
        this.id       = config.id;
        this.symbol   = config.symbol;
        this.fetchFn  = config.fetch;
        this.type     = config.type;

        // Estado
        this.prices       = [];    // historial de precios
        this.momentum     = 0;     // % cambio en últimos N ciclos
        this.momentum5    = 0;     // momentum corto (5 ciclos)
        this.momentum20   = 0;     // momentum largo (20 ciclos)
        this.velocity     = 0;     // aceleración del momentum
        this.confidence   = 0;     // confianza 0-100
        this.capital      = 0;     // capital asignado por la colonia
        this.lastPrice    = null;
        this.source       = 'unknown';
    }

    async tick() {
        try {
            const data = await this.fetchFn(this.symbol);
            if (!data || !data.prices || data.prices.length < 5) return false;

            this.prices   = data.prices.slice(-50);
            this.lastPrice = data.current;
            this.source   = data.source;

            this.calcMomentum();
            return true;
        } catch (e) {
            console.error(`  [${this.id}] Error:`, e.message);
            return false;
        }
    }

    calcMomentum() {
        const p = this.prices;
        if (p.length < 5) return;

        const last  = p[p.length - 1];
        const ago5  = p[Math.max(0, p.length - 5)];
        const ago20 = p[Math.max(0, p.length - 20)];

        this.momentum5  = (last - ago5)  / ago5  * 100;
        this.momentum20 = (last - ago20) / ago20 * 100;

        // Momentum combinado — pesa más el reciente
        this.momentum = this.momentum5 * 0.7 + this.momentum20 * 0.3;

        // Velocidad = aceleración del momentum (segunda derivada)
        if (p.length >= 6) {
            const ago1 = p[p.length - 2];
            const ago2 = p[p.length - 3];
            const m1 = (last - ago1) / ago1 * 100;
            const m2 = (ago1 - ago2) / ago2 * 100;
            this.velocity = m1 - m2; // positivo = acelerando
        }

        // Confianza: momentum consistente + acelerando
        let conf = 0;
        if (Math.abs(this.momentum5)  > 0.1) conf += 25;
        if (Math.abs(this.momentum20) > 0.2) conf += 25;
        if (this.velocity > 0 && this.momentum > 0) conf += 30;
        if (this.velocity < 0 && this.momentum < 0) conf += 30;
        if (Math.abs(this.momentum) > 1.0) conf += 20;
        this.confidence = Math.min(100, conf);
    }

    snapshot() {
        return {
            id:         this.id,
            symbol:     this.symbol,
            price:      this.lastPrice,
            momentum:   this.momentum,
            momentum5:  this.momentum5,
            momentum20: this.momentum20,
            velocity:   this.velocity,
            confidence: this.confidence,
            capital:    this.capital,
            source:     this.source,
            type:       this.type,
        };
    }
}

// ── COLONIA ──
class Colony {
    constructor(totalCapital = 1000, paperMode = true) {
        this.capital    = totalCapital;
        this.paperMode  = paperMode;
        this.agents     = ASSETS.map(a => new MomentumAgent(a));
        this.cycleCount = 0;
        this.flowHistory = []; // historial de flujos de capital

        // Portfolio
        this.portfolio = {
            cash:        totalCapital,
            positions:   {},  // { agentId: { capital, entryPrice, entryMomentum } }
            pnl:         0,
            totalFlows:  0,
        };

        console.log(`  [colony] Iniciando con ${this.agents.length} agentes · $${totalCapital}`);
    }

    // ── TICK PRINCIPAL ──
    async tick() {
        this.cycleCount++;
        console.log(`\n${'═'.repeat(55)}`);
        console.log(`  MOMENTUM FLOW | Ciclo ${this.cycleCount} | ${new Date().toLocaleTimeString('es-MX')}`);
        console.log(`  Capital: $${this.capital.toFixed(2)} | Cash: $${this.portfolio.cash.toFixed(2)}`);
        console.log('═'.repeat(55));

        // Actualizar todos los agentes en paralelo
        const results = await Promise.all(this.agents.map(a => a.tick()));
        const active  = this.agents.filter((a, i) => results[i]);

        if (active.length < 2) {
            console.log('  ⚠ Menos de 2 agentes activos — esperando datos');
            return null;
        }

        // Mostrar estado de cada agente
        console.log('\n  ESTADO DE LA COLONIA:');
        console.log('  ' + '─'.repeat(53));

        const snapshots = active.map(a => a.snapshot());

        snapshots.sort((a, b) => b.momentum - a.momentum).forEach(s => {
            const bar   = this.momentumBar(s.momentum);
            const arrow = s.momentum > 0.1 ? '▲' : s.momentum < -0.1 ? '▼' : '→';
            const cap   = s.capital > 0 ? ` 💰$${s.capital.toFixed(0)}` : '';
            console.log(`  ${s.symbol.padEnd(8)} ${arrow} ${bar} ${s.momentum >= 0 ? '+' : ''}${s.momentum.toFixed(3)}% vel:${s.velocity >= 0 ? '+' : ''}${s.velocity.toFixed(3)}${cap}`);
        });

        // Decidir flujo de capital
        const flowDecision = this.decideFlow(snapshots);
        this.executeFlow(flowDecision, snapshots);

        this.printPortfolio();
        return { snapshots, flowDecision, cycleCount: this.cycleCount };
    }

    // ── DECISIÓN DE FLUJO ──
    decideFlow(snapshots) {
        // Ordenar por momentum descendente
        const ranked = [...snapshots].sort((a, b) => b.momentum - a.momentum);

        const best  = ranked[0];   // mayor momentum
        const worst = ranked[ranked.length - 1]; // menor momentum

        // Solo fluir si hay diferencia significativa
        const spread = best.momentum - worst.momentum;

        if (spread < 0.2) {
            return { action: 'HOLD', reason: 'spread insuficiente', spread };
        }

        if (best.momentum <= 0) {
            return { action: 'CASH', reason: 'todos en negativo — refugio en cash', best, worst };
        }

        return {
            action:  'FLOW',
            from:    worst,
            to:      best,
            spread,
            reason:  `${best.symbol} (+${best.momentum.toFixed(3)}%) supera a ${worst.symbol} (${worst.momentum.toFixed(3)}%)`,
        };
    }

    // ── EJECUTAR FLUJO ──
    executeFlow(decision, snapshots) {
        console.log('\n  DECISIÓN DE FLUJO:');

        if (decision.action === 'HOLD') {
            console.log(`  ⏸ HOLD — ${decision.reason} (spread: ${decision.spread.toFixed(4)}%)`);
            return;
        }

        if (decision.action === 'CASH') {
            console.log(`  🛡 CASH — ${decision.reason}`);
            // Cerrar todas las posiciones
            this.closeAll(snapshots);
            return;
        }

        if (decision.action === 'FLOW') {
            console.log(`  ⚡ FLOW: ${decision.reason}`);

            // Cerrar posición en el activo con menor momentum
            const worstAgent = this.agents.find(a => a.id === decision.from.id);
            if (this.portfolio.positions[decision.from.id]) {
                this.closePosition(decision.from.id, decision.from.price, snapshots);
            }

            // Abrir posición en el activo con mayor momentum
            const capitalToFlow = this.portfolio.cash * 0.3; // 80% del cash disponible
            if (capitalToFlow >= 1 && decision.to.momentum > 0 && !this.portfolio.positions[decision.to.id]) {
                this.openPosition(decision.to.id, decision.to.price, capitalToFlow);
                this.portfolio.totalFlows++;
            }
        }
    }

    openPosition(agentId, price, capital) {
        if (!price || price <= 0) return;
        this.portfolio.positions[agentId] = {
            capital,
            entryPrice:    price,
            entryTime:     new Date().toISOString(),
            units:         capital / price,
        };
        this.portfolio.cash -= capital;

        const agent = this.agents.find(a => a.id === agentId);
        if (agent) agent.capital = capital;

        console.log(`  📈 LONG ${agentId.toUpperCase()} @ $${price.toFixed(4)} · $${capital.toFixed(2)} invertidos`);
    }

    closePosition(agentId, currentPrice, snapshots) {
        const pos = this.portfolio.positions[agentId];
        if (!pos || !currentPrice) return;

        const pnl = (currentPrice - pos.entryPrice) * pos.units;
        this.portfolio.pnl  += pnl;
        this.portfolio.cash += pos.capital + pnl;

        const agent = this.agents.find(a => a.id === agentId);
        if (agent) agent.capital = 0;

        delete this.portfolio.positions[agentId];

        const sign = pnl >= 0 ? '+' : '';
        console.log(`  📉 CIERRE ${agentId.toUpperCase()} @ $${currentPrice.toFixed(4)} | PnL: ${sign}$${pnl.toFixed(4)}`);
    }

    closeAll(snapshots) {
        const ids = Object.keys(this.portfolio.positions);
        ids.forEach(id => {
            const snap = snapshots.find(s => s.id === id);
            if (snap) this.closePosition(id, snap.price, snapshots);
        });
    }

    printPortfolio() {
        const openCount = Object.keys(this.portfolio.positions).length;
        const sign      = this.portfolio.pnl >= 0 ? '+' : '';
        console.log('\n' + '─'.repeat(55));
        console.log(`  💼 Cash: $${this.portfolio.cash.toFixed(2)} | PnL: ${sign}$${this.portfolio.pnl.toFixed(4)} | Pos: ${openCount} | Flujos: ${this.portfolio.totalFlows}`);
        console.log('═'.repeat(55) + '\n');
    }

    momentumBar(m) {
        const clamped = Math.max(-2, Math.min(2, m));
        const pos     = Math.round((clamped + 2) / 4 * 12);
        const bar     = '░'.repeat(12).split('');
        bar[6]        = '│';
        if (pos >= 0 && pos < 12) bar[pos] = m > 0 ? '▓' : '▒';
        return `[${bar.join('')}]`;
    }
}

module.exports = { Colony, MomentumAgent };

// ── STANDALONE: node momentum-flow.js ──
if (require.main === module) {
    const CYCLE = parseInt(process.env.CYCLE_INTERVAL || '65000');
    const colony = new Colony(
        parseFloat(process.env.CAPITAL_TOTAL || '1000'),
        process.env.PAPER_MODE !== 'false'
    );

    async function run() {
        await colony.tick();
        setInterval(async () => {
            try { await colony.tick(); }
            catch(e) { console.error('Error en ciclo:', e.message); }
        }, CYCLE);
    }

    run().catch(console.error);
}
