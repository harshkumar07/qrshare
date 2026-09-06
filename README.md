# QRShare

QRShare is a browser-based peer-to-peer file sharing application. A sender creates a short-lived session, shows a QR code, and a receiver scans it to establish a WebRTC connection and transfer files directly between devices.

## Current architecture

```text
                     HTTPS / WSS
Sender Browser ────────────────┐
                               │
Receiver Browser ──────────────┤
                               ▼
                         Next.js on Vercel
                         ├── React UI
                         ├── QR generation/scanning
                         └── WebSocket signaling
                               │
                               │ SDP / ICE only
                               ▼
                    WebRTC DataChannel
                       │            │
                       └── file data ──► Receiver
```

The signaling layer coordinates the WebRTC handshake. File bytes are not sent through the signaling service.

## Technology

- Next.js App Router + React + TypeScript.
- WebRTC `RTCDataChannel` for peer-to-peer file transfer.
- Vercel WebSocket Functions for signaling in production.
- `html5-qrcode` for browser camera scanning.
- `qrcode` for QR generation.
- Shared TypeScript protocol package under `packages/protocol`.

The web application was migrated from Vite to Next.js so the frontend and the Vercel WebSocket signaling endpoint can live in the same deployment.

## Repository structure

```text
qrshare/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── api/ws/route.ts   # Vercel WebSocket signaling endpoint
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx
│   │   └── src/
│   │       ├── App.tsx            # Client UI and session flow
│   │       ├── qr.ts
│   │       ├── scanner.tsx
│   │       └── webrtc.ts           # WebRTC transfer layer
│   └── signaling/                  # Standalone Node signaling server for local/fallback use
├── packages/
│   └── protocol/                   # Shared signaling/file-transfer types
├── package.json
└── README.md
```

## Local development

Install dependencies from the repository root:

```bash
npm install
```

Run the Next.js frontend:

```bash
npm run dev:web
```

The local browser app defaults to the existing standalone signaling server at `ws://localhost:8787`. In another terminal run:

```bash
npm run dev:signaling
```

This keeps local development reliable because Vercel's WebSocket upgrade runtime is provided by Vercel Functions rather than ordinary `next dev`.

## Production deployment on Vercel

Create a Vercel project from this repository and set the project **Root Directory** to:

```text
apps/web
```

Use the Next.js framework preset. The build command is:

```text
npm run build
```

The production application automatically uses:

```text
wss://<your-domain>/api/ws
```

unless `NEXT_PUBLIC_SIGNALING_URL` is explicitly set.

Vercel added WebSocket support for Vercel Functions in June 2026. The WebSocket endpoint is implemented in `apps/web/app/api/ws/route.ts`. See the Vercel WebSocket documentation for current platform limits and deployment behavior.

### Important scaling note

The current signaling route keeps session state in the Function instance's memory. This is suitable for the first MVP and for controlled testing, but Vercel does not guarantee that separate WebSocket connections will land on the same Function instance. For production-scale signaling, move session coordination to shared durable state such as Redis. The WebRTC file transfer itself remains peer-to-peer.

## QR/session flow

1. Sender opens QRShare and selects files.
2. Sender creates a temporary signaling session.
3. QRShare generates a QR payload containing the session ID and signaling URL.
4. Receiver scans the QR code.
5. Receiver joins the signaling session.
6. Sender creates a WebRTC offer.
7. Receiver returns an answer.
8. Both peers exchange ICE candidates through signaling.
9. The WebRTC DataChannel becomes connected.
10. Receiver approves the incoming transfer.
11. File metadata and chunks travel over the DataChannel.
12. Receiver reconstructs the file locally and provides a download link.

## File transfer design

Files are transferred in chunks with DataChannel backpressure. The receiver collects chunks and verifies that the number of received bytes matches the advertised file size before exposing the completed file.

The signaling service should never receive the file bytes.

## Security and privacy

- Session IDs are generated with cryptographically strong random UUIDs.
- Sessions expire after a short TTL.
- A session is limited to two peers.
- The receiver explicitly accepts an incoming transfer.
- File contents are transferred through WebRTC's encrypted transport.
- File data is not placed in the QR payload.
- File data is not stored by the signaling layer.

## Current MVP status

Implemented:

- Next.js frontend migration.
- Sender and receiver flows.
- QR generation.
- QR camera scanning.
- Temporary signaling sessions.
- WebSocket signaling endpoint for Vercel.
- WebRTC offer/answer and ICE exchange.
- Direct DataChannel file transfer.
- Chunking and backpressure.
- Multi-file sender flow.
- Receiver acceptance flow.
- Transfer progress.
- Completed-file download.

Next reliability improvements:

1. Shared Redis-backed signaling state for multi-instance Vercel deployments.
2. TURN servers for networks where direct WebRTC connectivity fails.
3. Transfer integrity hashes.
4. Better reconnect/resume behavior for interrupted large transfers.
5. Automated two-browser/device end-to-end tests.

## Product principles

- QR-first connection.
- No account required.
- Peer-to-peer file movement.
- Temporary sessions.
- No unnecessary server-side file storage.
- Clear sender/receiver state.
- Large-file friendly chunked transfer.
