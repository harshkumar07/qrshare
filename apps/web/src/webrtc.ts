import { CHUNK_SIZE, decodeControl, encodeControl, type FileMessage, type SignalMessage } from '@qrshare/protocol';

export type PeerCallbacks = {
  onState: (state: RTCPeerConnectionState | 'connected' | 'closed') => void;
  onControl: (message: FileMessage) => void;
  onSignal: (message: SignalMessage) => void;
  onChunk: (chunk: ArrayBuffer) => void;
  onError: (error: Error) => void;
};

export class PeerConnection {
  private pc: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private readonly callbacks: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(callbacks: PeerCallbacks, initiator: boolean) {
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) callbacks.onSignal({ type: 'ice-candidate', candidate: event.candidate.toJSON() });
    };

    // ICE 701 is an ICE-server diagnostic, not a peer-connection failure.
    // A failed STUN server must not abort an otherwise valid direct connection.
    this.pc.onicecandidateerror = () => undefined;

    this.pc.onconnectionstatechange = () => callbacks.onState(this.pc.connectionState);
    this.pc.ondatachannel = (event) => this.attachChannel(event.channel);
    if (initiator) this.attachChannel(this.pc.createDataChannel('files', { ordered: true }));
  }

  private attachChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = CHUNK_SIZE * 4;
    channel.onopen = () => this.callbacks.onState('connected');
    channel.onclose = () => this.callbacks.onState('closed');
    channel.onerror = () => this.callbacks.onError(new Error('WebRTC data channel error.'));
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = decodeControl(event.data);
        if (message) this.callbacks.onControl(message);
        else this.callbacks.onError(new Error('Invalid file-transfer control message.'));
      } else if (event.data instanceof ArrayBuffer) {
        this.callbacks.onChunk(event.data);
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buffer) => this.callbacks.onChunk(buffer)).catch(() => this.callbacks.onError(new Error('Could not read received chunk.')));
      }
    };
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async acceptOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(sdp);
    for (const candidate of this.pendingCandidates) await this.pc.addIceCandidate(candidate);
    this.pendingCandidates = [];
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(sdp);
    for (const candidate of this.pendingCandidates) await this.pc.addIceCandidate(candidate);
    this.pendingCandidates = [];
  }

  async addCandidate(candidate: RTCIceCandidateInit) {
    if (this.pc.remoteDescription) await this.pc.addIceCandidate(candidate);
    else this.pendingCandidates.push(candidate);
  }

  sendControl(message: FileMessage) {
    if (this.channel?.readyState !== 'open') throw new Error('Peer is not connected.');
    this.channel.send(encodeControl(message));
  }

  sendFileHeader(file: File): string {
    const id = crypto.randomUUID();
    this.sendControl({ type: 'file-start', id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', chunks: Math.ceil(file.size / CHUNK_SIZE) });
    return id;
  }

  async sendFileData(file: File, id: string, onProgress: (sent: number) => void) {
    if (!this.channel || this.channel.readyState !== 'open') throw new Error('Peer is not connected.');
    let sent = 0;
    const chunks = Math.ceil(file.size / CHUNK_SIZE);
    for (let index = 0; index < chunks; index++) {
      const buffer = await file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE)).arrayBuffer();
      while (this.channel.bufferedAmount > CHUNK_SIZE * 8) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Transfer stalled.')), 30_000);
          const handler = () => { window.clearTimeout(timeout); this.channel?.removeEventListener('bufferedamountlow', handler); resolve(); };
          this.channel?.addEventListener('bufferedamountlow', handler, { once: true });
        });
      }
      this.channel.send(buffer);
      sent += buffer.byteLength;
      onProgress(sent);
    }
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    this.sendControl({ type: 'file-end', id, sha256 });
  }

  close() { this.channel?.close(); this.pc.close(); }
}
