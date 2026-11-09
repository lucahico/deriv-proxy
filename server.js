const WebSocket = require('ws');

const DERIV_APP_ID = "1089"; // App ID público de Deriv
const DERIV_PAT = "pat_ee4bd5538ed43f4feda48fc72bd8d55bbcf84791b47168cb080696de63336fa4";

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`🚀 [SERVER] Proxy Deriv Legacy iniciado en puerto ${PORT}`);

wss.on('connection', (ws) => {
  console.log('✅ [SERVER] Cliente conectado al proxy');
  let derivWs = null;

  // Conectar directamente a Deriv con API Legacy
  derivWs = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);

  derivWs.on('open', () => {
    console.log('🟢 [SERVER] Conectado a Deriv (Legacy API)');
    
    // Autenticar con PAT
    derivWs.send(JSON.stringify({ authorize: DERIV_PAT }));
  });

  derivWs.on('message', (data) => {
    const message = data.toString();
    const parsed = JSON.parse(message);
    
    // Si es respuesta de authorize, obtener cuentas
    if (parsed.msg_type === 'authorize' && parsed.authorize) {
      console.log(`✅ [SERVER] Autenticado como: ${parsed.authorize.loginid}`);
      ws.send(JSON.stringify({ 
        type: 'CONNECTED', 
        account_id: parsed.authorize.loginid 
      }));
    }
    
    // Reenviar todos los mensajes al cliente
    ws.send(message);
  });

  derivWs.on('close', () => {
    console.log('🔴 [SERVER] Deriv cerró conexión');
    ws.send(JSON.stringify({ type: 'DISCONNECTED' }));
  });

  derivWs.on('error', (err) => {
    console.error('❌ [SERVER] Error Deriv:', err.message);
  });

  // Reenviar mensajes del cliente a Deriv
  ws.on('message', (msg) => {
    if (derivWs && derivWs.readyState === WebSocket.OPEN) {
      derivWs.send(msg.toString());
    }
  });

  ws.on('close', () => {
    console.log('⚪ [SERVER] Cliente desconectado');
    if (derivWs && derivWs.readyState === WebSocket.OPEN) {
      derivWs.close();
    }
  });
});
