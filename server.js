const WebSocket = require('ws');

const DERIV_APP_ID = "34C58J9BbmnzcajnMQPOJ";
const DERIV_PAT = "pat_ee4bd5538ed43f4feda48fc72bd8d55bbcf84791b47168cb080696de63336fa4";
const API_BASE = "https://api.derivws.com";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`🚀 [SERVER] Bot Autónomo iniciado en puerto ${PORT}`);

// ==========================================
// ANÁLISIS TÉCNICO (Movido al servidor)
// ==========================================
const TA = {
  ema: (data, period) => {
    if (data.length < period) return [];
    const k = 2 / (period + 1);
    let emaArray = [data[0]];
    for (let i = 1; i < data.length; i++) emaArray.push(data[i] * k + emaArray[i - 1] * (1 - k));
    return emaArray;
  },
  rsi: (data, period = 14) => {
    if (data.length < period + 1) return [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) { const diff = data[i] - data[i - 1]; if (diff > 0) gains += diff; else losses -= diff; }
    let avgGain = gains / period, avgLoss = losses / period;
    const rsiArray = [];
    for (let i = period + 1; i < data.length; i++) {
      const diff = data[i] - data[i - 1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      const rs = avgGain / (avgLoss === 0 ? 1 : avgLoss);
      rsiArray.push(100 - (100 / (1 + rs)));
    }
    return rsiArray;
  },
  bollinger: (data, period = 20, mult = 2) => {
    if (data.length < period) return { upper: [], lower: [], mid: [] };
    const upper = [], lower = [], mid = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      mid.push(mean); upper.push(mean + mult * std); lower.push(mean - mult * std);
    }
    return { upper, lower, mid };
  },
  atr: (highs, lows, closes, period = 14) => {
    if (closes.length < period + 1) return [];
    let tr = [highs[0] - lows[0]];
    for (let i = 1; i < closes.length; i++) {
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    return TA.ema(tr, period);
  },
  calculateDuration: (candles) => {
    if (candles.length < 50) return { value: 5, unit: 't' };
    const closes = candles.map(c => c.close);
    const atr = TA.atr(candles.map(c=>c.high), candles.map(c=>c.low), closes, 14);
    const lastATR = atr[atr.length - 1] || 0;
    const lastClose = closes[closes.length - 1];
    const volRatio = lastATR / lastClose;
    if (volRatio > 0.005) return { value: 5, unit: 't' };
    if (volRatio > 0.002) return { value: 10, unit: 't' };
    return { value: 5, unit: 'm' };
  }
};

// ==========================================
// ESTRATEGIA ENSEMBLE (Movida al servidor)
// ==========================================
const AIEngine = {
  weights: { ema: 0.3, rsi: 0.25, bb: 0.25, breakout: 0.2 },
  evaluate: (candles) => {
    if (candles.length < 50) return { score: 0, reason: "Datos insuficientes", direction: null, duration: 5, durationUnit: 't' };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const lastClose = closes[closes.length - 1];
    const ema20 = TA.ema(closes, 20);
    const ema50 = TA.ema(closes, 50);
    const lastEma20 = ema20[ema20.length - 1];
    const lastEma50 = ema50[ema50.length - 1];
    let emaSignal = 0;
    if (lastEma20 > lastEma50) emaSignal = 1;
    else if (lastEma20 < lastEma50) emaSignal = -1;
    const rsi = TA.rsi(closes, 14);
    const lastRsi = rsi[rsi.length - 1] || 50;
    let rsiSignal = 0;
    if (lastRsi < 30) rsiSignal = 1;
    else if (lastRsi > 70) rsiSignal = -1;
    else if (lastRsi > 50) rsiSignal = 0.5;
    else rsiSignal = -0.5;
    const bb = TA.bollinger(closes, 20, 2);
    const lastBBUpper = bb.upper[bb.upper.length - 1];
    const lastBBLower = bb.lower[bb.lower.length - 1];
    let bbSignal = 0;
    if (lastClose <= lastBBLower) bbSignal = 1;
    else if (lastClose >= lastBBUpper) bbSignal = -1;
    const highest20 = Math.max(...highs.slice(-20));
    const lowest20 = Math.min(...lows.slice(-20));
    let breakoutSignal = 0;
    if (lastClose > highest20) breakoutSignal = 1;
    else if (lastClose < lowest20) breakoutSignal = -1;
    const combinedScore = (emaSignal * AIEngine.weights.ema) + (rsiSignal * AIEngine.weights.rsi) + (bbSignal * AIEngine.weights.bb) + (breakoutSignal * AIEngine.weights.breakout);
    const score = Math.abs(combinedScore) * 100;
    const direction = combinedScore > 0 ? 'CALL' : combinedScore < 0 ? 'PUT' : null;
    const reasons = [];
    if (emaSignal !== 0) reasons.push(`EMA ${emaSignal > 0 ? '▲' : '▼'}`);
    if (rsiSignal !== 0) reasons.push(`RSI ${lastRsi.toFixed(0)}`);
    if (bbSignal !== 0) reasons.push(`BB ${bbSignal > 0 ? 'sobreventa' : 'sobrecompra'}`);
    if (breakoutSignal !== 0) reasons.push(`Breakout ${breakoutSignal > 0 ? '▲' : '▼'}`);
    const durationObj = TA.calculateDuration(candles);
    return { score: Math.min(100, score), reason: reasons.join(', ') || 'Sin confluencia', direction, duration: durationObj.value, durationUnit: durationObj.unit, indicators: { ema20: lastEma20, ema50: lastEma50, rsi: lastRsi, bbUpper: lastBBUpper, bbLower: lastBBLower, price: lastClose } };
  }
};

// ==========================================
// GESTIÓN DE RIESGO (Movida al servidor)
// ==========================================
function round2(num) {
  return Math.round(num * 100) / 100;
}

class RiskManager {
  constructor(initialBalance, baseStake) {
    this.initialBalance = initialBalance;
    this.currentBalance = initialBalance;
    this.baseStake = round2(Math.max(0.35, baseStake));
    this.currentStake = this.baseStake;
    this.tradesToday = 0;
    this.wins = 0;
    this.losses = 0;
    this.lossStreak = 0;
    this.isPaused = false;
    this.pauseEndTime = 0;
    this.maxDailyLossPct = 0.05;
    this.maxDailyTrades = 20;
    this.maxLossStreak = 3;
  }

  canTrade() {
    if (this.tradesToday >= this.maxDailyTrades) return { allowed: false, reason: "Límite 20 trades" };
    if (this.currentBalance <= -(this.initialBalance * this.maxDailyLossPct)) return { allowed: false, reason: "Stop Loss 5%" };
    if (this.currentBalance >= (this.initialBalance * 0.10)) return { allowed: false, reason: "Take Profit 10%" };
    if (this.isPaused && Date.now() < this.pauseEndTime) {
      const mins = Math.ceil((this.pauseEndTime - Date.now()) / 60000);
      return { allowed: false, reason: `Pausa ${mins}min` };
    } else if (this.isPaused) { this.isPaused = false; console.log("Pausa finalizada"); }
    return { allowed: true, reason: "OK" };
  }

  recordTrade(isWin) {
    this.tradesToday++;
    if (isWin) { 
      this.wins++; 
      this.lossStreak = 0; 
      this.currentStake = this.baseStake; 
    } else {
      this.losses++; 
      this.lossStreak++;
      if (this.lossStreak >= this.maxLossStreak) {
        this.isPaused = true;
        this.pauseEndTime = Date.now() + 15 * 60 * 1000;
        console.log(`⚠️ ${this.lossStreak} pérdidas. Pausa 15min.`);
      }
      // ✅ SIN MARTINGALA: Stake fijo
      this.currentStake = this.baseStake;
    }
  }

  updateBalance(newBalance) {
    this.currentBalance = newBalance;
  }
}

// ==========================================
// SERVIDOR PRINCIPAL
// ==========================================
async function getAllAccounts() {
  try {
    const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
      headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (error) {
    console.error('❌ Error obteniendo cuentas:', error.message);
    return [];
  }
}

async function getPrivateUrl(accountId) {
  try {
    const res = await fetch(`${API_BASE}/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.url || null;
  } catch (error) {
    console.error('❌ Error obteniendo URL privada:', error.message);
    return null;
  }
}

wss.on('connection', async (ws) => {
  console.log('✅ [SERVER] Cliente conectado al proxy');
  let derivWs = null;
  let currentAccountId = null;
  let candles = [];
  let subscriptionId = null;
  let riskManager = null;
  let botConfig = {
    threshold: 75,
    strategy: 'AI',
    symbol: 'R_75',
    granularity: 300,
    mode: 'sim',
    stake: 0.35,
    isRunning: false
  };
  let analysisInterval = null;

  try {
    const accounts = await getAllAccounts();
    
    ws.send(JSON.stringify({ 
      type: 'ACCOUNTS_LIST', 
      accounts: accounts.map(a => ({
        id: a.account_id,
        type: a.account_type,
        balance: parseFloat(a.balance),
        currency: a.currency,
        status: a.status
      }))
    }));

    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        if (data.type === 'SELECT_ACCOUNT') {
          const accountId = data.account_id;
          console.log(`🎯 [SERVER] Cliente seleccionó: ${accountId}`);
          currentAccountId = accountId;

          if (derivWs && derivWs.readyState === WebSocket.OPEN) {
            derivWs.close();
          }

          const privateUrl = await getPrivateUrl(accountId);
          if (!privateUrl) {
            ws.send(JSON.stringify({ type: 'ERROR', message: `No URL privada para ${accountId}` }));
            return;
          }

          console.log(`🔗 [SERVER] Conectando a Deriv para ${accountId}`);

          derivWs = new WebSocket(privateUrl, {
            headers: { 'Deriv-App-ID': DERIV_APP_ID }
          });

          derivWs.on('open', () => {
            console.log(`🟢 [SERVER] Conectado a Deriv (${accountId})`);
            ws.send(JSON.stringify({ type: 'CONNECTED', account_id: accountId }));
            
            // Inicializar RiskManager
            riskManager = new RiskManager(parseFloat(accounts.find(a => a.account_id === accountId)?.balance || 1000), botConfig.stake);
            
            // Solicitar saldo y velas
            derivWs.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            derivWs.send(JSON.stringify({
              ticks_history: botConfig.symbol,
              adjust_start_time: 1,
              count: 100,
              end: 'latest',
              style: 'candles',
              granularity: botConfig.granularity,
              subscribe: 1
            }));
          });

          derivWs.on('message', (data) => {
            const parsed = JSON.parse(data.toString());
            
            // Reenviar al cliente
            ws.send(data.toString());
            
            // Procesar en el servidor
            handleDerivMessage(parsed, derivWs, ws);
          });

          derivWs.on('close', () => {
            console.log('🔴 [SERVER] Deriv cerró');
            ws.send(JSON.stringify({ type: 'DISCONNECTED' }));
            if (analysisInterval) clearInterval(analysisInterval);
          });

          derivWs.on('error', (err) => {
            console.error('❌ [SERVER] Error Deriv:', err.message);
          });
        }
        else if (data.type === 'UPDATE_CONFIG') {
          // Actualizar configuración del bot
          botConfig = { ...botConfig, ...data.config };
          console.log(`⚙️ [SERVER] Configuración actualizada:`, botConfig);
          ws.send(JSON.stringify({ type: 'CONFIG_UPDATED', config: botConfig }));
        }
        else if (data.type === 'START_BOT') {
          botConfig.isRunning = true;
          console.log('🤖 [SERVER] Bot iniciado');
          ws.send(JSON.stringify({ type: 'BOT_STARTED' }));
          startAnalysis();
        }
        else if (data.type === 'STOP_BOT') {
          botConfig.isRunning = false;
          console.log('🛑 [SERVER] Bot detenido');
          ws.send(JSON.stringify({ type: 'BOT_STOPPED' }));
          if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
          }
        }
        else if (derivWs && derivWs.readyState === WebSocket.OPEN) {
          derivWs.send(msg.toString());
        }
      } catch (err) {
        console.error('❌ [SERVER] Error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('⚪ [SERVER] Cliente desconectado');
      if (analysisInterval) clearInterval(analysisInterval);
      if (derivWs && derivWs.readyState === WebSocket.OPEN) derivWs.close();
    });

  } catch (error) {
    console.error('❌ [SERVER] Error crítico:', error.message);
  }

  // ==========================================
  // FUNCIONES DE ANÁLISIS Y TRADING
  // ==========================================
  function handleDerivMessage(data, derivWs, clientWs) {
    if (data.msg_type === 'balance') {
      const balance = parseFloat(data.balance.balance);
      if (riskManager) riskManager.updateBalance(balance);
      clientWs.send(JSON.stringify({ type: 'BALANCE_UPDATE', balance }));
    }

    if (data.msg_type === 'candles' && Array.isArray(data.candles)) {
      candles = data.candles.map(c => ({ 
        time: c.epoch, 
        open: parseFloat(c.open), 
        high: parseFloat(c.high), 
        low: parseFloat(c.low), 
        close: parseFloat(c.close) 
      }));
      if (candles.length > 100) candles = candles.slice(-100);
      clientWs.send(JSON.stringify({ type: 'CANDLES_UPDATE', count: candles.length }));
    }

    if (data.msg_type === 'ohlc') {
      const ohlc = data.ohlc;
      const candleTime = parseInt(ohlc.open_time);
      const candle = { 
        time: candleTime, 
        open: parseFloat(ohlc.open), 
        high: parseFloat(ohlc.high), 
        low: parseFloat(ohlc.low), 
        close: parseFloat(ohlc.close) 
      };
      const lastCandle = candles[candles.length - 1];
      if (lastCandle && lastCandle.time === candleTime) {
        candles[candles.length - 1] = candle;
      } else {
        const isDuplicate = candles.some(c => c.time === candleTime);
        if (!isDuplicate) {
          candles.push(candle);
          if (candles.length > 100) candles = candles.slice(-100);
          clientWs.send(JSON.stringify({ type: 'NEW_CANDLE', count: candles.length }));
        }
      }
    }

    if (data.msg_type === 'proposal' && !data.error) {
      console.log(`✅ [SERVER] Propuesta recibida: ${data.proposal.id}`);
      derivWs.send(JSON.stringify({ buy: data.proposal.id, price: data.proposal.ask_price }));
    }

    if (data.msg_type === 'buy' && !data.error) {
      console.log(`✅ [SERVER] Operación ejecutada: ${data.buy.contract_id}`);
      clientWs.send(JSON.stringify({ type: 'TRADE_EXECUTED', contractId: data.buy.contract_id }));
      derivWs.send(JSON.stringify({ 
        proposal_open_contract: 1, 
        contract_id: data.buy.contract_id, 
        subscribe: 1 
      }));
    }

    if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract.is_sold) {
      const profit = parseFloat(data.proposal_open_contract.profit);
      const isWin = profit > 0;
      if (riskManager) {
        riskManager.recordTrade(isWin);
        clientWs.send(JSON.stringify({ 
          type: 'TRADE_RESULT', 
          isWin, 
          profit, 
          stats: {
            tradesToday: riskManager.tradesToday,
            wins: riskManager.wins,
            losses: riskManager.losses,
            lossStreak: riskManager.lossStreak,
            currentStake: riskManager.currentStake
          }
        }));
      }
    }
  }

  function startAnalysis() {
    if (analysisInterval) clearInterval(analysisInterval);
    
    analysisInterval = setInterval(() => {
      if (!botConfig.isRunning || candles.length < 50 || !riskManager) return;

      const eval = AIEngine.evaluate(candles);
      
      clientWs.send(JSON.stringify({ 
        type: 'ANALYSIS', 
        score: eval.score, 
        direction: eval.direction,
        reason: eval.reason,
        indicators: eval.indicators
      }));

      if (eval.score >= botConfig.threshold && eval.direction) {
        const riskCheck = riskManager.canTrade();
        if (riskCheck.allowed) {
          if (botConfig.mode === 'live') {
            executeTrade(eval.direction, eval.duration, eval.durationUnit);
          } else {
            clientWs.send(JSON.stringify({ 
              type: 'SIMULATION_SIGNAL', 
              direction: eval.direction, 
              score: eval.score 
            }));
          }
        } else {
          clientWs.send(JSON.stringify({ 
            type: 'SIGNAL_IGNORED', 
            reason: riskCheck.reason 
          }));
        }
      }
    }, 5000);
  }

  function executeTrade(direction, duration, durationUnit) {
    const stake = round2(riskManager.currentStake);
    if (stake < 0.35) return;
    
    const proposal = {
      proposal: 1,
      amount: parseFloat(stake.toFixed(2)),
      basis: 'stake',
      contract_type: direction,
      currency: 'USD',
      duration: duration,
      duration_unit: durationUnit,
      underlying_symbol: botConfig.symbol
    };
    
    console.log(`📤 [SERVER] Enviando propuesta: ${JSON.stringify(proposal)}`);
    derivWs.send(JSON.stringify(proposal));
  }
});
