// =============================================
// LIGHTDROPS v3 - Orquestador Encadenado v2
// TEST FILE — no modifica central.js
//
// Arquitectura:
//   1. Colony.tick()  → momentum snapshots
//   2. Arbitrer.cycle() + ChainOracle → detecta señal triangular
//      y la pone en superposición
//   3. Oracle.observe(snapshots) → si colapsa: boostColony()
//
// El centavo que entra empuja todo lo que ya está ganando.
// =============================================

require('dotenv').config();

const Agent       = require('./agents/agent');
const Triangle    = require('./agents/triangle');
const Arbitrer    = require('./agents/arbitrer');
const ChainOracle = require('./agents/chain-oracle');
const { Colony }  = require('./momentum-flow');
const { fetchBinance, fetchDpricebit } = require('./data/feeds');
const http        = require('http');
const stateManager = require('./state-manager');
const { WebSocketServer } = require('ws');

// ── CONFIG ──
const PAPER_MODE       = process.env.PAPER_MODE       !== 'false';
const CAPITAL          = parseFloat(process.env.CAPITAL_TOTAL    || '100');
const CAPITAL_MOMENTUM = parseFloat(process.env.CAPITAL_MOMENTUM || '1000');
const CYCLE_INTERVAL   = parseInt(process.env.CYCLE_INTERVAL     || '65000');
const THRESHOLD        = parseFloat(process.env.SIGNAL_THRESHOLD || '1.5');
const WS_PORT          = parseInt(process.env.WS_PORT_V2         || '8081');
const RUN_ONCE         = process.argv.includes('--once');

// ── WEBSOCKET ──
const server  = http.createServer();
const wss     = new WebSocketServer({ server });
const clients = new Set();
let lastState = null;

wss.on('connection', (ws) => {
    clients.add(ws);
    if (lastState) ws.send(JSON.stringify(lastState));
    ws.on('close', () => clients.delete(ws));
});

server.listen(WS_PORT, () =>
    console.log(`  [ws-v2] WebSocket en puerto ${WS_PORT}`)
);

function broadcast(data) {
    lastState = data;
    const msg = JSON.stringify(data);
    for (const client of clients) {
        if (client.readyState === 1) client.send(msg);
    }
}

// ── AGENTES TRIANGULARES ──
// IDs alineados con Colony para que el oráculo matchee legs correctamente:
// 'uso' (no 'oil'), 'uup' (no 'dxy')
const agentUSO = new Agent('uso', 'USO',     (sym) => fetchDpricebit(sym));
const agentUUP = new Agent('uup', 'UUP',     (sym) => fetchDpricebit(sym));
const agentSPY = new Agent('spy', 'SPY',     (sym) => fetchDpricebit(sym));
const agentBTC = new Agent('btc', 'BTCUSDT', (sym) => fetchBinance(sym));
const agentETH = new Agent('eth', 'ETHUSDT', (sym) => fetchBinance(sym));
const agentQQQ = new Agent('qqq', 'QQQ',     (sym) => fetchDpricebit(sym));

// ── NÚCLEOS TRIANGULARES ──
const nucleoMacro  = new Triangle('macro',  'Macro  USO↔UUP↔SPY', agentUSO, agentUUP, agentSPY);
const nucleoCrypto = new Triangle('crypto', 'Crypto BTC↔ETH↔QQQ',  agentBTC, agentETH, agentQQQ);

// ── ÁRBITRO + ORÁCULO ──
const arbitrer = new Arbitrer(CAPITAL, PAPER_MODE);
arbitrer.addTriangle(nucleoMacro);
arbitrer.addTriangle(nucleoCrypto);

const oracle = new ChainOracle({ threshold: 65, maxCycles: 3 });

// ── COLONY (MOMENTUM) ──
const colony = new Colony(CAPITAL_MOMENTUM, PAPER_MODE);

// ── BOOST: el "cable abierto" ──
// Cuando el oráculo colapsa, inyecta capital en Colony
// alineado con la señal triangular confirmada.
function boostColony(collapsedReport) {
    const signal    = collapsedReport.signal;
    const snapshots = colony.agents.map(a => a.snapshot());
    const boost     = colony.portfolio.cash * 0.15; // 15% del cash disponible

    if (boost < 1) {
        console.log('  ⚠ Boost cancelado — cash insuficiente en Colony');
        return;
    }

    console.log('\n' + '═'.repeat(55));
    console.log('  🚀 ORACLE BOOST — el centavo entra a la máquina');
    console.log(`  Señal: ${signal.description}`);
    console.log(`  Capital boost disponible: $${colony.portfolio.cash.toFixed(2)}`);

    // LONG legs: abrir posición en Colony si no existe
    for (const id of (signal.long || [])) {
        const agent = colony.agents.find(a => a.id === id);
        if (!agent?.lastPrice) {
            console.log(`  ⚠ ${id.toUpperCase()}: sin precio en Colony — skip`);
            continue;
        }
        if (colony.portfolio.positions[id]) {
            console.log(`  📌 ${id.toUpperCase()} ya en posición Colony — boost apilado (sin duplicar)`);
        } else {
            colony.openPosition(id, agent.lastPrice, boost);
            console.log(`  ⚡ Boost LONG ${id.toUpperCase()} @ $${agent.lastPrice.toFixed(4)} · $${boost.toFixed(2)}`);
        }
    }

    // SHORT legs: si Colony tiene posición abierta, cerrarla
    for (const id of (signal.short || [])) {
        if (colony.portfolio.positions[id]) {
            const snap = snapshots.find(s => s.id === id);
            if (snap?.price) {
                console.log(`  ⚡ Cerrando ${id.toUpperCase()} (oracle SHORT + Colony LONG incompatibles)`);
                colony.closePosition(id, snap.price, snapshots);
            }
        }
    }

    console.log('═'.repeat(55));
}

// ── STATE PARA WEBSOCKET ──
function collectState(momentumResult) {
    const now = new Date();
    return {
        ts:        now.toISOString(),
        time:      now.toLocaleTimeString('es-MX'),
        mode:      PAPER_MODE ? 'PAPER' : 'REAL',
        version:   'v2-chain',
        portfolios: {
            triangular: {
                cash:        arbitrer.portfolio?.cash         || CAPITAL,
                pnl:         arbitrer.portfolio?.pnl          || 0,
                totalTrades: arbitrer.portfolio?.totalTrades  || 0,
            },
            momentum: {
                cash:        colony.portfolio?.cash           || CAPITAL_MOMENTUM,
                pnl:         colony.portfolio?.pnl            || 0,
                totalFlows:  colony.portfolio?.totalFlows     || 0,
            },
        },
        oracle:  oracle.snapshot(),
        nucleos: [
            { name: nucleoMacro.name,  zscore: nucleoMacro.zscore  || 0 },
            { name: nucleoCrypto.name, zscore: nucleoCrypto.zscore || 0 },
        ],
        momentum: momentumResult ? {
            cycleCount:   momentumResult.cycleCount,
            flowDecision: momentumResult.flowDecision,
            snapshots:    momentumResult.snapshots,
        } : null,
    };
}

// ── CICLO PRINCIPAL ──
async function runCycle() {
    console.log('\n' + '█'.repeat(55));
    console.log('  LIGHTDROPS v3-CHAIN | ' + new Date().toLocaleTimeString('es-MX'));
    console.log('  Triangular: $' + CAPITAL + ' | Momentum: $' + CAPITAL_MOMENTUM);
    console.log('█'.repeat(55));

    // 1️⃣  Colony tick primero → produce snapshots de momentum
    const momentumResult = await colony.tick();
    const momentumSnaps  = momentumResult?.snapshots || [];

    // 2️⃣  Oráculo observa señal pendiente ANTES de correr el triangular
    //     (si venía en superposición de un ciclo anterior)
    if (oracle.status() === 'superposition') {
        const collapsed = oracle.observe(momentumSnaps);
        if (collapsed) boostColony(collapsed);
    }

    // 3️⃣  Árbitro triangular detecta nuevas señales
    await arbitrer.cycle(THRESHOLD);

    // Extraer mejor señal del ciclo
    const reports = arbitrer.triangles.map(t => t.signal ? {
        signal:   t.signal,
        zscore:   t.zscore,
        strength: t.strength,
        name:     t.name,
        agents:   t.agents.map(a => a.snapshot()),
    } : null).filter(Boolean);

    const best = reports.sort((a, b) => b.strength - a.strength)[0] || null;

    // 4️⃣  Nueva señal triangular → entrar en superposición si oráculo libre
    if (best && oracle.status() === 'idle') {
        oracle.enter(best);
    } else if (best && oracle.status() === 'superposition') {
        console.log('  🌀 Nueva señal triangular — oráculo ocupado, descartando');
    }

    // 5️⃣  Persistir y broadcast
    const state = collectState(momentumResult);
    broadcast(state);
    stateManager.recordSpreads(state.nucleos);

    return state;
}

// ── MAIN ──
async function main() {
    console.log('\n');
    console.log('  ██╗     ██╗ ██████╗ ██╗  ██╗████████╗  v2-chain');
    console.log('  ██║     ██║██╔════╝ ██║  ██║╚══██╔══╝');
    console.log('  ██║     ██║██║  ███╗███████║   ██║   ');
    console.log('  ██║     ██║██║   ██║██╔══██║   ██║   ');
    console.log('  ███████╗██║╚██████╔╝██║  ██║   ██║   ');
    console.log('  ╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝  \n');
    console.log(`  Triangular: $${CAPITAL} | Momentum: $${CAPITAL_MOMENTUM}`);
    console.log(`  Modo: ${PAPER_MODE ? 'PAPER 📋' : 'REAL 🔴'} | Umbral: ${THRESHOLD}σ`);
    console.log(`  Oracle: threshold=${oracle.THRESHOLD} maxCycles=${oracle.MAX_CYCLES}`);
    console.log(`  WebSocket v2: ws://localhost:${WS_PORT}\n`);

    if (RUN_ONCE) {
        await runCycle();
        console.log('\n  ✅ Ciclo único completado — central-v2.js TEST OK');
        process.exit(0);
    }

    await runCycle();

    const interval = setInterval(async () => {
        try { await runCycle(); }
        catch (err) { console.error('Error en ciclo v2:', err.message); }
    }, CYCLE_INTERVAL);

    process.on('SIGINT', () => {
        clearInterval(interval);
        server.close();
        console.log(`\n  Triangular PnL: $${arbitrer.portfolio?.pnl?.toFixed(4)}`);
        console.log(`  Momentum  PnL: $${colony.portfolio?.pnl?.toFixed(4)}`);
        console.log(`  Oracle colapsos: ${oracle.history?.filter(h => h.reason === 'collapsed').length || 0}`);
        process.exit(0);
    });
}

main().catch(console.error);
