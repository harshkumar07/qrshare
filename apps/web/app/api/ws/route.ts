import { experimental_upgradeWebSocket } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_MESSAGE_BYTES = 64 * 1024;
type Session = { peers: Set<WebSocket>; expiresAt: number };
const sessions = new Map<string, Session>();

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function validSessionId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value); }
function validSignal(message: Record<string, unknown>) {
  if (message.type === 'ready') return true;
  if (message.type === 'offer' || message.type === 'answer') return !!message.sdp && typeof message.sdp === 'object';
  if (message.type === 'ice-candidate') return !!message.candidate && typeof message.candidate === 'object';
  return false;
}

function removePeer(sessionId: string, ws: WebSocket) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.peers.delete(ws);
  for (const peer of session.peers) send(peer, { type: 'peer-left' });
  if (session.peers.size === 0) sessions.delete(sessionId);
}

export function GET() {
  return experimental_upgradeWebSocket((ws) => {
    let sessionId: string | undefined;
    ws.on('message', (raw) => {
      const rawText = raw.toString();
      if (new TextEncoder().encode(rawText).byteLength > MAX_MESSAGE_BYTES) {
        send(ws, { type: 'error', message: 'Signaling message is too large.' });
        return;
      }
      try {
        const message = JSON.parse(rawText) as Record<string, unknown>;
        if (message.type === 'create') {
          if (sessionId) { send(ws, { type: 'error', message: 'Session already created.' }); return; }
          sessionId = randomUUID();
          sessions.set(sessionId, { peers: new Set([ws]), expiresAt: Date.now() + SESSION_TTL_MS });
          send(ws, { type: 'created', sessionId, expiresInMs: SESSION_TTL_MS });
          return;
        }
        if (message.type === 'join') {
          const requested = message.sessionId;
          const session = sessions.get(typeof requested === 'string' ? requested : '');
          if (!validSessionId(requested) || !session || session.expiresAt <= Date.now() || session.peers.size >= 2) {
            if (session && session.expiresAt <= Date.now()) sessions.delete(requested as string);
            send(ws, { type: 'error', message: 'Session not found, expired, or full.' });
            return;
          }
          sessionId = requested;
          session.peers.add(ws);
          for (const peer of session.peers) if (peer !== ws) send(peer, { type: 'peer-joined' });
          send(ws, { type: 'joined', sessionId: requested });
          return;
        }
        if (!sessionId) { send(ws, { type: 'error', message: 'Join or create a session first.' }); return; }
        const session = sessions.get(sessionId);
        if (!session || session.expiresAt <= Date.now()) { sessions.delete(sessionId); send(ws, { type: 'error', message: 'Session expired.' }); return; }
        if (!validSignal(message)) { send(ws, { type: 'error', message: 'Invalid signaling message.' }); return; }
        for (const peer of session.peers) if (peer !== ws) send(peer, message);
      } catch { send(ws, { type: 'error', message: 'Invalid signaling message.' }); }
    });
    ws.on('close', () => { if (sessionId) removePeer(sessionId, ws); });
  });
}
