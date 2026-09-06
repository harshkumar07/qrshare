import QRCode from 'qrcode';
import type { SessionPayload } from '@qrshare/protocol';

export async function renderSessionQr(payload: SessionPayload): Promise<string> {
  return QRCode.toDataURL(JSON.stringify(payload), { width: 360, margin: 2, errorCorrectionLevel: 'M' });
}

export function parseSessionQr(raw: string): SessionPayload {
  const payload = JSON.parse(raw) as Partial<SessionPayload>;
  if (payload.v !== 1 || typeof payload.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(payload.sessionId) || typeof payload.signalingUrl !== 'string') {
    throw new Error('Invalid QRShare QR code.');
  }
  let url: URL;
  try { url = new URL(payload.signalingUrl); } catch { throw new Error('Invalid signaling address in QR code.'); }
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && process.env.NODE_ENV !== 'production')) {
    throw new Error('QR code uses an insecure signaling connection.');
  }
  return { v: 1, sessionId: payload.sessionId, signalingUrl: url.toString() };
}
