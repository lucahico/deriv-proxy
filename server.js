const WebSocket = require('ws');

const DERIV_APP_ID = "34C58J9BbmnzcajnMQPOJ";
const DERIV_PAT = process.env.DERIV_PAT || "pat_ee4bd5538ed43f4feda48fc72bd8d55bbcf84791b47168cb080696de63336fa4";
const API_BASE = "https://api.derivws.com";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`🚀 [SERVER] Proxy Deriv iniciado en puerto ${PORT}`);

async function getAllAccounts() {
  try {
    const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
      headers: { 
        'Authorization': `Bearer ${DERIV_PAT}`, 
        'Deriv-App-ID': DERIV_APP_ID 
      }
    });
    
    if (!res.ok) {
      console.error(`❌ Error GET accounts: ${res.status}`);
      return [];
    }
    
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
      headers: { 
        'Authorization': `Bearer ${DERIV_PAT}`, 
        'Deriv-App-ID': DERIV_APP_ID, 
        'Content-Type': 'application/json' 
      }
    });
    
    if (!res.ok) {
      console.error(`❌ Error OTP para ${accountId}: ${res.status}`);
      return null;
    }
    
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
  let heartbeatInterval = null;

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

    // Heartbeat para mantener la conexión viva
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, 30000); // Cada 30 segundos

    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        // Ignorar pings del cliente
        if (data.type === 'PING' || data.type === 'PONG') {
          return;
        }

        if (data.type === 'SELECT_ACCOUNT') {
          const accountId = data.account_id;
          console.log(`🎯 [SERVER] Cliente seleccionó cuenta: ${accountId}`);
          currentAccountId = accountId;

          if (derivWs && derivWs.readyState === WebSocket.OPEN) {
            derivWs.close();
          }

          const privateUrl = await getPrivateUrl(accountId);
          if (!privateUrl) {
            ws.send(JSON.stringify({ 
              type: 'ERROR', 
              message: `No se pudo obtener URL privada para ${accountId}` 
            }));
            return;
          }

          console.log(`🔗 [SERVER] Conectando a Deriv para cuenta ${accountId}`);

          derivWs = new WebSocket(privateUrl, {
            headers: { 'Deriv-App-ID': DERIV_APP_ID }
          });

          derivWs.on('open', () => {
            console.log(`🟢 [SERVER] Conectado a Deriv (Cuenta: ${accountId})`);
            ws.send(JSON.stringify({ 
              type: 'CONNECTED', 
              account_id: accountId 
            }));
          });

          derivWs.on('message', (data) => {
            ws.send(data.toString());
          });

          derivWs.on('close', () => {
            console.log('🔴 [SERVER] Deriv cerró conexión');
            ws.send(JSON.stringify({ type: 'DISCONNECTED' }));
          });

          derivWs.on('error', (err) => {
            console.error('❌ [SERVER] Error Deriv:', err.message);
            ws.send(JSON.stringify({ 
              type: 'ERROR', 
              message: `Error en conexión con Deriv: ${err.message}` 
            }));
          });
        }
        else if (derivWs && derivWs.readyState === WebSocket.OPEN) {
          derivWs.send(msg.toString());
        }
        else {
          ws.send(JSON.stringify({ 
            type: 'ERROR', 
            message: 'No hay conexión activa con Deriv. Selecciona una cuenta primero.' 
          }));
        }
      } catch (err) {
        console.error('❌ [SERVER] Error procesando mensaje:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('⚪ [SERVER] Cliente desconectado');
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (derivWs && derivWs.readyState === WebSocket.OPEN) {
        derivWs.close();
      }
    });

  } catch (error) {
    console.error('❌ [SERVER] Error crítico:', error.message);
    ws.send(JSON.stringify({ type: 'ERROR', message: error.message }));
  }
});
