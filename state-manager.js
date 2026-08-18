// =============================================
// LIGHTDROPS v3 - State Manager (FIXED)
// Persistencia de estado + posiciones abiertas
// =============================================

const fs   = require('fs');
const path = require('path');

// ── PATHS ──
const DATA_DIR     = path.join(__dirname, 'data', 'persistence');
const STATE_FILE   = path.join(DATA_DIR, 'state.json');
const TRADES_FILE  = path.join(DATA_DIR, 'trades.json');
const SPREADS_FILE = path.join(DATA_DIR, 'spreads.json');

// Crear directorio si no existe
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// =============================================
// BACKEND LOCAL JSON
// =============================================
const LocalJSON = {
    name: 'LocalJSON',

    saveState(state) {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
            return true;
        } catch (e) {
            console.error('  [state] Error guardando estado:', e.message);
            return false;
        }
    },

    loadState() {
        try {
            if (!fs.existsSync(STATE_FILE)) return null;
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {
            console.error('  [state] Error cargando estado:', e.message);
            return null;
        }
    },

    appendTrade(trade) {
        try {
            const trades = this.loadTrades();
            trades.push(trade);
            fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
            return true;
        } catch (e) {
            console.error('  [state] Error guardando trade:', e.message);
            return false;
        }
    },

    loadTrades() {
        try {
            if (!fs.existsSync(TRADES_FILE)) return [];
            return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        } catch (e) {
            return [];
        }
    },

    appendSpread(entry) {
        try {
            const spreads = this.loadSpreads();
            spreads.push(entry);
            // Mantener solo últimos 10,000 puntos
            if (spreads.length > 10000) spreads.splice(0, spreads.length - 10000);
            fs.writeFileSync(SPREADS_FILE, JSON.stringify(spreads, null, 2));
            return true;
        } catch (e) {
            return false;
        }
    },

    loadSpreads() {
        try {
            if (!fs.existsSync(SPREADS_FILE)) return [];
            return JSON.parse(fs.readFileSync(SPREADS_FILE, 'utf8'));
        } catch (e) {
            return [];
        }
    },
};

// =============================================
// STATE MANAGER
// =============================================
class StateManager {
    constructor() {
        this.backend = LocalJSON;
    }

    // ── GUARDAR ESTADO COMPLETO ──
    save(state) {
        this.backend.saveState(state);
    }

    // ── CARGAR ESTADO AL ARRANCAR ──
    load() {
        const state = this.backend.loadState();
        if (state) {
            console.log(`  [state] Estado restaurado: ${state.savedAt || 'fecha desconocida'}`);
            console.log(`  [state] Cash: $${state.portfolio?.cash?.toFixed(2) || 0} | PnL: $${state.portfolio?.pnl?.toFixed(2) || 0}`);
            console.log(`  [state] Posiciones abiertas: ${state.openPositions?.length || 0}`);
        } else {
            console.log('  [state] Sin estado previo — arrancando desde cero');
        }
        return state;
    }

    // ── REGISTRAR TRADE ──
    recordTrade(trade) {
        const enriched = { ...trade, timestamp: new Date().toISOString() };
        this.backend.appendTrade(enriched);
        return enriched;
    }

    // ── REGISTRAR SPREADS ──
    recordSpreads(nucleos) {
        const ts = new Date().toISOString();
        for (const n of nucleos) {
            this.backend.appendSpread({
                ts,
                nucleus: n.name,
                zscore:  n.zscore || 0,
                spread:  n.zscore || 0,
                signal:  n.signal ? JSON.stringify(n.signal) : '',
            });
        }
    }

    // ── CONSTRUIR ESTADO PARA GUARDAR ──
    buildSnapshot(arbitrer, nucleoMacro, nucleoCrypto) {
        const openPositions = (arbitrer.portfolio?.positions || [])
            .filter(p => p.status === 'open');

        return {
            savedAt: new Date().toISOString(),
            portfolio: {
                cash:        arbitrer.portfolio?.cash ?? 0,
                pnl:         arbitrer.portfolio?.pnl ?? 0,
                totalTrades: arbitrer.portfolio?.totalTrades ?? 0,
                winTrades:   arbitrer.portfolio?.winTrades ?? 0,
            },
            openPositions: openPositions,          // ← ahora sí guardamos las abiertas
            spreadHistories: {
                macro:  nucleoMacro.spreadHistory  || [],
                crypto: nucleoCrypto.spreadHistory || [],
            },
            agentWeights: {
                oil: nucleoMacro.agents[0]?.weight ?? 1,
                dxy: nucleoMacro.agents[1]?.weight ?? 1,
                spy: nucleoMacro.agents[2]?.weight ?? 1,
                btc: nucleoCrypto.agents[0]?.weight ?? 1,
                eth: nucleoCrypto.agents[1]?.weight ?? 1,
                qqq: nucleoCrypto.agents[2]?.weight ?? 1,
            },
        };
    }

    // ── RESTAURAR ESTADO EN OBJETOS ──
    restore(state, arbitrer, nucleoMacro, nucleoCrypto) {
        if (!state) return;

        // Restaurar portfolio
        if (state.portfolio && arbitrer.portfolio) {
            arbitrer.portfolio.cash        = state.portfolio.cash        ?? arbitrer.portfolio.cash;
            arbitrer.portfolio.pnl         = state.portfolio.pnl         ?? 0;
            arbitrer.portfolio.totalTrades = state.portfolio.totalTrades ?? 0;
            arbitrer.portfolio.winTrades   = state.portfolio.winTrades   ?? 0;
        }

        // Restaurar posiciones abiertas
        if (state.openPositions && Array.isArray(state.openPositions)) {
            arbitrer.portfolio.positions = state.openPositions.map(p => ({
                ...p,
                status: 'open'   // por seguridad
            }));
            console.log(`  [state] Restauradas ${state.openPositions.length} posiciones abiertas`);
        }

        // Restaurar historia de spreads
        if (state.spreadHistories) {
            if (state.spreadHistories.macro?.length) {
                nucleoMacro.spreadHistory = state.spreadHistories.macro;
                console.log(`  [state] Macro history: ${nucleoMacro.spreadHistory.length} puntos`);
            }
            if (state.spreadHistories.crypto?.length) {
                nucleoCrypto.spreadHistory = state.spreadHistories.crypto;
                console.log(`  [state] Crypto history: ${nucleoCrypto.spreadHistory.length} puntos`);
            }
        }

        // Restaurar pesos de agentes
        if (state.agentWeights) {
            const w = state.agentWeights;
            if (w.oil) nucleoMacro.agents[0].weight  = w.oil;
            if (w.dxy) nucleoMacro.agents[1].weight  = w.dxy;
            if (w.spy) nucleoMacro.agents[2].weight  = w.spy;
            if (w.btc) nucleoCrypto.agents[0].weight = w.btc;
            if (w.eth) nucleoCrypto.agents[1].weight = w.eth;
            if (w.qqq) nucleoCrypto.agents[2].weight = w.qqq;
        }
    }

    // ── STATS RÁPIDOS ──
    stats() {
        const trades = this.backend.loadTrades();
        return {
            trades: trades.length,
        };
    }
}

module.exports = new StateManager();
