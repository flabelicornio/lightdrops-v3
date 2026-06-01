// Simple in-memory store for last momentum payload
let _last = null;

function setLastMomentum(payload) {
    _last = { ts: new Date().toISOString(), payload };
}

function getLastMomentum() {
    return _last;
}

module.exports = { setLastMomentum, getLastMomentum };
