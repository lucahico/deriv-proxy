const WebSocket = require('ws');

// Tus credenciales (seguras en el servidor)
const DERIV_APP_ID = "34C58J9BbmnzcajnMQPOJ";
const DERIV_PAT = "pat_ee4bd5538ed43f4feda48fc72bd8d55bbcf84791b47168cb080696de63336fa4";
const API_BASE = "https://api.derivws.com";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`🚀 Proxy Deriv iniciado en puerto ${PORT}`);

// Función para obtener el ID de la cuenta
async function getAccountId() {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
    headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID }
  });
  const data = await res.json();
  const real = data.data.find(a => a.account_type === 'real' && a.status === 'active');
  return real ? real.account_id : data.data[0].account_id;
}

// Función para obtener la URL privada
async function getPrivateUrl(accountId) {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts/${accountId}/otp`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  return data.data.url;
}

wss.on('connection', async (ws) => {
  console.log('✅ Cliente conectado al proxy');
  
  try {
    // 1. Obtener cuenta y URL
    const accountId = await getAccountId();
    const privateUrl = await getPrivateUrl(accountId);
    
    ws.send(JSON.stringify({ message: `✅ Cuenta ${accountId} lista. Conectando a Deriv...` }));

    // 2. Conectar a Deriv (Node.js SÍ permite enviar headers en el WebSocket)
    const derivWs = new WebSocket(privateUrl, {
      headers: { 'Deriv-App-ID': DERIV_APP_ID } // ¡Esta es la clave que Cloudflare no podía enviar!
    });

    derivWs.on('open', () => {
      console.log('🟢 Conectado a Deriv (URL privada)');
      ws.send(JSON.stringify({ msg_type: 'account_info', loginid: accountId, account_type: 'real' }));
      // Pedir saldo (la URL ya está autenticada por el OTP)
      derivWs.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    });

    // Reenviar mensajes en ambas direcciones
    derivWs.on('message', (data) => ws.send(data.toString()));
    ws.on('message', (data) => { if (derivWs.readyState === 1) derivWs.send(data.toString()); });

    // Manejar cierres
    derivWs.on('close', () => ws.close());
    ws.on('close', () => { if (derivWs.readyState === 1) derivWs.close(); });

  } catch (error) {
    console.error('❌ Error:', error.message);
    ws.send(JSON.stringify({ error: { code: "SETUP_FAILED", message: error.message } }));
  }
});
