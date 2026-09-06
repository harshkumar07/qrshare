import { Redis } from '@upstash/redis';
import { experimental_upgradeWebSocket } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

const SESSION_TTL_SECONDS = 10 * 60;
const MAX_MESSAGE_BYTES = 64 * 1024;
const POLL_MS = 250;

type StoredMessage = {
  senderId: string;
  message: Record<string, unknown>;
};

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function sessionKey(sessionId: string) {
  return `qrshare:session:${sessionId}`;
}

function messagesKey(sessionId: string) {
  return `qrshare:session:${sessionId}:messages`;
}

function membersKey(sessionId: string) {
  return `qrshare:session:${sessionId}:members`;
}

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

function validSignal(message: Record<string, unknown>) {
  if (message.type === 'ready') return true;
  if (message.type === 'offer' || message.type === 'answer') {
    return !!message.sdp && typeof message.sdp === 'object';
  }
  if (message.type === 'ice-candidate') {
    return !!message.candidate && typeof message.candidate === 'object';
  }
  return false;
}

async function publish(redis: Redis, sessionId: string, senderId: string, message: Record<string, unknown>) {
  await redis.rpush(messagesKey(sessionId), JSON.stringify({ senderId, message } satisfies StoredMessage));
  await redis.expire(messagesKey(sessionId), SESSION_TTL_SECONDS);
  await redis.expire(sessionKey(sessionId), SESSION_TTL_SECONDS);
  await redis.expire(membersKey(sessionId), SESSION_TTL_SECONDS);
}

export function GET() {
  const redis = getRedis();

  return experimental_upgradeWebSocket((ws) => {
    const connectionId = randomUUID();
    let sessionId: string | undefined;
    let cursor = 0;
    let closed = false;

    const poll = async () => {
      if (closed || !sessionId || !redis) return;

      try {
        const exists = await redis.exists(sessionKey(sessionId));
        if (!exists) {
          send(ws, { type: 'error', message: 'Session expired.' });
          ws.close();
          return;
        }

        const entries = await redis.lrange<string>(messagesKey(sessionId), cursor, -1);
        cursor += entries.length;

        for (const raw of entries) {
          const stored = typeof raw === 'string' ? JSON.parse(raw) as StoredMessage : raw as unknown as StoredMessage;
          if (stored.senderId !== connectionId) send(ws, stored.message);
        }
      } catch (error) {
        console.error('QRShare signaling poll failed', error);
        send(ws, { type: 'error', message: 'Signaling storage temporarily unavailable.' });
      }

      if (!closed) setTimeout(() => void poll(), POLL_MS);
    };

    const removePeer = async () => {
      if (!sessionId || !redis) return;
      try {
        await redis.srem(membersKey(sessionId), connectionId);
        const remaining = await redis.scard(membersKey(sessionId));
        if (remaining === 0) {
          await redis.del(sessionKey(sessionId), messagesKey(sessionId), membersKey(sessionId));
        } else {
          await publish(redis, sessionId, connectionId, { type: 'peer-left' });
        }
      } catch (error) {
        console.error('QRShare signaling cleanup failed', error);
      }
    };

    ws.on('message', (raw) => {
      void (async () => {
        const rawText = raw.toString();
        if (new TextEncoder().encode(rawText).byteLength > MAX_MESSAGE_BYTES) {
          send(ws, { type: 'error', message: 'Signaling message is too large.' });
          return;
        }

        if (!redis) {
          send(ws, {
            type: 'error',
            message: 'Server signaling storage is not configured. Connect Upstash Redis to Vercel and redeploy.',
          });
          return;
        }

        try {
          const message = JSON.parse(rawText) as Record<string, unknown>;

          if (message.type === 'create') {
            if (sessionId) {
              send(ws, { type: 'error', message: 'Session already created.' });
              return;
            }

            sessionId = randomUUID();
            await redis.set(sessionKey(sessionId), '1', { ex: SESSION_TTL_SECONDS });
            await redis.sadd(membersKey(sessionId), connectionId);
            await redis.expire(membersKey(sessionId), SESSION_TTL_SECONDS);
            await redis.expire(messagesKey(sessionId), SESSION_TTL_SECONDS);
            send(ws, { type: 'created', sessionId, expiresInMs: SESSION_TTL_SECONDS * 1000 });
            void poll();
            return;
          }

          if (message.type === 'join') {
            const requested = message.sessionId;
            if (!validSessionId(requested) || !(await redis.exists(sessionKey(requested)))) {
              send(ws, { type: 'error', message: 'Session not found or expired.' });
              return;
            }

            if (sessionId) {
              send(ws, { type: 'error', message: 'Session already joined.' });
              return;
            }

            const memberCount = await redis.scard(membersKey(requested));
            if (memberCount >= 2) {
              send(ws, { type: 'error', message: 'Session is full.' });
              return;
            }

            const added = await redis.sadd(membersKey(requested), connectionId);
            if (!added) {
              send(ws, { type: 'error', message: 'Could not join session.' });
              return;
            }

            sessionId = requested;
            await redis.expire(sessionKey(sessionId), SESSION_TTL_SECONDS);
            await redis.expire(membersKey(sessionId), SESSION_TTL_SECONDS);
            await redis.expire(messagesKey(sessionId), SESSION_TTL_SECONDS);
            await publish(redis, sessionId, connectionId, { type: 'peer-joined' });
            send(ws, { type: 'joined', sessionId });
            void poll();
            return;
          }

          if (!sessionId) {
            send(ws, { type: 'error', message: 'Join or create a session first.' });
            return;
          }

          if (!(await redis.exists(sessionKey(sessionId)))) {
            send(ws, { type: 'error', message: 'Session expired.' });
            return;
          }

          if (!validSignal(message)) {
            send(ws, { type: 'error', message: 'Invalid signaling message.' });
            return;
          }

          await publish(redis, sessionId, connectionId, message);
        } catch (error) {
          console.error('QRShare signaling message failed', error);
          send(ws, { type: 'error', message: 'Invalid or failed signaling message.' });
        }
      })();
    });

    ws.on('close', () => {
      closed = true;
      void removePeer();
    });

    if (!redis) {
      send(ws, {
        type: 'error',
        message: 'Server signaling storage is not configured. Connect Upstash Redis to Vercel and redeploy.',
      });
    }
  });
}
