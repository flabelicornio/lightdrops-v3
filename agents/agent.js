// =============================================
// LIGHTDROPS v3 - Agente Base (Neurona)
// Motor de análisis heredado de LightDrops v1/v2
// Cada agente monitorea UN activo
// =============================================

class Agent {
    constructor(id, symbol, fetchFn) {
        this.id = id;
        this.symbol = symbol;
        this.fetchFn = fetchFn;   // función async que retorna data feed
        this.data = null;

        // Estado del agente
        this.rsi = 50;
        this.trend = 'neutral';   // 'up' | 'down' | 'neutral'
        this.momentum = 0;        // z-score de precio vs historia reciente
        this.confidence = 0;      // 0-100, score LightDrops
        this.weight = 1.0;        // peso dinámico del árbitro

        // Registro de aciertos para ajustar peso
        this.hits = 0;
        this.misses = 0;
        this.signals = [];        // historial de señales emitidas
    }

    // --------------------------------------------
    // ANÁLISIS TÉCNICO (motor LightDrops)
    // --------------------------------------------

    calcRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50;
        let gains = 0, losses = 0;
        for (let i = prices.length - period; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff >= 0) gains += diff;
            else losses += Math.abs(diff);
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return Math.round(100 - (100 / (1 + rs)));
    }

    calcMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
    }

    calcZScore(value, history) {
        if (history.length < 5) return 0;
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        const std = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length);
        if (std === 0) return 0;
        return (value - mean) / std;
    }

    calcVolAvg(volumes, period = 12) {
        return volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
    }

    // --------------------------------------------
    // TICK: actualizar estado del agente
    // --------------------------------------------
    async tick() {
        this.data = await this.fetchFn(this.symbol);
        if (!this.data || this.data.prices.length < 20) {
            console.warn(`  [${this.id}] Sin datos suficientes`);
            return false;
        }

        const { prices, volumes, current, currentVolume } = this.data;

        // RSI
        this.rsi = this.calcRSI(prices);

        // Medias móviles
        const ma7  = this.calcMA(prices, 7);
        const ma20 = this.calcMA(prices, 20);
        this.trend = ma7 > ma20 ? 'up' : ma7 < ma20 ? 'down' : 'neutral';

        // Z-score de precio (momentum)
        this.momentum = this.calcZScore(current, prices.slice(-20));

        // Volumen confirma?
        const volAvg = this.calcVolAvg(volumes);
        const volConfirm = currentVolume >= volAvg * 1.5;

        // Ruptura de máximo reciente
        const max24 = Math.max(...prices.slice(-25));
        const breakout = current > max24;
        const noiseFilter = breakout
            ? prices.slice(-3).every(p => p >= max24)
            : false;

        // Score de confianza (sistema LightDrops)
        let score = 0;
        if (breakout)      score += 25;
        if (noiseFilter)   score += 15;
        if (volConfirm)    score += 20;
        if (this.rsi >= 40 && this.rsi <= 70) score += 15;
        if (this.trend === 'up') score += 15;

        this.confidence = score;

        return true;
    }

    // Estado resumido para el triángulo/árbitro
    snapshot() {
        return {
            id: this.id,
            symbol: this.symbol,
            price: this.data?.current,
            rsi: this.rsi,
            trend: this.trend,
            momentum: this.momentum,
            confidence: this.confidence,
            weight: this.weight,
            source: this.data?.source
        };
    }

    // El árbitro llama esto para actualizar el peso dinámico
    recordOutcome(wasCorrect) {
        if (wasCorrect) this.hits++;
        else this.misses++;
        const total = this.hits + this.misses;
        if (total > 0) {
            const rate = this.hits / total;
            this.weight = Math.max(0.2, Math.min(2.0, rate * 2));
        }
    }
}

module.exports = Agent;
