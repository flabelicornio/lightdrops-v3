// =============================================
// LIGHTDROPS v3 - Chain evaluator
// Capa de doble certeza: valida señales triangulares
// antes de permitir que el Oráculo las considere.
// =============================================

class Chain {
    constructor(opts = {}) {
        this.minAvgConfidence = opts.minAvgConfidence || 30; // %
        this.minZscore = opts.minZscore || 1.0; // absolute zscore
    }

    // Evalúa un reporte triangular y devuelve { ok, reason }
    evaluate(report) {
        if (!report) return { ok: false, reason: 'no report' };

        const absZ = Math.abs(report.zscore || 0);
        if (absZ < this.minZscore) return { ok: false, reason: `zscore too small (${absZ.toFixed(3)})` };

        const agents = report.agents || [];
        if (agents.length === 0) return { ok: false, reason: 'no agents' };

        const avgConf = agents.reduce((s, a) => s + (a.confidence || 0), 0) / agents.length;
        if (avgConf < this.minAvgConfidence) return { ok: false, reason: `low confidence (${avgConf.toFixed(1)}%)` };

        // Si pasa todas las comprobaciones básicas, aprobar
        return { ok: true, reason: 'chain ok', meta: { avgConf, absZ } };
    }
}

module.exports = Chain;
