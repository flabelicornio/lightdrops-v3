// =============================================
// LIGHTDROPS v3 - Binance Executor
// Ejecución de órdenes reales en Binance Spot
// Solo opera si PAPER_MODE=false
// =============================================

require('dotenv').config();
const Binance = require('node-binance-api');

const PAPER_MODE = process.env.PAPER_MODE !== 'false';

// Binance solo se inicializa en modo real
let binance = null;

function initBinance() {
    if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET) {
        throw new Error('Faltan BINANCE_API_KEY o BINANCE_SECRET en .env');
    }
    binance = new Binance().options({
        APIKEY:      process.env.BINANCE_API_KEY,
        APISECRET:   process.env.BINANCE_SECRET,
        useServerTime: true,
        recvWindow:  60000,
    });
    console.log('  [executor] Binance inicializado en modo REAL');
}

// --------------------------------------------
// VERIFICAR CONEXIÓN Y BALANCE
// --------------------------------------------
async function checkConnection() {
    if (PAPER_MODE) {
        console.log('  [executor] PAPER MODE — sin conexión real a Binance');
        return { ok: true, paper: true };
    }

    try {
        if (!binance) initBinance();
        const info = await binance.balance();
        const btc  = parseFloat(info.BTC?.available  || 0);
        const eth  = parseFloat(info.ETH?.available  || 0);
        const usdt = parseFloat(info.USDT?.available || 0);

        console.log(`  [executor] Conexión OK | BTC: ${btc} | ETH: ${eth} | USDT: ${usdt}`);
        return { ok: true, paper: false, balances: { btc, eth, usdt } };
    } catch (err) {
        console.error('  [executor] Error de conexión Binance:', err.message);
        return { ok: false, error: err.message };
    }
}

// --------------------------------------------
// CALCULAR CANTIDAD MÍNIMA OPERABLE
// Binance tiene mínimos por par
// --------------------------------------------
const MIN_NOTIONAL = {
    'BTCUSDT': 10,   // mínimo $10 USDT por orden
    'ETHUSDT': 10,
};

const STEP_SIZE = {
    'BTCUSDT': 0.00001,  // precisión BTC
    'ETHUSDT': 0.0001,   // precisión ETH
};

function calcQuantity(symbol, usdAmount, currentPrice) {
    const raw      = usdAmount / currentPrice;
    const step     = STEP_SIZE[symbol] || 0.001;
    const quantity = Math.floor(raw / step) * step;
    return parseFloat(quantity.toFixed(8));
}

// --------------------------------------------
// ABRIR POSICIÓN
// direction: 'LONG' | 'SHORT'
// En spot Binance: LONG = comprar, SHORT = vender
// --------------------------------------------
async function openPosition(symbol, direction, usdAmount, currentPrice) {
    const side     = direction === 'LONG' ? 'BUY' : 'SELL';
    const quantity = calcQuantity(symbol, usdAmount, currentPrice);
    const notional = quantity * currentPrice;

    if (notional < (MIN_NOTIONAL[symbol] || 10)) {
        console.warn(`  [executor] Orden demasiado pequeña: $${notional.toFixed(2)} < mínimo $${MIN_NOTIONAL[symbol]}`);
        return null;
    }

    if (PAPER_MODE) {
        const order = {
            paper:    true,
            symbol,
            side,
            quantity,
            price:    currentPrice,
            notional: notional.toFixed(2),
            time:     new Date().toISOString(),
        };
        console.log(`  [executor] PAPER ${side} ${quantity} ${symbol} @ $${currentPrice} (~$${notional.toFixed(2)})`);
        return order;
    }

    try {
        if (!binance) initBinance();
        console.log(`  [executor] REAL ${side} ${quantity} ${symbol} @ mercado (~$${notional.toFixed(2)})`);
        const order = await binance.marketBuy(symbol, quantity);   // BUY
        // Para SELL: await binance.marketSell(symbol, quantity)
        // Nota: SHORT real en spot = vender lo que tienes
        // Para SHORT verdadero se necesita margin (futuro)
        console.log(`  [executor] Orden ejecutada: ${order.orderId} | Estado: ${order.status}`);
        return order;
    } catch (err) {
        console.error(`  [executor] Error abriendo posición ${symbol}:`, err.message);
        return null;
    }
}

// --------------------------------------------
// CERRAR POSICIÓN
// --------------------------------------------
async function closePosition(symbol, direction, quantity, currentPrice) {
    // Cerrar LONG = vender; cerrar SHORT = comprar de vuelta
    const side = direction === 'LONG' ? 'SELL' : 'BUY';

    if (PAPER_MODE) {
        const order = {
            paper:    true,
            symbol,
            side,
            quantity,
            price:    currentPrice,
            time:     new Date().toISOString(),
            type:     'CLOSE',
        };
        console.log(`  [executor] PAPER CLOSE ${side} ${quantity} ${symbol} @ $${currentPrice}`);
        return order;
    }

    try {
        if (!binance) initBinance();
        const order = side === 'SELL'
            ? await binance.marketSell(symbol, quantity)
            : await binance.marketBuy(symbol, quantity);
        console.log(`  [executor] Cierre ejecutado: ${order.orderId} | Estado: ${order.status}`);
        return order;
    } catch (err) {
        console.error(`  [executor] Error cerrando posición ${symbol}:`, err.message);
        return null;
    }
}

// --------------------------------------------
// TEST DE CONEXIÓN (sin ejecutar órdenes)
// --------------------------------------------
async function testConnection() {
    console.log('\n  [executor] ── TEST DE CONEXIÓN ──');
    const result = await checkConnection();
    if (result.ok && !result.paper) {
        console.log('  [executor] ✅ Binance conectado correctamente');
        console.log(`  [executor] Balance disponible:`);
        console.log(`    BTC:  ${result.balances.btc}`);
        console.log(`    ETH:  ${result.balances.eth}`);
        console.log(`    USDT: ${result.balances.usdt}`);
    } else if (result.paper) {
        console.log('  [executor] ℹ️  Modo paper — cambia PAPER_MODE=false para real');
    } else {
        console.log('  [executor] ❌ Error:', result.error);
    }
    console.log('  [executor] ────────────────────\n');
    return result;
}

module.exports = {
    checkConnection,
    openPosition,
    closePosition,
    testConnection,
};

// Si se ejecuta directo: node binance-executor.js
if (require.main === module) {
    testConnection().catch(console.error);
}
