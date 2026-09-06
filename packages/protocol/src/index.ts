export type Role = 'sender' | 'receiver';

export interface SessionPayload {
  v: 1;
  sessionId: string;
  signalingUrl: string;
}

export type SignalMessage =
  | { type: 'join'; sessionId: string; role: Role }
  | { type: 'ready' }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'peer-left' }
  | { type: 'error'; message: string };

export type FileMessage =
  | { type: 'file-start'; id: string; name: string; size: number; mime: string; chunks: number }
  | { type: 'file-end'; id: string; sha256?: string }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'cancel' };

export const PROTOCOL_VERSION = 1;
export const CHUNK_SIZE = 64 * 1024;

export function encodeControl(message: FileMessage): string { return JSON.stringify(message); }

export function decodeControl(value: string): FileMessage | null {
  try {
    const p = JSON.parse(value) as Record<string, unknown>;
    if (!p || typeof p.type !== 'string') return null;
    if (p.type === 'accept' || p.type === 'reject' || p.type === 'cancel') return { type: p.type };
    if (p.type === 'file-start' && typeof p.id === 'string' && typeof p.name === 'string' && Number.isSafeInteger(p.size) && (p.size as number) >= 0 && typeof p.mime === 'string' && Number.isSafeInteger(p.chunks) && (p.chunks as number) >= 0) return p as unknown as FileMessage;
    if (p.type === 'file-end' && typeof p.id === 'string' && (p.sha256 === undefined || typeof p.sha256 === 'string')) return p as unknown as FileMessage;
    return null;
  } catch { return null; }
}
