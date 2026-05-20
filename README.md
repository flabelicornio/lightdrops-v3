# LightDrops v3 — Multi-Agent Triangular Arbitrage

## Arquitectura

```
central.js          ← Orquestador (punto de entrada)
agents/
  agent.js          ← Neurona base (RSI, MA, volumen, z-score)
  triangle.js       ← Núcleo triangular (3 agentes coordinados)
  arbitrer.js       ← Árbitro central (decide qué señal ejecutar)
data/
  feeds.js          ← Datos: Binance + TwelveData + simulación
logs/
  trades.json       ← Registro de operaciones paper
.env                ← Configuración (API keys, capital, umbrales)
```

## Núcleos activos

| Núcleo | Activo A | Activo B | Activo C | Fuente |
|--------|----------|----------|----------|--------|
| Macro  | WTI Oil  | DXY      | SPY ETF  | TwelveData |
| Crypto | BTC      | ETH      | QQQ ETF  | Binance + TwelveData |

## Setup en Google Cloud VM

```bash
# 1. Clonar / copiar archivos a la VM
mkdir lightdrops-v3 && cd lightdrops-v3
# (subir archivos via scp o git)

# 2. Instalar dependencias
npm install

# 3. Configurar API keys
nano .env
# Agrega tu TWELVE_DATA_KEY (gratis en twelvedata.com)
# Binance no requiere key para datos públicos

# 4. Correr en modo paper (recomendado primero)
npm run paper

# 5. Un solo ciclo para probar
npm test

# 6. Correr en background (producción)
nohup npm run paper > logs/output.log 2>&1 &
tail -f logs/output.log
```

## Sin API key (simulación)

Si no tienes API key de TwelveData, el sistema funciona en modo simulación
con precios realistas basados en niveles actuales de mercado. Útil para
probar la lógica antes de conectar datos reales.

## Señales

El árbitro detecta cuando el spread triangular supera `SIGNAL_THRESHOLD` σ
(z-score). La señal indica:

- **z > umbral**: Activo B sobrevaluado → LARGO A+C / CORTO B
- **z < -umbral**: Activo B subvaluado  → LARGO B / CORTO A+C

Las posiciones se cierran cuando el spread converge de vuelta a la media.

## Evolución hacia red neuronal

Cada `Agent` es una neurona. Cada `Triangle` es una capa oculta.
El `Arbitrer` es la capa de salida. El siguiente paso es implementar
backpropagation vía `recordOutcome()` en cada agente para que los
pesos se ajusten con el resultado real de cada señal.

## Parámetros .env

| Variable | Default | Descripción |
|----------|---------|-------------|
| PAPER_MODE | true | Sin órdenes reales |
| CAPITAL_TOTAL | 100 | Capital simulado USD |
| CYCLE_INTERVAL | 30000 | Milisegundos entre ciclos |
| SIGNAL_THRESHOLD | 1.5 | Z-score mínimo para señal |
| TWELVE_DATA_KEY | — | API key TwelveData |
