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
  | { type: 'file-chunk'; id: string; index: number; data: ArrayBuffer }
  | { type: 'file-end'; id: string; sha256?: string }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'cancel' };

export const PROTOCOL_VERSION = 1;
export const CHUNK_SIZE = 64 * 1024;

export function encodeControl(message: FileMessage): string {
  return JSON.stringify(message);
}

export function decodeControl(value: string): FileMessage | null {
  try {
    const parsed = JSON.parse(value) as FileMessage;
    if (typeof parsed?.type !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
