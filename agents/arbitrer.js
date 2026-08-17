// =============================================
// LIGHTDROPS v3 - Árbitro Central (FIXED)
// - Cierre de posiciones funcional
// - Risk management básico
// - Detección de datos simulados
// =============================================

const fs = require('fs');
const path = require('path');

class Arbitrer {
    constructor(capital = 1000, paperMode = true) {
        this.capital = capital;
        this.paperMode = paperMode;
        this.triangles = [];

        this.portfolio = {
            cash: capital,
            positions: [],
            pnl: 0,
            totalTrades: 0,
            winTrades: 0,
        };

        // Risk parameters
        this.MAX_OPEN_POSITIONS = 9;          // máximo 3 trades completos (3 legs c/u)
        this.RISK_PER_TRADE = 0.12;           // 12% del cash disponible por trade completo
        this.MIN_CAPITAL_PER_LEG = 5;         // mínimo por pata
        this.CLOSE_ZSCORE_THRESHOLD = 0.6;    // cerrar cuando |z| < 0.6
        this.MAX_HOLD_HOURS = 36;             // force-close después de 36h

        this.logPath = path.join(__dirname, '../data/persistence/trades.json');
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
        console.log(`  Modo: ${this.paperMode ? '📋 PAPER' : '🔴 REAL'} | Cash: $${this.portfolio.cash.toFixed(2)}`);
        console.log('═'.repeat(55));

        const reports = [];

        for (const tri of this.triangles) {
            console.log(`\n▸ Núcleo ${tri.name}:`);
            try {
                const report = await tri.tick(threshold);
                if (!report) {
                    console.log('  ⚠ Sin reporte');
                    continue;
                }
                reports.push(report);
                this.printReport(report);
            } catch (err) {
                console.error(`  ✗ Error en ${tri.id}:`, err.message);
            }
        }

        // 1. Primero intentar cerrar posiciones que hayan convergido o expirado
        this.closePositionsIfConverged(reports);
        this.forceCloseOldPositions(reports);

        // 2. Luego evaluar nueva señal
        const best = reports
            .filter(r => r.signal !== null)
            .sort((a, b) => b.strength - a.strength)[0];

        if (best) {
            // Evitar abrir si ya tenemos demasiadas posiciones abiertas
            const openCount = this.portfolio.positions.filter(p => p.status === 'open').length;
            if (openCount >= this.MAX_OPEN_POSITIONS) {
                console.log(`\n  ⏸  Máximo de posiciones abiertas alcanzado (${openCount}/${this.MAX_OPEN_POSITIONS})`);
            } else {
                console.log('\n' + '─'.repeat(55));
                console.log(`  🎯 SEÑAL SELECCIONADA: Núcleo ${best.name}`);
                console.log(`  ${best.signal.description}`);
                console.log(`  Z-Score: ${best.zscore.toFixed(3)} | Fuerza: ${best.strength
