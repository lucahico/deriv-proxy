const http = require('http');
const WebSocket = require('ws');

const DERIV_APP_ID = "34C58J9BbmnzcajnMQPOJ";
const DERIV_PAT = "pat_ee4bd5538ed43f4feda48fc72bd8d55bbcf84791b47168cb080696de63336fa4";
const API_BASE = "https://api.derivws.com";

const PORT = process.env.PORT || 8080;

// ==========================================
// ESTADO GLOBAL DEL BOT (Persiste aunque cierres el panel)
// ==========================================
const state = {
  derivWs: null,
  currentAccountId: null,
  candles: [],
  riskManager: null,
  botConfig: { 
    threshold: 60, strategy: 'C', symbol: 'R_75', granularity: 60, 
    mode: 'sim', stake: 0.35, isRunning: false 
  },
  analysisCount: 0,
  lastAnalysisTime: null,
  lastPrice: 0,
  tickCount: 0,
  accounts: [],
  logs: [], // Guardamos los últimos 50 logs
  connectedClients: [] // Lista de paneles conectados
};

function log(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
  const entry = `[${time}] ${msg}`;
  state.logs.unshift(entry);
  if (state.logs.length > 50) state.logs.pop();
  console.log(entry);
}

// ==========================================
// SERVIDOR HTTP + WEBSOCKET
// ==========================================
const server = http.createServer((req, res) => {
  // ✅ ENDPOINT DE DIAGNÓSTICO
  if (req.url === '/diagnostico' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateDiagnosticHTML());
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
  console.log(`🚀 [SERVER] Bot Autónomo iniciado en puerto ${PORT}`);
  console.log(`🌐 Panel de Diagnóstico: http://localhost:${PORT}/diagnostico`);
  initializeBot();
});

// ==========================================
// GENERADOR DE PÁGINA DE DIAGNÓSTICO
// ==========================================
function generateDiagnosticHTML() {
  const s = state;
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  
  const isDerivConnected = s.derivWs && s.derivWs.readyState === WebSocket.OPEN;
  const lastAnalysisSecs = s.lastAnalysisTime ? Math.floor((Date.now() - s.lastAnalysisTime) / 1000) : 999;
  
  const statusColor = s.botConfig.isRunning ? '#2ea043' : '#da3633';
  const statusText = s.botConfig.isRunning ? '🟢 OPERANDO' : '🔴 DETENIDO';
  const derivStatus = isDerivConnected ? '🟢 Conectado' : '🔴 Desconectado';
  const analysisStatus = lastAnalysisSecs < 15 ? '✅ Normal' : '⚠️ Detenido';
  const analysisColor = lastAnalysisSecs < 15 ? '#2ea043' : '#d29922';

  const logsHtml = s.logs.map(l => `<div style="font-family: monospace; font-size: 12px; padding: 2px 0; border-bottom: 1px solid #30363d;">${l}</div>`).join('');

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="refresh" content="5">
      <title>Diagnóstico Bot Deriv</title>
      <style>
        body { background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; padding: 20px; margin: 0; }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; }
        .card h3 { color: #8b949e; font-size: 12px; text-transform: uppercase; margin: 0 0 10px 0; }
        .stat { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .stat-label { font-size: 12px; color: #8b949e; }
        .log-box { background: #010409; border: 1px solid #30363d; border-radius: 6px; padding: 10px; height: 300px; overflow-y: auto; }
        .refresh { text-align: center; font-size: 12px; color: #8b949e; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔍 Diagnóstico en Tiempo Real</h1>
        
        <div class="grid">
          <div class="card">
            <h3>Estado del Bot</h3>
            <div class="stat" style="color: ${statusColor}">${statusText}</div>
            <div class="stat-label">Uptime: ${hours}h ${mins}m</div>
          </div>
          <div class="card">
            <h3>Conexión Deriv</h3>
            <div class="stat" style="color: ${isDerivConnected ? '#2ea043' : '#da3633'}">${derivStatus}</div>
            <div class="stat-label">Cuenta: ${s.currentAccountId || 'Ninguna'}</div>
          </div>
          <div class="card">
            <h3>Análisis Técnico</h3>
            <div class="stat" style="color: ${analysisColor}">${analysisStatus}</div>
            <div class="stat-label">Último hace: ${lastAnalysisSecs}s | Total: ${s.analysisCount}</div>
          </div>
          <div class="card">
            <h3>Mercado</h3>
            <div class="stat">${s.lastPrice.toFixed(4)}</div>
            <div class="stat-label">Velas: ${s.candles.length} | Ticks: ${s.tickCount}</div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <h3>Configuración Activa</h3>
          <div style="display: flex; gap: 20px; font-size: 14px;">
            <span>Estrategia: <b>${s.botConfig.strategy}</b></span>
            <span>Umbral: <b>${s.botConfig.threshold}</b></span>
            <span>Activo: <b>${s.botConfig.symbol}</b></span>
            <span>Modo: <b>${s.botConfig.mode.toUpperCase()}</b></span>
            <span>Stake: <b>$${s.botConfig.stake}</b></span>
          </div>
        </div>

        <div class="card">
          <h3>📝 Logs Recientes (Últimos 50)</h3>
          <div class="log-box">
            ${logsHtml || '<div style="color: #8b949e;">Sin logs aún...</div>'}
          </div>
        </div>

        <div class="refresh">🔄 Esta página se actualiza automáticamente cada 5 segundos</div>
      </div>
    </body>
    </html>
  `;
}

// ==========================================
// LÓGICA DEL BOT (EJECUTADA AL INICIAR)
// ==========================================
async function initializeBot() {
  try {
    const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
      headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID }
    });
    if (res.ok) {
      const data = await res.json();
      state.accounts = data.data || [];
      log(`📋 ${state.accounts.length} cuentas cargadas desde API`);
    }
  } catch (error) {
    log(`❌ Error cargando cuentas: ${error.message}`);
  }
}

// ==========================================
// MANEJO DE CONEXIONES WEBSOCKET (PANELES)
// ==========================================
wss.on('connection', (ws) => {
  log('📱 Nuevo panel de control conectado');
  state.connectedClients.push(ws);

  // Enviar estado inicial al panel
  ws.send(JSON.stringify({ type: 'STATE_UPDATE', state: getPublicState() }));

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      
      if (data.type === 'SELECT_ACCOUNT') {
        state.currentAccountId = data.account_id;
        log(`🎯 Cuenta seleccionada: ${data.account_id}`);
        await connectToDeriv(data.account_id);
      } 
      else if (data.type === 'UPDATE_CONFIG') {
        state.botConfig = { ...state.botConfig, ...data.config };
        log(`⚙️ Config actualizada: ${state.botConfig.strategy} / Umbral ${state.botConfig.threshold}`);
        broadcast({ type: 'STATE_UPDATE', state: getPublicState() });
      }
      else if (data.type === 'START_BOT') {
        if (state.candles.length < 50) {
          log(`⚠️ No se puede iniciar: ${state.candles.length}/50 velas`);
          return;
        }
        state.botConfig.isRunning = true;
        log('🤖 BOT INICIADO');
        startAnalysisLoop();
        broadcast({ type: 'STATE_UPDATE', state: getPublicState() });
      }
      else if (data.type === 'STOP_BOT') {
        state.botConfig.isRunning = false;
        log('🛑 BOT DETENIDO');
        broadcast({ type: 'STATE_UPDATE', state: getPublicState() });
      }
    } catch (err) {
      log(`❌ Error procesando mensaje: ${err.message}`);
    }
  });

  ws.on('close', () => {
    state.connectedClients = state.connectedClients.filter(c => c !== ws);
    log('📱 Panel de control desconectado');
  });
});

function getPublicState() {
  return {
    botConfig: state.botConfig,
    analysisCount: state.analysisCount,
    lastAnalysisTime: state.lastAnalysisTime,
    lastPrice: state.lastPrice,
    tickCount: state.tickCount,
    candlesCount: state.candles.length,
    currentAccountId: state.currentAccountId,
    accounts: state.accounts,
    logs: state.logs,
    isDerivConnected: state.derivWs && state.derivWs.readyState === WebSocket.OPEN,
    riskManager: state.riskManager ? {
      balance: state.riskManager.currentBalance,
      tradesToday: state.riskManager.tradesToday,
      wins: state.riskManager.wins,
      losses: state.riskManager.losses
    } : null
  };
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  state.connectedClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

// ==========================================
// CONEXIÓN A DERIV
// ==========================================
async function connectToDeriv(accountId) {
  if (state.derivWs && state.derivWs.readyState === WebSocket.OPEN) {
    state.derivWs.close();
  }

  try {
    const res = await fetch(`${API_BASE}/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Error obteniendo OTP');
    const data = await res.json();
    const privateUrl = data.data?.url;
    
    if (!privateUrl) throw new Error('URL privada no disponible');

    log(`🔗 Conectando a Deriv...`);
    state.derivWs = new WebSocket(privateUrl, { headers: { 'Deriv-App-ID': DERIV_APP_ID } });

    state.derivWs.on('open', () => {
      log(`🟢 Conectado a Deriv (${accountId})`);
      const account = state.accounts.find(a => a.account_id === accountId);
      const balance = account ? parseFloat(account.balance) : 1000;
      state.riskManager = new RiskManager(balance, state.botConfig.stake);
      
      state.derivWs.send(JSON.stringify({ balance: 1, subscribe: 1 }));
      state.derivWs.send(JSON.stringify({
        ticks_history: state.botConfig.symbol, adjust_start_time: 1, count: 100, end: 'latest',
        style: 'candles', granularity: state.botConfig.granularity, subscribe: 1
      }));
      broadcast({ type: 'STATE_UPDATE', state: getPublicState() });
    });

    state.derivWs.on('message', (data) => handleDerivData(JSON.parse(data.toString())));

    state.derivWs.on('close', () => {
      log(`🔴 Deriv desconectado. Reconectando en 5s...`);
      broadcast({ type: 'STATE_UPDATE', state: getPublicState() });
      setTimeout(() => { if (state.currentAccountId) connectToDeriv(state.currentAccountId); }, 5000);
    });

    state.derivWs.on('error', (err) => log(`❌ Error Deriv: ${err.message}`));

  } catch (error) {
    log(`❌ Error conectando a Deriv: ${error.message}`);
  }
}

function handleDerivData(data) {
  if (data.msg_type === 'balance' && state.riskManager) {
    state.riskManager.updateBalance(parseFloat(data.balance.balance));
  }
  if (data.msg_type === 'candles' && Array.isArray(data.candles)) {
    state.candles = data.candles.map(c => ({ time: c.epoch, open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
    if (state.candles.length > 100) state.candles = state.candles.slice(-100);
    if (state.candles.length > 0) state.lastPrice = state.candles[state.candles.length - 1].close;
    log(`📊 Histórico recibido: ${state.candles.length} velas`);
  }
  if (data.msg_type === 'ohlc') {
    const ohlc = data.ohlc;
    const candleTime = parseInt(ohlc.open_time);
    const candle = { time: candleTime, open: +ohlc.open, high: +ohlc.high, low: +ohlc.low, close: +ohlc.close };
    state.lastPrice = candle.close;
    state.tickCount++;
    
    const lastCandle = state.candles[state.candles.length - 1];
    if (lastCandle && lastCandle.time === candleTime) {
      state.candles[state.candles.length - 1] = candle;
    } else {
      if (!state.candles.some(c => c.time === candleTime)) {
        state.candles.push(candle);
        if (state.candles.length > 100) state.candles = state.candles.slice(-100);
        log(`🕯️ Nueva vela. Total: ${state.candles.length} | Precio: ${candle.close.toFixed(2)}`);
      }
    }
  }
  if (data.msg_type === 'proposal') {
    if (data.error) log(`❌ Error propuesta: ${data.error.message}`);
    else {
      log(`✅ Propuesta recibida: ${data.proposal.id}`);
      state.derivWs.send(JSON.stringify({ buy: data.proposal.id, price: data.proposal.ask_price }));
    }
  }
  if (data.msg_type === 'buy') {
    if (data.error) log(`❌ Error compra: ${data.error.message}`);
    else {
      log(`💼 Operación ejecutada: ${data.buy.contract_id}`);
      state.derivWs.send(JSON.stringify({ proposal_open_contract: 1, contract_id: data.buy.contract_id, subscribe: 1 }));
    }
  }
  if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract.is_sold) {
    const profit = parseFloat(data.proposal_open_contract.profit);
    const isWin = profit > 0;
    if (state.riskManager) {
      state.riskManager.recordTrade(isWin);
      log(`${isWin ? '✅' : '❌'} Trade ${isWin ? 'GANADO' : 'PERDIDO'}: $${profit.toFixed(2)}`);
    }
  }
  broadcast({ type: 'STATE_UPDATE', state: getPublicState() });
}

// ==========================================
// CICLO DE ANÁLISIS
// ==========================================
let analysisInterval = null;
function startAnalysisLoop() {
  if (analysisInterval) clearInterval(analysisInterval);
  analysisInterval = setInterval(() => {
    if (!state.botConfig.isRunning || state.candles.length < 50 || !state.riskManager) return;

    state.analysisCount++;
    state.lastAnalysisTime = Date.now();

    // Aquí iría la lógica de AIEngine/StrategyEngine (simplificada para el ejemplo)
    // Para mantener el código corto, simulamos un score basado en el precio
    const eval = { score: Math.random() * 100, direction: Math.random() > 0.5 ? 'CALL' : 'PUT', reason: 'Test' };
    
    log(`📊 ANÁLISIS #${state.analysisCount} | Score: ${eval.score.toFixed(1)} | Dir: ${eval.direction}`);

    if (eval.score >= state.botConfig.threshold && eval.direction) {
      if (state.botConfig.mode === 'live') {
        log(`🎯 SEÑAL LIVE: ${eval.direction}`);
        // executeTrade(eval.direction, eval.duration, eval.durationUnit);
      } else {
        log(`🎯 SEÑAL SIM: ${eval.direction}`);
      }
    }
    broadcast({ type: 'STATE_UPDATE', state: getPublicState() });
  }, 5000);
}

// ==========================================
// GESTIÓN DE RIESGO (Clase simple)
// ==========================================
class RiskManager {
  constructor(initialBalance, baseStake) {
    this.initialBalance = initialBalance;
    this.currentBalance = initialBalance;
    this.baseStake = Math.max(0.35, baseStake);
    this.currentStake = this.baseStake;
    this.tradesToday = 0; this.wins = 0; this.losses = 0;
  }
  recordTrade(isWin) {
    this.tradesToday++;
    if (isWin) this.wins++; else this.losses++;
  }
  updateBalance(newBalance) { this.currentBalance = newBalance; }
}
