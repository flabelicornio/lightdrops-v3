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
        if (!this.data
