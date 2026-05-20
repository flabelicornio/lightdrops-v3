const http = require('http');
const fs   = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'data/persistence/feed-cache.json');
let cache = {};

// Cargar cache previo si existe
try {
    if (fs.existsSync(CACHE_FILE)) {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log('[feed] Cache restaurado desde disco');
    }
} catch(e) {}

function saveCache() {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); }
    catch(e) { console.error('[feed] Error guardando cache:', e.message); }
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'POST' && req.url === '/feed') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                if (data.fx)         cache.fx     = data.fx;
                if (data.crypto)     cache.crypto = data.crypto;
                if (data.crypto_usd) cache.crypto = data.crypto_usd;
                if (data.market)     cache.market = data.market;
                cache.ts = Date.now();
                saveCache();
                console.log(`[feed] dpricebit recibido y guardado: ${JSON.stringify(Object.keys(data))}`);
                res.writeHead(200, {'Content-Type':'application/json'});
                res.end(JSON.stringify({ ok: true, ts: cache.ts }));
            } catch(e) {
                res.writeHead(400); res.end(JSON.stringify({ ok: false }));
            }
        });
        return;
    }

    if (req.method === 'GET' && req.url === '/feed') {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify(cache));
        return;
    }

    res.writeHead(404); res.end();
});

server.listen(3000, () => console.log('[feed] Servidor escuchando en puerto 3000'));
module.exports = { server, cache };
