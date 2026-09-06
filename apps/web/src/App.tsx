'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileMessage, SessionPayload, SignalMessage } from '@qrshare/protocol';
import { PeerConnection } from './webrtc';
import { parseSessionQr, renderSessionQr } from './qr';
import { Scanner } from './scanner';

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL ??
  (typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : 'ws://localhost:8787');
type IncomingFile = { name: string; size: number; mime: string; received: number; chunks: ArrayBuffer[] };
type ServerMessage = { type: string; sessionId?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; message?: string };

function connect(url: string, onMessage: (message: ServerMessage) => void, onError: (message: string) => void) {
  const ws = new WebSocket(url);
  ws.onmessage = (event) => { try { onMessage(JSON.parse(event.data) as ServerMessage); } catch { onError('Received invalid signaling data.'); } };
  ws.onerror = () => onError('Signaling connection failed.');
  return ws;
}

export default function App() {
  const [mode, setMode] = useState<'home' | 'sender' | 'receiver'>('home');
  const [status, setStatus] = useState('Choose how to connect.');
  const [qr, setQr] = useState<string | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [incoming, setIncoming] = useState<IncomingFile | undefined>(undefined);
  const [downloadUrl, setDownloadUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const peerRef = useRef<PeerConnection | undefined>(undefined);
  const acceptedRef = useRef(false);
  const incomingRef = useRef<IncomingFile | undefined>(undefined);
  const pendingFilesRef = useRef<File[]>([]);
  const announcedIdRef = useRef<string | undefined>(undefined);
  const sendingRef = useRef(false);

  const sendSignal = useCallback((message: SignalMessage | Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(message));
  }, []);

  const continueSending = useCallback(async () => {
    if (!peerRef.current || !pendingFilesRef.current.length || sendingRef.current) return;
    sendingRef.current = true;
    const pending = pendingFilesRef.current;
    const total = pending.reduce((sum, file) => sum + file.size, 0);
    let sentTotal = 0;
    try {
      for (let index = 0; index < pending.length; index++) {
        const file = pending[index];
        const id = index === 0 && announcedIdRef.current ? announcedIdRef.current : peerRef.current.sendFileHeader(file);
        if (index === 0 && announcedIdRef.current) announcedIdRef.current = undefined;
        setStatus(`Sending ${file.name}…`);
        await peerRef.current.sendFileData(file, id, (sent) => setProgress(Math.round(((sentTotal + sent) / Math.max(total, 1)) * 100)));
        sentTotal += file.size;
      }
      setProgress(100); setStatus('All files sent.');
    } catch (e) { setError(e instanceof Error ? e.message : 'File transfer failed.'); }
    finally { sendingRef.current = false; pendingFilesRef.current = []; }
  }, []);

  const makePeer = useCallback((initiator: boolean) => {
    peerRef.current?.close();
    peerRef.current = new PeerConnection({
      onState: (state) => { if (state === 'connected') setStatus('Peer connected.'); else if (state === 'failed') setStatus('Peer connection failed.'); },
      onSignal: sendSignal,
      onChunk: (chunk) => { const current = incomingRef.current; if (!current) return; current.chunks.push(chunk); current.received += chunk.byteLength; setIncoming({ ...current }); },
      onError: (e) => setError(e.message),
      onControl: (message: FileMessage) => {
        if (message.type === 'accept') { acceptedRef.current = true; setAccepted(true); setStatus('Transfer accepted. Sending…'); void continueSending(); return; }
        if (message.type === 'reject' || message.type === 'cancel') { setStatus('Transfer was cancelled.'); return; }
        if (message.type === 'file-start') {
          const next: IncomingFile = { name: message.name, size: message.size, mime: message.mime, received: 0, chunks: [] };
          incomingRef.current = next; setIncoming(next); setStatus(`Incoming file: ${message.name}`);
        } else if (message.type === 'file-end') {
          const current = incomingRef.current;
          if (!current || current.received !== current.size) { setError('Transfer ended before all file bytes arrived.'); return; }
          setDownloadUrl(URL.createObjectURL(new Blob(current.chunks, { type: current.mime })));
          setStatus('Transfer complete.');
        }
      },
    }, initiator);
  }, [continueSending, sendSignal]);

  const startSender = useCallback(() => {
    setMode('sender'); setError(undefined); setAccepted(false); acceptedRef.current = false; setStatus('Creating session…');
    const ws = connect(SIGNALING_URL, (message) => {
      if (message.type === 'created' && message.sessionId) { void renderSessionQr({ v: 1, sessionId: message.sessionId, signalingUrl: SIGNALING_URL }).then(setQr); setStatus('Waiting for receiver to scan…'); }
      else if (message.type === 'peer-joined') { makePeer(true); void peerRef.current?.createOffer().then((sdp) => sendSignal({ type: 'offer', sdp })); setStatus('Receiver found. Establishing secure connection…'); }
      else if (message.type === 'answer' && message.sdp) void peerRef.current?.acceptAnswer(message.sdp);
      else if (message.type === 'ice-candidate' && message.candidate) void peerRef.current?.addCandidate(message.candidate);
      else if (message.type === 'error') setError(message.message ?? 'Signaling error.');
    }, setError);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'create' })); wsRef.current = ws;
  }, [makePeer, sendSignal]);

  const joinSession = useCallback((payload: SessionPayload) => {
    setMode('receiver'); setError(undefined); setStatus('Joining session…');
    const ws = connect(payload.signalingUrl, (message) => {
      if (message.type === 'joined') setStatus('Joined. Waiting for sender…');
      else if (message.type === 'offer' && message.sdp) { makePeer(false); void peerRef.current?.acceptOffer(message.sdp).then((sdp) => sendSignal({ type: 'answer', sdp })); }
      else if (message.type === 'ice-candidate' && message.candidate) void peerRef.current?.addCandidate(message.candidate);
      else if (message.type === 'peer-left') setStatus('Sender disconnected.');
      else if (message.type === 'error') setError(message.message ?? 'Signaling error.');
    }, setError);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', sessionId: payload.sessionId, role: 'receiver' })); wsRef.current = ws;
  }, [makePeer, sendSignal]);

  const onScan = useCallback((text: string) => { try { joinSession(parseSessionQr(text)); } catch (e) { setError(e instanceof Error ? e.message : 'Invalid QR code.'); } }, [joinSession]);
  useEffect(() => () => { peerRef.current?.close(); wsRef.current?.close(); if (downloadUrl) URL.revokeObjectURL(downloadUrl); }, [downloadUrl]);

  const prepareSend = () => {
    if (!peerRef.current || !files.length) return;
    pendingFilesRef.current = files; setProgress(0);
    if (acceptedRef.current) void continueSending();
    else { announcedIdRef.current = peerRef.current.sendFileHeader(files[0]); setStatus(`Waiting for receiver to approve ${files[0].name}…`); }
  };
  const acceptIncoming = () => { peerRef.current?.sendControl({ type: 'accept' }); setStatus('Accepted. Sender is transferring the file.'); };
  const reset = () => {
    peerRef.current?.close(); wsRef.current?.close(); if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    pendingFilesRef.current = []; announcedIdRef.current = undefined; incomingRef.current = undefined; sendingRef.current = false;
    setMode('home'); setQr(undefined); setIncoming(undefined); setDownloadUrl(undefined); setProgress(0); setAccepted(false); acceptedRef.current = false; setError(undefined); setStatus('Choose how to connect.');
  };

  return <main className="app"><section className="card">
    <div className="brand">QRShare</div><p className="tagline">Send files directly between nearby devices.</p>{error && <div className="error">{error}</div>}
    {mode === 'home' && <div className="actions"><button onClick={startSender}>Send files</button><button className="secondary" onClick={() => { setMode('receiver'); setStatus('Choose how to receive.'); }}>Receive files</button></div>}
    {mode === 'sender' && <><label className="file-picker">Select files<input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))}/></label>{files.length > 0 && <div className="files">{files.map((f) => <div key={`${f.name}-${f.size}`}>{f.name} · {(f.size / 1024 / 1024).toFixed(2)} MB</div>)}</div>}{qr && <img className="qr" src={qr} alt="Scan this QR code to receive the files"/>}<p className="status">{status}</p>{accepted && <p className="accepted">Receiver approved the transfer.</p>}{progress > 0 && <progress max="100" value={progress}/>}<button disabled={!files.length || status !== 'Peer connected.' || sendingRef.current} onClick={prepareSend}>Send selected files</button></>}
    {mode === 'receiver' && !downloadUrl && <>{(status === 'Choose how to receive.' || status === 'Joining session…' || status === 'Joined. Waiting for sender…') && <><Scanner onScan={onScan}/><p className="status">Point your camera at the sender's QR code.</p><textarea placeholder="Or paste the QR payload here" onChange={(e) => { const text = e.target.value.trim(); if (!text) return; try { joinSession(parseSessionQr(text)); } catch { /* incomplete payload */ } }}/></>}{incoming && <div className="incoming"><strong>{incoming.name}</strong><span>{(incoming.size / 1024 / 1024).toFixed(2)} MB</span><span>{Math.round((incoming.received / Math.max(incoming.size, 1)) * 100)}% received</span><button onClick={acceptIncoming}>Accept transfer</button></div>}</>}
    {downloadUrl && <div className="complete"><p>File received successfully.</p><a href={downloadUrl} download={incoming?.name}>Download {incoming?.name}</a></div>}
    {mode !== 'home' && <button className="back" onClick={reset}>Start over</button>}
  </section></main>;
}
