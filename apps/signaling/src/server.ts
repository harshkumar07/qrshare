import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

const port = Number(process.env.PORT ?? 8787);
const sessions = new Map<string, Set<WebSocket>>();

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

const server = new WebSocketServer({ port });

server.on('connection', (ws) => {
  let sessionId: string | undefined;

  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;

      if (message.type === 'create') {
        sessionId = randomUUID();
        sessions.set(sessionId, new Set([ws]));
        send(ws, { type: 'created', sessionId });
        return;
      }

      if (message.type === 'join') {
        const requested = typeof message.sessionId === 'string' ? message.sessionId : '';
        const peers = sessions.get(requested);
        if (!peers || peers.size >= 2) {
          send(ws, { type: 'error', message: 'Session not found or full.' });
          return;
        }
        sessionId = requested;
        peers.add(ws);
        for (const peer of peers) if (peer !== ws) send(peer, { type: 'peer-joined' });
        send(ws, { type: 'joined', sessionId: requested });
        return;
      }

      if (!sessionId) {
        send(ws, { type: 'error', message: 'Join or create a session first.' });
        return;
      }

      const peers = sessions.get(sessionId);
      if (!peers) return;
      for (const peer of peers) {
        if (peer !== ws) send(peer, message);
      }
    } catch {
      send(ws, { type: 'error', message: 'Invalid signaling message.' });
    }
  });

  ws.on('close', () => {
    if (!sessionId) return;
    const peers = sessions.get(sessionId);
    if (!peers) return;
    peers.delete(ws);
    for (const peer of peers) send(peer, { type: 'peer-left' });
    if (peers.size === 0) sessions.delete(sessionId);
  });
});

console.log(`QRShare signaling server listening on ws://localhost:${port}`);
