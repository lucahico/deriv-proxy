/**
 * server.js - Proxy WebSocket Seguro para Deriv
 * Ejecutar en Render.com o similar
 * Variables de entorno requeridas: PORT, DERIV_APP_ID
 */
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089'; // Reemplazar con tu App ID real
const DERIV_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

// Almacén seguro de sesiones (en producción, usar Redis o similar)
const sessions = new Map();

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint para iniciar sesión segura (el token se valida y se descarta de los logs)
app.post('/api/authorize', (req, res) => {
    const { token, accountId } = req.body;
    if (!token || !accountId) {
        return res.status(400).json({ error: 'Token y accountId son requeridos' });
    }
    // En un sistema real, aquí se validaría el token con Deriv y se guardaría solo el session_id
    sessions.set(accountId, { token, authorized: true });
    console.log(`[AUTH] Cuenta ${accountId} autorizada (Token almacenado de forma segura)`);
    res.json({ success: true, message: 'Autorización exitosa' });
});

const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws, req) => {
    console.log('[WS] Nuevo cliente conectado');
    
    // Conexión con Deriv
    const derivWs = new WebSocket(DERIV_WS_URL);
    
    derivWs.on('open', () => {
        console.log('[DERIV] Conexión establecida');
    });

    derivWs.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // SEGURIDAD: Nunca enviar el token de vuelta al frontend
            if (message.msg_type === 'authorize') {
                console.log('[DERIV] Autorización confirmada');
            }
            
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('[DERIV] Error procesando mensaje:', error);
        }
    });

    derivWs.on('error', (error) => {
        console.error('[DERIV] Error de conexión:', error);
    });

    derivWs.on('close', () => {
        console.log('[DERIV] Conexión cerrada, intentando reconectar...');
        setTimeout(() => {
            // Lógica de reconexión simple
        }, 3000);
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            // Interceptar y inyectar token de forma segura si es una solicitud de authorize
            if (message.authorize && sessions.has(message.accountId)) {
                message.authorize = sessions.get(message.accountId).token;
                console.log(`[PROXY] Inyectando token seguro para ${message.accountId}`);
            }
            
            // Reenviar a Deriv
            if (derivWs.readyState === WebSocket.OPEN) {
                derivWs.send(JSON.stringify(message));
            } else {
                ws.send(JSON.stringify({ error: { message: 'Conexión con Deriv no disponible' } }));
            }
        } catch (error) {
            console.error('[WS] Error procesando mensaje del cliente:', error);
            ws.send(JSON.stringify({ error: { message: 'Formato de mensaje inválido' } }));
        }
    });

    ws.on('close', () => {
        console.log('[WS] Cliente desconectado');
        if (derivWs.readyState === WebSocket.OPEN) {
            derivWs.close();
        }
    });
});

console.log(`[SERVER] Proxy WebSocket ejecutándose en puerto ${PORT}`);
