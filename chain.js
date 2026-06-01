// =============================================
// LIGHTDROPS v3 - Chain: Capa de Doble Certeza
// Mediatiza señales entre `momentum-flow` y `central` (triangular)
// API simple: submitSignal(source, signal) -> { decision, reason, matched }
// Mantiene un buffer temporal de señales y evalúa confianza combinada.
// =============================================

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const WINDOW_MS = parseInt(process.env.CHAIN_WINDOW_MS || String(35 * 1000));
const CONF_THRESH = parseFloat(process.env.CHAIN_CONFIDENCE_THRESHOLD || '60'); // 0-100
const CLEANUP_MS = 10 * 1000;

let signals = [];

function now() { return Date.now(); }

function normalizeSignal(sig) {
    // Ensure minimal fields
    return Object.assign({
        source: 'unknown',    // 'momentum' | 'central'
        ts: now(),
        symbols: [],         // array of symbols involved
        confidence: 0,       // 0-100
        side: 'long',        // or 'short'
        meta: {},
    }, sig);
}

function cleanup() {
    const cutoff = now() - WINDOW_MS;
    signals = signals.filter(s => s.ts >= cutoff);
}

setInterval(() => { cleanup(); }, CLEANUP_MS).unref && setInterval(() => { cleanup(); }, CLEANUP_MS).unref();

function sharedSymbol(a, b) {
    const sa = new Set((a.symbols || []).map(s => s.toUpperCase()));
    for (const s of (b.symbols || [])) if (sa.has(s.toUpperCase())) return true;
    return false;
}

function evaluateCombined(a, b) {
    // Weighted combined confidence. Prefer momentum for directional trades and
    // prefer central for arb (both weight 0.5 by default).
    const wa = a.source === 'momentum' ? 0.6 : 0.4;
    const wb = b.source === 'momentum' ? 0.6 : 0.4;
    const combined = (a.confidence * wa + b.confidence * wb) / (wa + wb);
    return combined;
}

function submitSignal(source, rawSignal) {
    const sig = normalizeSignal(rawSignal);
    sig.source = source;
    sig.ts = sig.ts || now();

    // Save
    signals.push(sig);

    // Try to find a match
    for (let i = signals.length - 1; i >= 0; i--) {
        const other = signals[i];
        if (other === sig) continue;
        // Only consider signals within window
        if (Math.abs(sig.ts - other.ts) > WINDOW_MS) continue;
        // Prefer signals from different sources
        if (other.source === sig.source) continue;
        // Must share at least one symbol
        if (!sharedSymbol(sig, other)) continue;

        const combined = evaluateCombined(sig, other);
        const decision = combined >= CONF_THRESH ? 'APPROVE' : 'REJECT';
        const reason = decision === 'APPROVE'
            ? `combined_confidence=${combined.toFixed(2)} >= ${CONF_THRESH}`
            : `combined_confidence=${combined.toFixed(2)} < ${CONF_THRESH}`;

        // Persist match for observability
        const matched = { a: sig, b: other, combined, decision, reason, ts: now() };
        persistMatch(matched);

        // Remove matched signals from buffer to avoid duplicate approvals
        signals = signals.filter(s => s !== sig && s !== other);

        return { decision, reason, matched };
    }

    // No match yet — keep in buffer
    return { decision: 'PENDING', reason: 'awaiting counterpart signal', stored: sig };
}

function persistMatch(obj) {
    try {
        const dir = path.join(__dirname, 'data', 'chain');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `matches.log`);
        const line = `${new Date().toISOString()} \t ${JSON.stringify(obj)}\n`;
        fs.appendFileSync(file, line);
    } catch (e) {
        // non-fatal
    }
}

function peekBuffer() { cleanup(); return signals.slice(-50); }

module.exports = {
    submitSignal,
    peekBuffer,
    // Helpers for testing / diagnostics
    _config: { WINDOW_MS, CONF_THRESH },
};
