// =============================================
// LIGHTDROPS v3 - Oráculo de Schrödinger
// La señal triangular entra en superposición.
// El momentum la "observa" cada ciclo.
// Si el score colapsa → boost a la Colony.
// Si expira → se disuelve sin ejecutar nada.
// =============================================

class ChainOracle {
    constructor(opts = {}) {
        this.THRESHOLD  = opts.threshold  || 65;  // score mínimo para colapsar
        this.MAX_CYCLES = opts.maxCycles  || 3;   // ciclos antes de expirar

        this.state = {
            status:  'idle',   // 'idle' | 'superposition'
            pending: null,     // reporte triangular en espera
            score:   0,        // 0-100
            cycles:  0,
        };

        this.history = [];     // registro de colapsos/expiraciones
    }

    // ── ENTRAR EN SUPERPOSICIÓN ──
    // Recibe el mejor reporte del motor triangular.
    // La señal existe pero no se ejecuta — está en superposición.
    enter(report) {
        if (this.state.status !== 'idle') return false;
        if (!report?.signal) return false;

        // Semilla inicial: 25% de la fuerza triangular
        const seed = Math.round(report.strength * 0.25);

        this.state = {
            status:  'superposition',
            pending: report,
            score:   seed,
            cycles:  0,
        };

        console.log('\n' + '─'.repeat(55));
        console.log('  🌀 ORÁCULO DE SCHRÖDINGER — SUPERPOSICIÓN');
        console.log(`  Señal: ${report.signal.description}`);
        console.log(`  Z-Score: ${report.zscore.toFixed(3)} | Fuerza: ${report.strength}%`);
        console.log(`  Score semilla: ${seed} / ${this.THRESHOLD}`);
        return true;
    }

    // ── OBSERVAR CON MOMENTUM ──
    // Recibe snapshots de la Colony. Cada leg de la señal
    // se chequea contra el momentum actual.
    // Retorna el reporte si colapsa, null si sigue en superposición o expiró.
    observe(momentumSnapshots = []) {
        if (this.state.status !== 'superposition') return null;

        this.state.cycles++;
        const signal = this.state.pending.signal;

        // Contar legs alineados con la señal triangular
        let agree = 0, total = 0;

        for (const id of (signal.long || [])) {
            const snap = momentumSnapshots.find(s => s.id === id);
            if (snap) { total++; if (snap.momentum > 0.05) agree++; }
        }
        for (const id of (signal.short || [])) {
            const snap = momentumSnapshots.find(s => s.id === id);
            if (snap) { total++; if (snap.momentum < -0.05) agree++; }
        }

        // Actualizar score: alineación perfecta +35, contradicción -15
        const alignment = total > 0 ? agree / total : 0.5;
        const delta = alignment >= 0.5
            ? (alignment * 35)
            : -(1 - alignment) * 15;

        this.state.score = Math.max(0, Math.min(100, this.state.score + delta));

        // Display
        const filled   = Math.round(this.state.score / 100 * 20);
        const bar      = '█'.repeat(filled) + '░'.repeat(20 - filled);
        const pct      = this.state.score.toFixed(1);
        const legLabel = total > 0 ? `${agree}/${total} legs` : 'sin overlap';

        console.log('\n' + '─'.repeat(55));
        console.log(`  🌀 ORÁCULO [Ciclo ${this.state.cycles}/${this.MAX_CYCLES}] — ${legLabel} alineados`);
        console.log(`  Señal: ${signal.description}`);
        console.log(`  Score: [${bar}] ${pct} / ${this.THRESHOLD}`);

        // ── COLAPSO ──
        if (this.state.score >= this.THRESHOLD) {
            console.log('  ⚡ ¡ONDA COLAPSADA! — señal confirmada por momentum');
            const report = this.state.pending;
            this._reset('collapsed');
            return report;
        }

        // ── EXPIRACIÓN ──
        if (this.state.cycles >= this.MAX_CYCLES) {
            console.log('  💨 Señal expirada — onda no colapsó');
            this._reset('expired');
            return null;
        }

        console.log('  ⏳ En superposición — esperando próximo ciclo...');
        return null;
    }

    // ── ESTADO PÚBLICO ──
    status() {
        return this.state.status;
    }

    snapshot() {
        return {
            status:   this.state.status,
            score:    this.state.score,
            cycles:   this.state.cycles,
            signal:   this.state.pending?.signal?.description || null,
            history:  this.history.slice(-5),
        };
    }

    _reset(reason) {
        this.history.push({
            reason,
            score:  this.state.score,
            signal: this.state.pending?.signal?.description,
            ts:     new Date().toISOString(),
        });
        this.state = { status: 'idle', pending: null, score: 0, cycles: 0 };
    }
}

module.exports = ChainOracle;
