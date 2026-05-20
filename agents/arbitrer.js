// =============================================
// LIGHTDROPS v3 - Árbitro Central
// Gestiona múltiples núcleos y decide cuál ejecutar
// En papel: registra, no envía órdenes reales
// =============================================

const fs = require('fs');
const path = require('path');

class Arbitrer {
    constructor(capital = 100, paperMode = true) {
        this.capital = capital;
        this.paperMode = paperMode;
        this.triangles = [];

        // Cartera simulada
        this.portfolio = {
            cash: capital,
            positions: [],
            pnl: 0,
            totalTrades: 0,
            winTrades: 0,
        };

        // Log de operaciones
        this.logPath = path.join(__dirname, '../logs/trades.json');
        this.ensureLogFile();
    }

    addTriangle(triangle) {
        this.triangles.push(triangle);
    }

    ensureLogFile() {
        const dir = path.dirname(this.logPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.logPath)) fs.writeFileSync(this.logPath, '[]');
    }

    // --------------------------------------------
    // CICLO PRINCIPAL
    // --------------------------------------------
    async cycle(threshold) {
        console.log('\n' + '═'.repeat(55));
        console.log(`  LIGHTDROPS v3 | ${new Date().toLocaleTimeString('es-MX')}`);
        console.log(`  Modo: ${this.paperMode ? '📋 PAPER' : '🔴 REAL'} | Capital: $${this.capital.toFixed(2)}`);
        console.log('═'.repeat(55));

        const reports = [];

        for (const tri of this.triangles) {
            console.log(`\n▸ Núcleo ${tri.name}:`);
            try {
                const report = await tri.tick(threshold);
                if (!report) { console.log('  ⚠ Sin reporte'); continue; }

                reports.push(report);
                this.printReport(report);
            } catch (err) {
                console.error(`  ✗ Error en ${tri.id}:`, err.message);
            }
        }

        this.closePositionsIfConverged(reports);
        // Seleccionar la señal más fuerte entre todos los núcleos
        const best = reports
            .filter(r => r.signal !== null)
            .sort((a, b) => b.strength - a.strength)[0];

        if (best) {
            console.log('\n' + '─'.repeat(55));
            console.log(`  🎯 SEÑAL SELECCIONADA: Núcleo ${best.name}`);
            console.log(`  ${best.signal.description}`);
            console.log(`  Z-Score: ${best.zscore.toFixed(3)} | Fuerza: ${best.strength}%`);
            this.executeSignal(best);
        } else {
            console.log('\n  ⏸  Sin señal en este ciclo — mercado en equilibrio');
        }

        this.printPortfolio();
    }

    // --------------------------------------------
    // EJECUCIÓN (PAPER)
    // --------------------------------------------
    executeSignal(report) {
        if (!this.paperMode) {
            console.log('  ⚠ Modo real no implementado aún');
            return;
        }

        const { signal, agents } = report;
        const capitalPerLeg = this.portfolio.cash * 0.3; // 30% por posición

        const openInNucleus = this.portfolio.positions.filter(p => p.status === 'open' && report.agents?.some(a => a.id === p.agentId)).length;
        if (openInNucleus > 0) {
            console.log('  ⏸ Ya hay posiciones abiertas en este núcleo — esperando cierre');
            return;
        }
        if (capitalPerLeg < 1) {
            console.log('  ⚠ Capital insuficiente para abrir posición');
            return;
        }

        // Registrar posiciones
        const positions = [];

        for (const id of signal.long) {
            const agent = agents.find(a => a.id === id);
            if (!agent || !agent.price) continue;
            const pos = {
                id: `${Date.now()}_${id}_LONG`,
                agentId: id,
                symbol: agent.symbol,
                direction: 'LONG',
                entryPrice: agent.price,
                capitalUSD: capitalPerLeg,
                units: capitalPerLeg / agent.price,
                entryTime: new Date().toISOString(),
                status: 'open'
            };
            positions.push(pos);
            this.portfolio.positions.push(pos);
            this.portfolio.cash -= capitalPerLeg;
        }

        for (const id of signal.short) {
            const agent = agents.find(a => a.id === id);
            if (!agent || !agent.price) continue;
            const pos = {
                id: `${Date.now()}_${id}_SHORT`,
                agentId: id,
                symbol: agent.symbol,
                direction: 'SHORT',
                entryPrice: agent.price,
                capitalUSD: capitalPerLeg,
                units: capitalPerLeg / agent.price,
                entryTime: new Date().toISOString(),
                status: 'open'
            };
            positions.push(pos);
            this.portfolio.positions.push(pos);
        }

        this.portfolio.totalTrades++;
        this.logTrade({ signal, positions, nucleus: report.nucleus });

        console.log(`\n  📋 PAPER TRADE registrado:`);
        positions.forEach(p => {
            console.log(`     ${p.direction.padEnd(5)} ${p.symbol.padEnd(10)} @ $${p.entryPrice?.toFixed(2)} | $${p.capitalUSD.toFixed(2)}`);
        });
    }

    // Cerrar posiciones abiertas cuando el z-score regresa a 0
    closePositionsIfConverged(reports) {
        if (this.portfolio.positions.length === 0) return;

        for (const report of reports) {
            if (Math.abs(report.zscore) < 0.5) {
                // Spread convergió → cerrar posiciones de este núcleo
                const toClose = this.portfolio.positions.filter(
                    p => p.status === 'open' && report.agents.some(a => a.id === p.agentId)
                );

                toClose.forEach(pos => {
                    const agent = report.agents.find(a => a.id === pos.agentId);
                    if (!agent) return;
                    const exitPrice = agent.price;
                    const pnl = pos.direction === 'LONG'
                        ? (exitPrice - pos.entryPrice) * pos.units
                        : (pos.entryPrice - exitPrice) * pos.units;
                    pos.status = 'closed';
                    pos.exitPrice = exitPrice;
                    pos.pnl = pnl;
                    this.portfolio.pnl += pnl;
                    this.portfolio.cash += pos.capitalUSD + pnl;
                    if (pnl > 0) this.portfolio.winTrades++;
                    console.log(`  ✓ Posición cerrada: ${pos.symbol} ${pos.direction} | PnL: $${pnl.toFixed(4)}`);
                });
            }
        }
    }

    // --------------------------------------------
    // DISPLAY
    // --------------------------------------------
    printReport(r) {
        const z = r.zscore.toFixed(3);
        const zBar = this.zBar(r.zscore);
        console.log(`  Spread z-score: ${z.padStart(7)} ${zBar}`);

        r.agents.forEach(a => {
            const trend = a.trend === 'up' ? '↑' : a.trend === 'down' ? '↓' : '→';
            console.log(`  ${a.symbol.padEnd(10)} $${(a.price || 0).toFixed(2).padStart(10)} | RSI:${a.rsi} ${trend} conf:${a.confidence}%`);
        });

        if (r.signal) {
            console.log(`  ⚡ SEÑAL [${r.strength}%]: ${r.signal.description}`);
        }
    }

    printPortfolio() {
        const open = this.portfolio.positions.filter(p => p.status === 'open').length;
        console.log('\n' + '─'.repeat(55));
        console.log(`  💼 Cartera | Cash: $${this.portfolio.cash.toFixed(2)} | PnL: $${this.portfolio.pnl.toFixed(4)} | Pos abiertas: ${open} | Trades: ${this.portfolio.totalTrades}`);
        console.log('═'.repeat(55) + '\n');
    }

    zBar(z) {
        const clamped = Math.max(-3, Math.min(3, z));
        const pos = Math.round((clamped + 3) / 6 * 20);
        const bar = '░'.repeat(20).split('');
        bar[10] = '│';
        if (pos >= 0 && pos < 20) bar[pos] = z > 0 ? '▓' : '▒';
        const colors = z > 1.5 ? '▲' : z < -1.5 ? '▼' : ' ';
        return `[${bar.join('')}] ${colors}`;
    }

    logTrade(data) {
        try {
            const trades = JSON.parse(fs.readFileSync(this.logPath, 'utf-8'));
            trades.push({ ...data, timestamp: new Date().toISOString() });
            fs.writeFileSync(this.logPath, JSON.stringify(trades, null, 2));
        } catch (e) { /* no critical */ }
    }
}

module.exports = Arbitrer;
