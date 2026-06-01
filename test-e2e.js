// =============================================
// LightDrops v3 - End-to-End Test
// Simula flujo de datos sin dependencias externas
// =============================================

const http = require('http');

console.log('\n  🧪 LIGHTDROPS v3 — Test E2E (Simulación)\n');

// ── SIMULATE MOMENTUM DATA ──
class MomentumSimulator {
    constructor() {
        this.cycleCount = 0;
        this.portfolio = { cash: 1000, pnl: 0, positions: {}, totalFlows: 0 };
        this.snapshots = [
            { id: 'btc', symbol: 'BTCUSDT', momentum: 0.5, confidence: 65, capital: 0 },
            { id: 'eth', symbol: 'ETHUSDT', momentum: 0.2, confidence: 45, capital: 0 },
            { id: 'spy', symbol: 'SPY', momentum: -0.1, confidence: 30, capital: 0 },
            { id: 'qqq', symbol: 'QQQ', momentum: 0.8, confidence: 75, capital: 100 },
            { id: 'uso', symbol: 'USO', momentum: -0.3, confidence: 20, capital: 0 },
            { id: 'uup', symbol: 'UUP', momentum: 0.05, confidence: 50, capital: 0 },
        ];
    }

    tick() {
        this.cycleCount++;
        // Simulate momentum changes
        this.snapshots.forEach(s => {
            s.momentum += (Math.random() - 0.5) * 0.2;
            s.confidence += (Math.random() - 0.5) * 10;
            s.confidence = Math.max(0, Math.min(100, s.confidence));
        });
        this.portfolio.pnl += (Math.random() - 0.45) * 50;
        return {
            snapshots: this.snapshots,
            portfolio: this.portfolio,
            flowDecision: { action: 'FLOW', reason: 'Simulation' },
            cycleCount: this.cycleCount
        };
    }
}

// ── SIMULATE TRIANGULAR DATA ──
class TriangularSimulator {
    constructor() {
        this.cycleCount = 0;
        this.zscore = 0;
        this.pnl = 0;
        this.portfolio = { cash: 100, pnl: 0, openPositions: 0, totalTrades: 0 };
    }

    tick() {
        this.cycleCount++;
        this.zscore = Math.sin(this.cycleCount / 5) * 2;
        this.pnl += (Math.random() - 0.5) * 20;
        this.portfolio.pnl = this.pnl;
        return {
            zscore: this.zscore,
            pnl: this.pnl,
            cash: this.portfolio.cash,
            totalTrades: this.portfolio.totalTrades
        };
    }
}

// ── MOCK WEBSOCKET SERVER ──
const moment = new MomentumSimulator();
const tri = new TriangularSimulator();
let wsClients = [];
let wsServer = null;

function broadcastState() {
    const momentumData = moment.tick();
    const triData = tri.tick();
    
    const state = {
        ts: new Date().toISOString(),
        time: new Date().toLocaleTimeString('es-MX'),
        mode: 'PAPER',
        capital: 1000,
        portfolio: momentumData.portfolio,
        snapshots: momentumData.snapshots,
        triangular: triData,
        signal: Math.abs(triData.zscore) > 1.5 ? {
            nucleus: triData.zscore > 0 ? 'macro' : 'crypto',
            description: triData.zscore > 0 ? 'LONG AC SHORT B' : 'LONG B SHORT AC',
            zscore: triData.zscore
        } : null
    };

    console.log(`\n  📊 CICLO ${moment.cycleCount}`);
    console.log(`  ├─ Momentum: ${momentumData.snapshots.map(s => `${s.symbol.replace('USDT','')}=${s.momentum.toFixed(2)}%`).join(' ')}`);
    console.log(`  ├─ ZScore: ${triData.zscore.toFixed(3)} ${Math.abs(triData.zscore) > 1.5 ? '⚡ SEÑAL' : ''}`);
    console.log(`  ├─ PnL: $${triData.pnl.toFixed(2)}`);
    console.log(`  └─ Clientes WS: ${wsClients.length}`);

    // Broadcast to all connected clients
    wsClients.forEach((client, idx) => {
        try {
            client.write(JSON.stringify(state) + '\n');
        } catch (e) {
            wsClients.splice(idx, 1);
        }
    });
}

// ── HTTP SERVER (mock WebSocket via TCP) ──
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>LightDrops E2E Test</title>
            <style>
                body { font-family: monospace; background: #030; color: #0f0; padding: 20px; }
                pre { background: #111; padding: 10px; border: 1px solid #0f0; }
            </style>
        </head>
        <body>
            <h1>LightDrops v3 - E2E Test</h1>
            <p>Conectando a ws://localhost:8080/</p>
            <pre id="log"></pre>
            <script>
                let ws;
                function connect() {
                    ws = new WebSocket('ws://localhost:8080/');
                    ws.onmessage = e => {
                        const data = JSON.parse(e.data);
                        const log = document.getElementById('log');
                        log.textContent += \`[\${data.time}] Ciclo \${data.snapshots[0].id} momentum=\${data.snapshots[0].momentum.toFixed(3)}% zscore=\${data.triangular.zscore.toFixed(3)}\\n\`;
                        log.scrollTop = log.scrollHeight;
                    };
                    ws.onerror = () => setTimeout(connect, 3000);
                }
                connect();
            </script>
        </body>
        </html>
    `);
});

// Broadcast every 3 seconds
setInterval(broadcastState, 3000);

// Listen (mock WebSocket on port 8080)
const NET = require('net');
const wsSocket = NET.createServer(socket => {
    wsClients.push(socket);
    console.log(`  ✓ Cliente TCP conectado (total: ${wsClients.length})`);
    
    socket.on('close', () => {
        wsClients = wsClients.filter(c => c !== socket);
        console.log(`  ✗ Cliente TCP desconectado (total: ${wsClients.length})`);
    });
});

wsSocket.listen(8080, '0.0.0.0', () => {
    console.log('  [server] Escuchando en tcp://localhost:8080');
});

server.listen(3000, '0.0.0.0', () => {
    console.log('  [http] HTTP en http://localhost:3000');
    console.log('\n  📊 Iniciando emisión de datos simulados...\n');
});

// Tick inicial
broadcastState();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n  ⏹  Deteniendo test...');
    process.exit(0);
});
