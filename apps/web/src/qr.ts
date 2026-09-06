import QRCode from 'qrcode';
import type { SessionPayload } from '@qrshare/protocol';

export async function renderSessionQr(payload: SessionPayload): Promise<string> {
  return QRCode.toDataURL(JSON.stringify(payload), { width: 360, margin: 2 });
}

export function parseSessionQr(raw: string): SessionPayload {
  const payload = JSON.parse(raw) as Partial<SessionPayload>;
  if (payload.v !== 1 || typeof payload.sessionId !== 'string' || typeof payload.signalingUrl !== 'string') {
    throw new Error('Invalid or expired QRShare QR code.');
  }
  return payload as SessionPayload;
}
