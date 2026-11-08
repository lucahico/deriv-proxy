/**
 * DERIV SECURE PROXY SERVER
 * Entorno: Node.js en Render.com
 * Función: Manejar autenticación OTP y proxy WebSocket seguro
 */
const WebSocket = require('ws');

const DERIV_APP_ID = "34C58J9BbmnzcajnMQPOJ";
const DERIV_PAT = "pat_ee4bd5538ed43f4feda48fc72bd8d55bbcf84791b47168cb080696de63336fa4"; // Reemplaza si cambia
const API_BASE = "https://api.derivws.com";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`🚀 Proxy Deriv Profesional iniciado en puerto ${PORT}`);

async function getAccounts() {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
    headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID }
  });
  if (!res.ok) throw new Error(`Error GET accounts: ${res.status}`);
  return await res.json();
}

async function getPrivateUrl(accountId) {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts/${accountId}/otp`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DERIV_PAT}`, 'Deriv-App-ID': DERIV_APP_ID, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`Error OTP: ${res.status}`);
  const data = await res.json();
  return data.data.url;
}

wss.on('connection', async (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`✅ Nuevo cliente conectado desde: ${clientIp}`);
  
  let derivWs = null;

  try {
    // 1. Obtener cuentas disponibles
    const accountsData = await getAccounts();
    const accounts = accountsData.data;
    
    // Enviar cuentas al frontend para que el usuario elija
    ws.send(JSON.stringify({ 
      msg_type: 'accounts_list', 
      accounts: accounts.map(a => ({ id: a.account_id, type: a.account_type, balance: a.balance, currency: a.currency }))
    }));

    // Esperar a que el frontend elija la cuenta (timeout de 10s)
    const selectedAccount = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout seleccionando cuenta")), 10000);
      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          const msg = JSON.parse(data);
          if (msg.msg_type === 'select_account') resolve(msg.account_id);
        } catch (e) { reject(e); }
      });
    });

    console.log(`🎯 Cliente seleccionó cuenta: ${selectedAccount}`);
    ws.send(JSON.stringify({ message: `✅ Cuenta ${selectedAccount} seleccionada. Obteniendo URL privada...` }));

    // 2. Obtener URL privada
    const privateUrl = await getPrivateUrl(selectedAccount);
    
    // 3. Conectar a Deriv
    derivWs = new WebSocket(privateUrl, {
      headers: { 'Deriv-App-ID': DERIV_APP_ID }
    });

    derivWs.on('open', () => {
      console.log(`🟢 Conectado a Deriv (Cuenta: ${selectedAccount})`);
      ws.send(JSON.stringify({ msg_type: 'connection_success', account_id: selectedAccount }));
      // El frontend ahora pedirá el saldo y el histórico
    });

    // Reenvío bidireccional de mensajes
    derivWs.on('message', (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
    });

    ws.on('message', (data) => {
      if (derivWs && derivWs.readyState === WebSocket.OPEN) {
        derivWs.send(data.toString());
      }
    });

    // Manejo de cierres
    const cleanup = () => {
      if (derivWs && derivWs.readyState === WebSocket.OPEN) derivWs.close();
      console.log(`⚪ Cliente desconectado: ${clientIp}`);
    };

    derivWs.on('close', cleanup);
    derivWs.on('error', (err) => {
      console.error(`❌ Error Deriv WS: ${err.message}`);
      ws.send(JSON.stringify({ error: { code: "DERIV_WS_ERROR", message: err.message } }));
    });
    
    ws.on('close', cleanup);

  } catch (error) {
    console.error(`❌ Error crítico en conexión: ${error.message}`);
    ws.send(JSON.stringify({ error: { code: "SETUP_FAILED", message: error.message } }));
    ws.close();
  }
});
