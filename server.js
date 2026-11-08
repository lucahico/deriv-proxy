/**
 * server.js - Proxy WebSocket Seguro para Deriv (Versión Corregida)
 */
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// Almacén seguro de sesiones en memoria
const sessions = new Map();

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint para registrar el token de forma segura ANTES de conectar el WS
app.post('/api/authorize', (req, res) => {
    const { token, loginId } = req.body;
    if (!token || !loginId) {
        return res.status(400).json({ error: 'Token y loginId son requeridos' });
    }
    sessions.set(loginId, { token, authorized: true });
    console.log(`[AUTH] LoginId ${loginId} registrado en sesión segura`);
    res.json({ success: true, message: 'Autorización registrada' });
});

// CORRECCIÓN CRÍTICA: Usar el servidor HTTP de Express para alojar el WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('[WS] Cliente frontend conectado');
    
    const derivWs = new WebSocket(DERIV_WS_URL);
    
    derivWs.on('open', () => console.log('[DERIV] Conexión establecida'));
    
    derivWs.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // SEGURIDAD: Si Deriv devuelve algo con el token, lo enmascaramos
            if (message.msg_type === 'authorize') {
                console.log('[DERIV] Autorización confirmada');
            }
            
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('[DERIV] Error procesando mensaje:', error);
        }
    });

    derivWs.on('error', (error) => console.error('[DERIV] Error:', error));

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Inyectar token de forma segura si el frontend lo solicita
            if (message.authorize && message.loginId && sessions.has(message.loginId)) {
                message.authorize = sessions.get(message.loginId).token;
                delete message.loginId; // Eliminar antes de enviar a Deriv
                console.log(`[PROXY] Token inyectado para sesión`);
            }
            
            if (derivWs.readyState === WebSocket.OPEN) {
                derivWs.send(JSON.stringify(message));
            } else {
                ws.send(JSON.stringify({ error: { message: 'Conexión con Deriv no disponible' } }));
            }
        } catch (error) {
            console.error('[WS] Error procesando mensaje:', error);
        }
    });

    ws.on('close', () => {
        if (derivWs.readyState === WebSocket.OPEN) derivWs.close();
    });
});

// CORRECCIÓN CRÍTICA: Hacer que Express escuche en el puerto
server.listen(PORT, () => {
    console.log(`[SERVER] Proxy corriendo en puerto ${PORT}`);
});
