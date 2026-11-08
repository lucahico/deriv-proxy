const WebSocket = require('ws');

const DERIV_APP_ID = "34C58J9BbmnzcajnMQPOJ";
const DERIV_PAT = process.env.DERIV_PAT || "pat_ee4bd5538ed43f4feda48fc72bd8d55bbcf84791b47168cb080696de63336fa4";
const API_BASE = "https://api.derivws.com";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`🚀 [SERVER] Proxy Deriv iniciado en puerto ${PORT}`);

async function getAccountId() {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
    headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID }
  });
  const data = await res.json();
  const real = data.data?.find(a => a.account_type === 'real' && a.status === 'active');
  return real ? real.account_id : data.data?.[0]?.account_id;
}

async function getPrivateUrl(accountId) {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts/${accountId}/otp`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  return data.data?.url;
}

wss.on('connection', async (ws) => {
  console.log('✅ [SERVER] Cliente conectado al proxy');
  
  try {
    const accountId = await getAccountId();
    const privateUrl = await getPrivateUrl(accountId);
    
    ws.send(JSON.stringify({ type: 'SYSTEM', message: `✅ Cuenta ${accountId} lista. Conectando a Deriv...` }));

    const derivWs = new WebSocket(privateUrl, {
      headers: { 'Deriv-App-ID': DERIV_APP_ID }
    });

    derivWs.on('open', () => {
      console.log(`🟢 [SERVER] Conectado a Deriv (Cuenta: ${accountId})`);
      ws.send(JSON.stringify({ msg_type: 'account_info', loginid: accountId, account_type: 'real' }));
      // El frontend pedirá el saldo y la suscripción a ticks
    });

    derivWs.on('message', (data) => {
      ws.send(data.toString());
    });

    ws.on('message', (data) => {
      if (derivWs.readyState === WebSocket.OPEN) {
        derivWs.send(data.toString());
      }
    });

    derivWs.on('close', () => {
      console.log('🔴 [SERVER] Deriv cerró conexión');
      ws.close();
    });

    ws.on('close', () => {
      console.log('⚪ [SERVER] Cliente desconectado');
      if (derivWs.readyState === WebSocket.OPEN) derivWs.close();
    });

  } catch (error) {
    console.error('❌ [SERVER] Error crítico:', error.message);
    ws.send(JSON.stringify({ type: 'ERROR', message: error.message }));
    ws.close();
  }
});
