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
        this.signal = null;      // null | 'LONG_A' | 'LONG_B' | 'LONG_C' | 'SHORT_A' etc.
        this.strength = 0;       // 0-100 fuerza de la señal
        this.active = true;

        // Métricas de performance
        this.totalSignals = 0;
        this.cycleCount = 0;
    }

    // --------------------------------------------
    // CALCULAR SPREAD TRIANGULAR
    // Mide la desviación del equilibrio entre los 3 activos
    // Principio: si A, B, C están correctamente valorados entre sí,
    // el ratio A*C / B debe ser constante. Cuando se desvía → oportunidad.
    // --------------------------------------------
    calcTriangleSpread(priceA, priceB, priceC) {
        if (!priceA || !priceB || !priceC) return null;
        // Ratio normalizado: relación cruzada de los tres
        const r_ab = priceB / priceA;
        const r_bc = priceC / priceB;
        const r_ac = priceC / priceA;
        // El spread es qué tan lejos está el triángulo de cerrarse
        return (r_ab * r_bc) / r_ac;
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

        // Actualizar los 3 agentes en paralelo
        const results = await Promise.all(this.agents.map(a => a.tick()));
        if (results.some(r => !r)) {
            console.warn(`  [${this.id}] Datos incompletos en algún agente`);
            return null;
        }

        const [snapA, snapB, snapC] = this.agents.map(a => a.snapshot());

        // Calcular spread triangular
        const spread = this.calcTriangleSpread(snapA.price, snapB.price, snapC.price);
        if (!spread) return null;

        this.spread = spread;
        this.spreadHistory.push(spread);
        if (this.spreadHistory.length > this.MAX_HISTORY) {
            this.spreadHistory.shift();
        }

        // Z-score del spread actual vs historia
        this.zscore = this.calcZScore(spread, this.spreadHistory);

        // Determinar señal
        this.signal = null;
        this.strength = 0;

        const absZ = Math.abs(this.zscore);

        if (absZ >= threshold) {
            this.totalSignals++;

            // Identificar cuál activo está desalineado
            // z > 0: B sobrevaluado vs A y C → SHORT B, LONG A y C
            // z < 0: B subvaluado vs A y C  → LONG B, SHORT A y C
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

            // Fuerza = combinación de z-score + confianza media de los agentes
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
