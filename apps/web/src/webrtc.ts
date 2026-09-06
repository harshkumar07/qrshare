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
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.pc.onicecandidate = (event) => {
      if (event.candidate) callbacks.onSignal({ type: 'ice-candidate', candidate: event.candidate.toJSON() });
    };
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
      } else if (event.data instanceof ArrayBuffer) {
        this.callbacks.onChunk(event.data);
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buffer) => this.callbacks.onChunk(buffer));
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
        await new Promise<void>((resolve) => {
          const handler = () => { this.channel?.removeEventListener('bufferedamountlow', handler); resolve(); };
          this.channel?.addEventListener('bufferedamountlow', handler);
        });
      }
      this.channel.send(buffer);
      sent += buffer.byteLength;
      onProgress(sent);
    }
    this.sendControl({ type: 'file-end', id });
  }

  close() { this.channel?.close(); this.pc.close(); }
}
