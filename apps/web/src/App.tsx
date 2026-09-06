'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileMessage, SessionPayload, SignalMessage } from '@qrshare/protocol';
import { PeerConnection } from './webrtc';
import { parseSessionQr, renderSessionQr } from './qr';
import { Scanner } from './scanner';

const SIGNALING_URL = process.env.NEXT_PUBLIC_SIGNALING_URL ??
  (process.env.NODE_ENV === 'production' && typeof window !== 'undefined'
    ? `wss://${window.location.host}/api/ws`
    : 'ws://localhost:8787');

type IncomingFile = { name: string; size: number; mime: string; received: number; chunks: ArrayBuffer[] };
type ServerMessage = { type: string; sessionId?: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; message?: string };

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>;
}

function ReceiveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>;
}

function ShieldIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.3 2.3 4.7-5"/></svg>;
}

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
    setMode('sender'); setError(undefined); setAccepted(false); acceptedRef.current = false; setStatus('Creating secure session…');
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
    setMode('receiver'); setError(undefined); setStatus('Joining secure session…');
    const ws = connect(payload.signalingUrl, (message) => {
      if (message.type === 'joined') setStatus('Connected to session. Waiting for sender…');
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
  const acceptIncoming = () => { peerRef.current?.sendControl({ type: 'accept' }); setStatus('Accepted. Secure transfer starting…'); };
  const reset = () => {
    peerRef.current?.close(); wsRef.current?.close(); if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    pendingFilesRef.current = []; announcedIdRef.current = undefined; incomingRef.current = undefined; sendingRef.current = false;
    setMode('home'); setQr(undefined); setIncoming(undefined); setDownloadUrl(undefined); setProgress(0); setAccepted(false); acceptedRef.current = false; setError(undefined); setStatus('Choose how to connect.');
  };

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="app-frame">
        <header className="topbar">
          <button className="logo-button" onClick={reset} aria-label="Back to QRShare home"><span className="logo-mark">QR</span><span>QRShare</span></button>
          <div className="secure-badge"><span className="pulse-dot" /> Peer-to-peer</div>
        </header>

        <div className="content">
          {mode === 'home' && (
            <>
              <div className="hero">
                <div className="eyebrow"><span className="eyebrow-line" /> PRIVATE BY DESIGN <span className="eyebrow-line" /></div>
                <h1>Move files.<br /><span>Not through the cloud.</span></h1>
                <p>Fast, private file sharing between devices. Scan a QR code, connect directly, and send without uploading your files anywhere.</p>
              </div>

              {error && <div className="error" role="alert">{error}</div>}
              <div className="mode-grid">
                <button className="mode-card send-card" onClick={startSender}>
                  <span className="mode-icon"><SendIcon /></span><span className="mode-copy"><strong>Send files</strong><small>Create a private room &amp; share by QR</small></span><span className="arrow">↗</span>
                </button>
                <button className="mode-card receive-card" onClick={() => { setMode('receiver'); setStatus('Choose how to receive.'); }}>
                  <span className="mode-icon"><ReceiveIcon /></span><span className="mode-copy"><strong>Receive files</strong><small>Scan the sender&apos;s QR code</small></span><span className="arrow">↗</span>
                </button>
              </div>

              <div className="trust-row">
                <div><ShieldIcon /><span><b>Direct transfer</b><small>Files travel peer-to-peer</small></span></div>
                <div><span className="trust-number">01</span><span><b>Scan</b><small>One simple connection</small></span></div>
                <div><span className="trust-number">02</span><span><b>Send</b><small>No cloud upload</small></span></div>
              </div>
            </>
          )}

          {mode === 'sender' && (
            <div className="workspace">
              <div className="workspace-head"><div><span className="section-kicker">SENDER</span><h2>Choose what to send</h2><p>Select one or more files, then let the receiver scan your QR.</p></div><div className="step-count">01 <span>/ 02</span></div></div>
              {error && <div className="error" role="alert">{error}</div>}
              <label className="dropzone"><span className="drop-icon"><SendIcon /></span><strong>Choose files</strong><span>Any file type · Multiple files supported</span><input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))}/></label>
              {files.length > 0 && <div className="file-list">{files.map((f) => <div className="file-row" key={`${f.name}-${f.size}`}><span className="file-type">FILE</span><span className="file-name">{f.name}<small>{(f.size / 1024 / 1024).toFixed(2)} MB</small></span><span className="file-check">✓</span></div>)}</div>}
              {qr && <div className="qr-panel"><div><span className="section-kicker">READY TO CONNECT</span><h3>Scan this code</h3><p>Open QRShare on the receiving device and scan.</p><div className="status-pill"><span className="pulse-dot" /> {status}</div></div><div className="qr-wrap"><img className="qr" src={qr} alt="Scan this QR code to receive the files" /></div></div>}
              {!qr && <div className="connection-note"><span className="lock-dot">⌁</span><span><b>Private connection</b><small>Your files never pass through our servers.</small></span></div>}
              {accepted && <div className="success-note">✓ Receiver approved the transfer.</div>}
              {progress > 0 && <div className="progress-wrap"><div><span>Transfer progress</span><b>{progress}%</b></div><progress max="100" value={progress} /></div>}
              <button className="primary-action" disabled={!files.length || status !== 'Peer connected.' || sendingRef.current} onClick={prepareSend}>{sendingRef.current ? 'Sending…' : 'Send selected files'} <span>→</span></button>
            </div>
          )}

          {mode === 'receiver' && !downloadUrl && (
            <div className="workspace">
              <div className="workspace-head"><div><span className="section-kicker">RECEIVER</span><h2>Scan to connect</h2><p>Point your camera at the sender&apos;s QR code. Nothing is uploaded.</p></div><div className="step-count">02 <span>/ 02</span></div></div>
              {error && <div className="error" role="alert">{error}</div>}
              {(status === 'Choose how to receive.' || status === 'Joining secure session…' || status === 'Connected to session. Waiting for sender…') && <><div className="scanner-frame"><Scanner onScan={onScan}/><div className="scan-corners" /></div><div className="scan-status"><span className="pulse-dot" /> {status === 'Choose how to receive.' ? 'Ready to scan' : status}</div><div className="or-divider"><span>OR PASTE QR PAYLOAD</span></div><textarea placeholder="Paste the QR payload here…" aria-label="QR payload" onChange={(e) => { const text = e.target.value.trim(); if (!text) return; try { joinSession(parseSessionQr(text)); } catch { /* incomplete payload */ } }} /></>}
              {incoming && <div className="incoming-card"><div className="incoming-top"><span className="file-type">FILE</span><div><strong>{incoming.name}</strong><small>{(incoming.size / 1024 / 1024).toFixed(2)} MB</small></div></div><div className="incoming-progress"><span style={{ width: `${Math.round((incoming.received / Math.max(incoming.size, 1)) * 100)}%` }} /></div><small>{Math.round((incoming.received / Math.max(incoming.size, 1)) * 100)}% received</small><button className="primary-action" onClick={acceptIncoming}>Accept transfer <span>→</span></button></div>}
            </div>
          )}

          {downloadUrl && <div className="complete-screen"><div className="complete-icon">✓</div><span className="section-kicker">TRANSFER COMPLETE</span><h2>Your file is ready.</h2><p>{incoming?.name} was transferred directly to this device.</p><a className="primary-action download" href={downloadUrl} download={incoming?.name}>Download {incoming?.name} <span>↓</span></a></div>}

          {mode !== 'home' && <button className="back-link" onClick={reset}>← Start over</button>}
        </div>

        <footer className="footer"><span>QRShare MVP</span><span>Encrypted peer-to-peer transport via WebRTC</span><span>Built for simple sharing.</span></footer>
      </section>
    </main>
  );
}
