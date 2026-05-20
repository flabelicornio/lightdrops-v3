// =============================================
// LIGHTDROPS v3 - Data Feeds v2
// CoinGecko (crypto) + TwelveData (ETFs)
// FIX: Binance → CoinGecko, USOIL→USO, DXY→UUP, SPY adjust
// =============================================

require('dotenv').config();
const axios = require('axios');

const TD_KEY  = process.env.TWELVE_DATA_KEY || '';
const TD_BASE = 'https://api.twelvedata.com';

// Cache para no exceder rate limits
const cache    = {};
const CACHE_TTL = 25000; // 25 segundos

function isCached(key) {
    return cache[key] && (Date.now() - cache[key].ts < CACHE_TTL);
}

// --------------------------------------------
// COINGECKO - Crypto (gratis, sin restricciones)
// Reemplaza Binance que bloquea IPs de GCloud
// --------------------------------------------
const CG_IDS = {
    'BTCUSDT': 'bitcoin',
    'ETHUSDT':  'ethereum',
    'BTC':      'bitcoin',
    'ETH':      'ethereum',
};

async function fetchCoinGecko(symbol) {
    const key = `cg_${symbol}`;
    if (isCached(key)) return cache[key].data;

    const cgId = CG_IDS[symbol];
    if (!cgId) {
        console.warn(`  [feeds] CoinGecko: símbolo desconocido ${symbol}, usando simulación`);
        return generateSimulatedData(symbol);
    }

    try {
        // Datos horarios últimas 48h → ~48 puntos suficientes para RSI/MA
        const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart` +
                    `?vs_currency=usd&days=2&interval=hourly`;
        const res = await axios.get(url, { timeout: 10000 });

        if (!res.data || !res.data.prices || res.data.prices.length < 20) {
            console.warn(`  [feeds] CoinGecko: datos insuficientes para ${symbol}`);
            return generateSimulatedData(symbol);
        }

        const pricePoints  = res.data.prices.slice(-50);
        const volumePoints = res.data.total_volumes.slice(-50);

        const prices  = pricePoints.map(p => p[1]);
        const volumes = volumePoints.map(v => v[1]);

        const data = {
            symbol,
            source:        'coingecko',
            prices,
            volumes,
            highs:         prices.map(p => p * 1.002),
            lows:          prices.map(p => p * 0.998),
            current:       prices[prices.length - 1],
            currentVolume: volumes[volumes.length - 1],
            timestamp:     Date.now()
        };

        cache[key] = { ts: Date.now(), data };
        console.log(`  [feeds] CoinGecko ${symbol}: $${data.current.toFixed(2)}`);
        return data;

    } catch (err) {
        console.error(`  [feeds] CoinGecko error ${symbol}:`, err.message);
        return generateSimulatedData(symbol);
    }
}



// --------------------------------------------
// TWELVE DATA - ETFs (SPY, QQQ, USO, UUP)
// USO  = ETF de petróleo WTI (reemplaza USOIL)
// UUP  = ETF del dólar DXY  (reemplaza DXY)
// SPY  → &adjust=true para precio ajustado real
// --------------------------------------------
async function fetchTwelveData(symbol, interval = '5min', outputsize = 50) {
    const key = `td_${symbol}_${interval}`;
    if (isCached(key)) return cache[key].data;

    if (!TD_KEY || TD_KEY === 'TU_KEY_AQUI') {
        return generateSimulatedData(symbol);
    }

    try {
        // adjust=true → precio ajustado por splits/dividendos (fix SPY $737→~$520)
        const url = `${TD_BASE}/time_series` +
                    `?symbol=${symbol}` +
                    `&interval=${interval}` +
                    `&outputsize=${outputsize}` +
                    `&adjust=true` +
                    `&apikey=${TD_KEY}`;

        const res = await axios.get(url, { timeout: 8000 });

        if (!res.data || res.data.status === 'error') {
            console.warn(`  [feeds] TwelveData: error para ${symbol} (${res.data?.message || 'desconocido'}), usando simulación`);
            return generateSimulatedData(symbol);
        }

        if (!res.data.values || res.data.values.length < 20) {
            console.warn(`  [feeds] TwelveData: sin datos para ${symbol}, usando simulación`);
            return generateSimulatedData(symbol);
        }

        const values = res.data.values.reverse(); // cronológico
        const data = {
            symbol,
            source:        'twelvedata',
            prices:        values.map(v => parseFloat(v.close)),
            volumes:       values.map(v => parseFloat(v.volume) || 1000),
            highs:         values.map(v => parseFloat(v.high)),
            lows:          values.map(v => parseFloat(v.low)),
            current:       parseFloat(values[values.length - 1].close),
            currentVolume: parseFloat(values[values.length - 1].volume) || 1000,
            timestamp:     Date.now()
        };

        cache[key] = { ts: Date.now(), data };
        console.log(`  [feeds] TwelveData ${symbol}: $${data.current.toFixed(4)}`);
        return data;

    } catch (err) {
        console.error(`  [feeds] TwelveData error ${symbol}:`, err.message);
        return generateSimulatedData(symbol);
    }
}

// --------------------------------------------
// SIMULACIÓN REALISTA - fallback
// Bases actualizadas: USO/UUP en lugar de USOIL/DXY
// --------------------------------------------
const simBases = {
    'SPY':     { base: 520,   vol: 0.0008, volume: 80000000  },
    'QQQ':     { base: 440,   vol: 0.001,  volume: 50000000  },
    'USO':     { base: 78,    vol: 0.0015, volume: 8000000   }, // oil ETF
    'UUP':     { base: 28,    vol: 0.0005, volume: 3000000   }, // dollar ETF
    'BTCUSDT': { base: 95000, vol: 0.002,  volume: 25000     },
    'ETHUSDT': { base: 1800,  vol: 0.0025, volume: 150000    },
    'BTC':     { base: 95000, vol: 0.002,  volume: 25000     },
    'ETH':     { base: 1800,  vol: 0.0025, volume: 150000    },
};

const simState = {};

function generateSimulatedData(symbol) {
    const cfg = simBases[symbol] || { base: 100, vol: 0.001, volume: 10000 };
    if (!simState[symbol]) simState[symbol] = cfg.base;

    const prices = [], volumes = [], highs = [], lows = [];
    let price = simState[symbol];

    for (let i = 0; i < 50; i++) {
        const drift = (Math.random() - 0.499) * cfg.vol;
        const shock = (i === 45) ? (Math.random() - 0.5) * cfg.vol * 8 : 0;
        price *= (1 + drift + shock);
        const spread = price * 0.002;
        prices.push(price);
        highs.push(price + spread);
        lows.push(price - spread);
        volumes.push(cfg.volume * (0.7 + Math.random() * 0.9));
    }

    simState[symbol] = price;

    return {
        symbol,
        source:        'simulation',
        prices,
        volumes,
        highs,
        lows,
        current:       price,
        currentVolume: volumes[volumes.length - 1],
        timestamp:     Date.now()
    };
}

// --------------------------------------------
// DPRICEBIT - Fuente universal de precios
// Reemplaza TwelveData para ETFs, índices, forex
// Lee del feed-server local (puerto 3000)
// --------------------------------------------
async function fetchDpricebit(symbol) {
    const key = `dpb_${symbol}`;
    if (isCached(key)) return cache[key].data;

    try {
        const res  = await axios.get('http://localhost:3000/feed', { timeout: 3000 });
        const feed = res.data;
        if (!feed || !feed.ts) return generateSimulatedData(symbol);

        const priceMap = {
            'SPY':     feed.market?.SPX,
            'QQQ':     feed.market?.NDX  ? feed.market.NDX  / 38   : null,
            'USO':     feed.market?.OIL  ? feed.market.OIL  / 1.28 : null,
            'UUP':     feed.market?.DXY  ? feed.market.DXY  / 3.55 : null,
            'GOLD':    feed.market?.GOLD,
            'OIL':     feed.market?.OIL,
            'DXY':     feed.market?.DXY,
            'SPX':     feed.market?.SPX,
            'BTCUSDT': feed.crypto?.bitcoin   || feed.market?.BTC,
            'ETHUSDT': feed.crypto?.ethereum  || feed.market?.ETH,
            'BTC':     feed.crypto?.bitcoin   || feed.market?.BTC,
            'ETH':     feed.crypto?.ethereum  || feed.market?.ETH,
            'MXNUSD':  feed.fx?.MXN,
            'COPUSD':  feed.fx?.COP,
            'EURUSD':  feed.fx?.EUR,
        };

        const price = priceMap[symbol];
        if (!price) {
            console.warn(`  [feeds] dpricebit: símbolo desconocido ${symbol}`);
            return generateSimulatedData(symbol);
        }

        // Historial sintético con ruido mínimo alrededor del precio real
        const vol    = 0.001;
        const prices = Array.from({length: 50}, (_, i) => {
            const noise = (Math.random() - 0.5) * vol * price;
            return price + noise * (i / 50);
        });
        prices[prices.length - 1] = price;

        const data = {
            symbol,
            source:        'dpricebit',
            prices,
            volumes:       prices.map(() => 1000000),
            highs:         prices.map(p => p * 1.001),
            lows:          prices.map(p => p * 0.999),
            current:       price,
            currentVolume: 1000000,
            timestamp:     Date.now()
        };

        cache[key] = { ts: Date.now(), data };
        console.log(`  [feeds] dpricebit ${symbol}: $${price.toFixed(4)}`);
        return data;

    } catch(e) {
        console.warn(`  [feeds] dpricebit error ${symbol}:`, e.message);
        return generateSimulatedData(symbol);
    }
}

// Alias universal — crypto→CoinGecko, resto→dpricebit
async function fetchBinance(symbol) {
    if (CG_IDS[symbol]) return fetchCoinGecko(symbol);
    return fetchDpricebit(symbol);
}

// --------------------------------------------
// EXPORTS
// --------------------------------------------
module.exports = {
    fetchBinance,
    fetchCoinGecko,
    fetchTwelveData,
    fetchDpricebit,
    generateSimulatedData
};
