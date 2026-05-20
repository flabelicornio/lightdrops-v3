// =============================================
// LIGHTDROPS v3 - Núcleo Triangular
// Coordina 3 agentes y detecta ineficiencias
// =============================================

class Triangle {
    constructor(id, name, agentA, agentB, agentC) {
        this.id = id;
        this.name = name;
        this.agents = [agentA, agentB, agentC];

        // Historia del spread triangular
        this.spreadHistory = [];
        this.MAX_HISTORY = 60;

        // Estado actual
        this.spread = null;
        this.zscore = 0;
        this.signal = null;
        this.strength = 0;
        this.active = true;

        // Métricas de performance
        this.totalSignals = 0;
        this.cycleCount = 0;
    }

    // --------------------------------------------
    // CALCULAR SPREAD TRIANGULAR
    // Usa log-ratio para capturar desalineación real
    // entre los 3 activos. La fórmula anterior
    // (r_ab * r_bc) / r_ac era una identidad = 1 siempre.
    // Log-space: logA - 2*logB + logC mide la curvatura
    // del triángulo — 0 = equilibrio, ≠0 = oportunidad.
    // --------------------------------------------
    calcTriangleSpread(priceA, priceB, priceC) {
        if (!priceA || !priceB || !priceC) return null;
        const logA = Math.log(priceA);
        const logB = Math.log(priceB);
        const logC = Math.log(priceC);
        return logA - 2 * logB + logC;
    }

    calcZScore(value, history) {
        if (history.length < 10) return 0;
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        const std = Math.sqrt(
            history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length
        );
        if (std < 1e-10) return 0;
        return (value - mean) / std;
    }

    // --------------------------------------------
    // TICK: evaluar el triángulo
    // --------------------------------------------
    async tick(threshold = 1.5) {
        this.cycleCount++;

        const results = await Promise.all(this.agents.map(a => a.tick()));
        if (results.some(r => !r)) {
            console.warn(`  [${this.id}] Datos incompletos en algún agente`);
            return null;
        }

        const [snapA, snapB, snapC] = this.agents.map(a => a.snapshot());

        const spread = this.calcTriangleSpread(snapA.price, snapB.price, snapC.price);
        if (spread === null) return null;

        this.spread = spread;
        this.spreadHistory.push(spread);
        if (this.spreadHistory.length > this.MAX_HISTORY) {
            this.spreadHistory.shift();
        }

        this.zscore = this.calcZScore(spread, this.spreadHistory);

        this.signal = null;
        this.strength = 0;

        const absZ = Math.abs(this.zscore);

        if (absZ >= threshold) {
            this.totalSignals++;

            if (this.zscore > 0) {
                this.signal = {
                    type: 'LONG_AC_SHORT_B',
                    long:  [snapA.id, snapC.id],
                    short: [snapB.id],
                    description: `${snapA.symbol}+${snapC.symbol} LARGO / ${snapB.symbol} CORTO`,
                    zscore: this.zscore
                };
            } else {
                this.signal = {
                    type: 'LONG_B_SHORT_AC',
                    long:  [snapB.id],
                    short: [snapA.id, snapC.id],
                    description: `${snapB.symbol} LARGO / ${snapA.symbol}+${snapC.symbol} CORTO`,
                    zscore: this.zscore
                };
            }

            const avgConf = (snapA.confidence + snapB.confidence + snapC.confidence) / 3;
            this.strength = Math.min(100, Math.round(
                (Math.min(absZ, 3) / 3) * 60 + (avgConf / 100) * 40
            ));
        }

        return this.report(snapA, snapB, snapC);
    }

    report(snapA, snapB, snapC) {
        return {
            nucleus: this.id,
            name: this.name,
            spread: this.spread,
            zscore: this.zscore,
            signal: this.signal,
            strength: this.strength,
            agents: [snapA, snapB, snapC],
            cycleCount: this.cycleCount,
            totalSignals: this.totalSignals
        };
    }
}

module.exports = Triangle;
