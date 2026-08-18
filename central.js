// =============================================
// LIGHTDROPS v3 - Orquestador Central (FIXED)
// + WebSocket server en puerto 8080
// =============================================

require('dotenv').config();

const Agent    = require('./agents/agent');
const Triangle = require('./agents/triangle');
const Arbitrer = require('./agents/arbitrer');
const { fetchBinance, fetchTwelveData } = require('./data/feeds');
const http     = require('http');
const stateManager = require('./state-manager');
const { WebSocketServer } = require('ws');

const PAPER_MODE     = process.env.PAPER_MODE !== 'false';
const CAPITAL        = parseFloat(process.env.CAPITAL_TOTAL    || '1000');
const CYCLE_INTERVAL = parseInt(process.env.CYCLE_INTERVAL     || '65000');
const THRESHOLD      = parseFloat(process.env.SIGNAL_THRESHOLD || '1.8');
const WS_PORT        = parseInt(process.env.WS_PORT            || '8080');
const RUN_ONCE       = process.argv.includes('--once');

// =============================================
// WEBSOCKET SERVER
// =============================================
const server  = http.createServer();
const wss     = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`  [ws] Cliente conectado (total: ${clients.size})`);
    if (lastState) ws.send(JSON.stringify(lastState));
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`  [ws] Cliente desconectado (total: ${clients.size})`);
    });
});

server.listen(WS_PORT, () => {
    console.log(`  [ws] WebSocket escuchando en puerto ${WS_PORT}`);
});

let lastState = null;

function broadcast(data) {
    lastState = data;
    const msg = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === 1) client.send(msg);
    }
}

// =============================================
// DEFINIR AGENTES
// =============================================
const agentOil = new Agent('oil', 'USO',     (sym) => fetchTwelveData(sym, '5min'));
const agentDXY = new Agent('dxy', 'UUP',     (sym) => fetchTwelveData(sym, '5min'));
const agentSPY = new Agent('spy', 'SPY',     (sym) => fetchTwelveData(sym, '5min'));

const agentBTC = new Agent('btc', 'BTCUSDT', (sym) => fetchBinance(sym));
const agentETH = new Agent('eth', 'ETHUSDT', (sym) => fetchBinance(sym));
const agentQQQ = new Agent('qqq', 'QQQ',     (sym) => fetchTwelveData(sym, '5min'));

// =============================================
// NÚCLEOS TRIANGULARES
// =============================================
const nucleoMacro  = new Triangle('macro',  'Macro  USO↔UUP↔SPY', agentOil, agentDXY, agentSPY);
const nucleoCrypto = new Triangle('crypto', 'Crypto BTC↔ETH↔QQQ',  agentBTC, agentETH, agentQQQ);

// =============================================
// ÁRBITRO CENTRAL
// =============================================
const arbitrer = new Arbitrer(CAPITAL, PAPER_MODE);
arbitrer.addTriangle(nucleoMacro);
arbitrer.addTriangle(nucleoCrypto);

// =============================================
// RECOLECTAR ESTADO PARA WEBSOCKET
// =============================================
function collectState(signal) {
    const now = new Date();
    const openPositions = (arbitrer.portfolio?.positions || []).filter(p => p.status === 'open').length;

    const buildNucleo = (triangle, agents) => ({
        name:   triangle.name,
        label:  triangle.name,
        zscore: triangle.zscore || 0,
        assets: agents.map(a => ({
            id:         a.id,
            symbol:     a.symbol,
            price:      a.data?.current || 0,
            rsi:        a.rsi || 0,
            confidence: a.confidence || 0,
            direction:  a.trend || '—',
            source:     a.data?.source || 'unknown'
        })),
    });

    return {
        ts:      now.toISOString(),
        time:    now.toLocaleTimeString('es-MX'),
        mode:    PAPER_MODE ? 'PAPER' : 'REAL',
        capital: CAPITAL,
        portfolio: {
            cash:          arbitrer.portfolio?.cash ?? CAPITAL,
            pnl:           arbitrer.portfolio?.pnl ?? 0,
            openPositions: openPositions,
            totalTrades:   arbitrer.portfolio?.totalTrades ?? 0,
            winTrades:     arbitrer.portfolio?.winTrades ?? 0,
        },
        nucleos: [
            buildNucleo(nucleoMacro,  [agentOil, agentDXY, agentSPY]),
            buildNucleo(nucleoCrypto, [agentBTC, agentETH, agentQQQ]),
        ],
        signal: signal || null,
    };
}

// =============================================
// LOOP PRINCIPAL
// =============================================
async function runCycle() {
    const signal = await arbitrer.cycle(THRESHOLD);
    const state  = collectState(signal);
    broadcast(state);
    stateManager.recordSpreads(state.nucleos);
    stateManager.save(stateManager.buildSnapshot(arbitrer, nucleoMacro, nucleoCrypto));
    return state;
}

async function main() {
    console.log('\n');
    console.log('  ██╗     ██╗ ██████╗ ██╗  ██╗████████╗');
    console.log('  ██║     ██║██╔════╝ ██║  ██║╚══██╔══╝');
    console.log('  ██║     ██║██║  ███╗███████║   ██║   ');
    console.log('  ██║     ██║██║   ██║██╔══██║   ██║   ');
    console.log('  ███████╗██║╚██████╔╝██║  ██║   ██║   ');
    console.log('  ╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ');
    console.log('  DROPS v3 — Multi-Agent Triangular Arb\n');
    console.log(`  Capital: $${CAPITAL} | Modo: ${PAPER_MODE ? 'PAPER 📋' : 'REAL 🔴'}`);
    console.log(`  Umbral señal: ${THRESHOLD}σ | Ciclo: ${CYCLE_INTERVAL / 1000}s`);
    console.log(`  WebSocket: ws://localhost:${WS_PORT}\n`);

    if (RUN_ONCE) {
        await runCycle();
        process.exit(0);
    }

    const savedState = stateManager.load();
    stateManager.restore(savedState, arbitrer, nucleoMacro, nucleoCrypto);
    await runCycle();

    const interval = setInterval(async () => {
        try {
            await runCycle();
        } catch (err) {
            console.error('Error en ciclo:', err.message);
        }
    }, CYCLE_INTERVAL);

    process.on('SIGINT', () => {
        console.log('\n\n  ⏹  Deteniendo LightDrops v3...');
        clearInterval(interval);
        server.close();
        console.log(`  PnL final: $${arbitrer.portfolio?.pnl?.toFixed(4)}`);
        console.log(`  Trades: ${arbitrer.portfolio?.totalTrades}`);
        process.exit(0);
    });
}

main().catch(console.error);
