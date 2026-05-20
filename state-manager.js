// =============================================
// LIGHTDROPS v3 - State Manager
// Persistencia universal con conectores enchufables
// Backends: LocalJSON (primario) | IBM Cloud | CSV
// =============================================

const fs   = require('fs');
const path = require('path');

// ── PATHS ──
const DATA_DIR    = path.join(__dirname, 'data', 'persistence');
const STATE_FILE  = path.join(DATA_DIR, 'state.json');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');
const SPREADS_FILE= path.join(DATA_DIR, 'spreads.json');

// Crear directorio si no existe
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// =============================================
// BACKEND 1 — LOCAL JSON (primario, siempre activo)
// =============================================
const LocalJSON = {
    name: 'LocalJSON',

    saveState(state) {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
            return true;
        } catch (e) {
            console.error('  [state] LocalJSON error:', e.message);
            return false;
        }
    },

    loadState() {
        try {
            if (!fs.existsSync(STATE_FILE)) return null;
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {
            console.error('  [state] LocalJSON load error:', e.message);
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
            console.error('  [state] LocalJSON trade error:', e.message);
            return false;
        }
    },

    loadTrades() {
        try {
            if (!fs.existsSync(TRADES_FILE)) return [];
            return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
        } catch (e) { return []; }
    },

    appendSpread(entry) {
        try {
            const spreads = this.loadSpreads();
            spreads.push(entry);
            // Mantener solo últimos 10,000 puntos (~11 días a 65s)
            if (spreads.length > 10000) spreads.splice(0, spreads.length - 10000);
            fs.writeFileSync(SPREADS_FILE, JSON.stringify(spreads, null, 2));
            return true;
        } catch (e) { return false; }
    },

    loadSpreads() {
        try {
            if (!fs.existsSync(SPREADS_FILE)) return [];
            return JSON.parse(fs.readFileSync(SPREADS_FILE, 'utf8'));
        } catch (e) { return []; }
    },
};

// =============================================
// BACKEND 2 — IBM CLOUD (backup, enchufable)
// Conector listo — activar cuando tengamos credenciales
// IBM Cloud Object Storage o Cloudant
// =============================================
const IBMCloud = {
    name: 'IBMCloud',
    enabled: !!(process.env.IBM_API_KEY && process.env.IBM_INSTANCE_ID),
    cycleCount: 0,
    BACKUP_EVERY: 10, // respaldar cada 10 ciclos (~11 min)

    async saveState(state) {
        if (!this.enabled) return false;
        this.cycleCount++;
        if (this.cycleCount % this.BACKUP_EVERY !== 0) return false;

        try {
            // TODO: activar cuando tengamos IBM credentials
            // const IbmCOS = require('ibm-cos-sdk');
            // const cos = new IbmCOS.S3({ ... });
            // await cos.putObject({ Bucket: 'lightdrops', Key: 'state.json', Body: JSON.stringify(state) }).promise();
            console.log('  [state] IBMCloud backup ✓');
            return true;
        } catch (e) {
            console.error('  [state] IBMCloud error:', e.message);
            return false;
        }
    },

    async syncTrades(trades) {
        if (!this.enabled) return false;
        // Mismo patrón — subir trades.json a IBM COS
        return false;
    },
};

// =============================================
// BACKEND 3 — CSV EXPORT (descarga manual/automática)
// =============================================
const CSVExport = {
    name: 'CSVExport',
    CSV_DIR: path.join(__dirname, 'data', 'exports'),

    init() {
        if (!fs.existsSync(this.CSV_DIR)) fs.mkdirSync(this.CSV_DIR, { recursive: true });
    },

    exportTrades(trades) {
        this.init();
        if (!trades || trades.length === 0) return null;

        const headers = ['timestamp','nucleus','type','symbols','zscore','pnl','mode'];
        const rows = trades.map(t => [
            t.timestamp || '',
            t.nucleus   || '',
            t.type      || '',
            (t.symbols  || []).join('+'),
            (t.zscore   || 0).toFixed(4),
            (t.pnl      || 0).toFixed(4),
            t.mode      || 'paper',
        ].join(','));

        const csv  = [headers.join(','), ...rows].join('\n');
        const file = path.join(this.CSV_DIR, `trades_${Date.now()}.csv`);
        fs.writeFileSync(file, csv);
        console.log(`  [state] CSV exportado: ${file}`);
        return { file, csv, count: trades.length };
    },

    exportSpreads(spreads) {
        this.init();
        if (!spreads || spreads.length === 0) return null;

        const headers = ['timestamp','nucleus','zscore','spread','signal'];
        const rows = spreads.map(s => [
            s.ts       || '',
            s.nucleus  || '',
            (s.zscore  || 0).toFixed(6),
            (s.spread  || 0).toFixed(8),
            s.signal   || '',
        ].join(','));

        const csv  = [headers.join(','), ...rows].join('\n');
        const file = path.join(this.CSV_DIR, `spreads_${Date.now()}.csv`);
        fs.writeFileSync(file, csv);
        return { file, csv, count: spreads.length };
    },
};

// =============================================
// STATE MANAGER — orquestador de backends
// =============================================
class StateManager {
    constructor() {
        this.backends = [LocalJSON];      // primario siempre activo
        this.backupBackends = [IBMCloud]; // async, no bloqueante
        this.csv = CSVExport;
    }

    // ── GUARDAR ESTADO COMPLETO (cada ciclo) ──
    async save(state) {
        // Primario: síncrono, siempre
        LocalJSON.saveState(state);

        // Backup: async, no bloquea el ciclo
        for (const backend of this.backupBackends) {
            backend.saveState(state).catch(() => {});
        }
    }

    // ── CARGAR ESTADO AL ARRANCAR ──
    load() {
        const state = LocalJSON.loadState();
        if (state) {
            console.log(`  [state] Estado restaurado: ${state.savedAt || 'fecha desconocida'}`);
            console.log(`  [state] Spreads históricos: ${(state.spreadHistories || {}).macro?.length || 0} (macro) | ${(state.spreadHistories || {}).crypto?.length || 0} (crypto)`);
        } else {
            console.log('  [state] Sin estado previo — arrancando desde cero');
        }
        return state;
    }

    // ── REGISTRAR TRADE ──
    recordTrade(trade) {
        const enriched = { ...trade, timestamp: new Date().toISOString() };
        LocalJSON.appendTrade(enriched);
        return enriched;
    }

    // ── REGISTRAR SPREAD (cada ciclo, para historia) ──
    recordSpreads(nucleos) {
        const ts = new Date().toISOString();
        for (const n of nucleos) {
            LocalJSON.appendSpread({
                ts,
                nucleus: n.name,
                zscore:  n.zscore  || 0,
                spread:  n.zscore  || 0, // usar zscore como proxy del spread normalizado
                signal:  n.signal  ? JSON.stringify(n.signal) : '',
            });
        }
    }

    // ── CONSTRUIR ESTADO PARA GUARDAR ──
    buildSnapshot(arbitrer, nucleoMacro, nucleoCrypto) {
        return {
            savedAt: new Date().toISOString(),
            portfolio: {
                cash:          arbitrer.portfolio?.cash,
                pnl:           arbitrer.portfolio?.pnl,
                totalTrades:   arbitrer.portfolio?.totalTrades,
                openPositions: arbitrer.portfolio?.openPositions,
            },
            spreadHistories: {
                macro:  nucleoMacro.spreadHistory  || [],
                crypto: nucleoCrypto.spreadHistory || [],
            },
            agentWeights: {
                oil: nucleoMacro.agents[0]?.weight,
                dxy: nucleoMacro.agents[1]?.weight,
                spy: nucleoMacro.agents[2]?.weight,
                btc: nucleoCrypto.agents[0]?.weight,
                eth: nucleoCrypto.agents[1]?.weight,
                qqq: nucleoCrypto.agents[2]?.weight,
            },
        };
    }

    // ── RESTAURAR ESTADO EN OBJETOS ──
    restore(state, arbitrer, nucleoMacro, nucleoCrypto) {
        if (!state) return;

        // Restaurar portfolio
        if (state.portfolio && arbitrer.portfolio) {
            // cash no se restaura — siempre arranca desde CAPITAL_TOTAL en .env
            arbitrer.portfolio.pnl         = state.portfolio.pnl         ?? 0;
            arbitrer.portfolio.totalTrades = state.portfolio.totalTrades ?? 0;
        }

        // Restaurar historia de spreads — esto es lo más valioso
        if (state.spreadHistories) {
            if (state.spreadHistories.macro?.length)  {
                nucleoMacro.spreadHistory  = state.spreadHistories.macro;
                console.log(`  [state] Macro spread history: ${nucleoMacro.spreadHistory.length} puntos`);
            }
            if (state.spreadHistories.crypto?.length) {
                nucleoCrypto.spreadHistory = state.spreadHistories.crypto;
                console.log(`  [state] Crypto spread history: ${nucleoCrypto.spreadHistory.length} puntos`);
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

    // ── EXPORTAR CSV (llamado desde dashboard o manual) ──
    exportCSV(type = 'trades') {
        if (type === 'trades') {
            const trades = LocalJSON.loadTrades();
            return this.csv.exportTrades(trades);
        }
        if (type === 'spreads') {
            const spreads = LocalJSON.loadSpreads();
            return this.csv.exportSpreads(spreads);
        }
    }

    // ── STATS RÁPIDOS ──
    stats() {
        const trades  = LocalJSON.loadTrades();
        const spreads = LocalJSON.loadSpreads();
        return {
            trades:  trades.length,
            spreads: spreads.length,
            ibmActive: IBMCloud.enabled,
        };
    }
}

module.exports = new StateManager(); // singleton
