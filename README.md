# QRShare

QRShare is a fast, simple peer-to-peer file sharing application designed to make transferring files between nearby devices as easy as scanning a QR code.

## Vision

The goal is to remove the friction from local file sharing. Instead of uploading a file to a cloud service, creating an account, copying a long link, or manually configuring a connection, one device can create a short-lived QR code and another device can scan it to establish a secure transfer session.

## Core Idea

**Device A (Sender)**
1. Opens QRShare.
2. Selects one or more files.
3. QRShare creates a temporary transfer session.
4. A QR code is displayed containing the information needed for the receiving device to join the session.
5. The sender waits for the receiver to connect.
6. Files are transferred directly between the devices whenever the network/browser environment allows it.

**Device B (Receiver)**
1. Opens QRShare.
2. Scans the sender's QR code.
3. Joins the temporary transfer session.
4. Sees the files and transfer details.
5. Accepts the transfer.
6. Receives the files directly from the sender.

## Product Principles

- **QR-first:** connecting two devices should take a scan rather than copying codes or typing URLs.
- **Peer-to-peer:** files should move directly between devices where technically possible, avoiding unnecessary cloud storage.
- **No account required:** local sharing should not require registration or login.
- **Temporary sessions:** connection information should expire and should not become a permanent public file link.
- **Privacy focused:** file contents should not be uploaded to a central server merely to enable sharing.
- **Fast:** support large files through streaming/chunked transfer instead of loading an entire file into memory.
- **Simple UX:** sender and receiver should always understand what is happening and who is connected.
- **Resumable where possible:** interrupted transfers should have a path to resume instead of always restarting from zero.

## Planned Features

### Initial MVP

- Sender and receiver flows.
- File and folder selection where supported by the browser.
- Dynamic QR code generation.
- QR scanning using the device camera.
- Temporary transfer/session IDs.
- Peer connection establishment.
- Direct file transfer using browser-supported peer-to-peer technology.
- Transfer progress for individual files and the overall session.
- File metadata such as name, size, and type.
- Accept/reject controls on the receiving device.
- Cancel transfer and disconnect controls.
- Success and failure states.
- Responsive desktop and mobile UI.

### Transfer Architecture

The preferred architecture is WebRTC-based peer-to-peer communication. A lightweight signaling layer will be used only to help two peers discover and establish their connection. Once the peers are connected, file data should travel over the peer connection rather than through the signaling service.

The QR code should contain only the minimum information needed to join the temporary session, such as a session identifier and connection/signaling information. It should not contain the file itself.

Large files should be transferred as chunks with backpressure so the application does not need to load the complete file into browser memory. The protocol should carry enough metadata to validate ordering, completion, and integrity.

## Security & Privacy

QRShare is intended for private, nearby file sharing, but a QR code is effectively a capability to attempt to join a session. Therefore:

- Session identifiers must be unpredictable.
- Sessions should expire automatically.
- A session should not be reusable indefinitely.
- The receiver should explicitly accept incoming transfers.
- File metadata should be shown before acceptance where possible.
- The application should never expose unnecessary file contents to the signaling server.
- Peer connections should use WebRTC's built-in encrypted transport.
- The implementation must avoid putting sensitive file data into URLs, QR payloads, logs, or analytics.
- Transfer integrity should be checked so corrupted/incomplete files are not silently presented as successful.

## User Experience

### Sender

The sender should have a clear primary action such as **Send files**. After selecting files, QRShare should immediately present a large, easy-to-scan QR code together with a short status such as:

> Waiting for receiver…

After a receiver joins:

> Receiver connected — ready to send

During transfer, show progress, speed, transferred size, remaining size, and an option to cancel.

### Receiver

The receiver should have a clear primary action such as **Scan QR code**. After scanning, QRShare should display the sender/session information and selected files before asking for confirmation.

During transfer, show clear progress and completion status. The receiver should never be left wondering whether a transfer is still running.

## Technology Direction

The project should start as a modern web application so it works across common desktop and mobile browsers without requiring users to install a native application.

Potential core technologies:

- React + TypeScript for the frontend.
- WebRTC DataChannel for peer-to-peer data transfer.
- A small Node.js/TypeScript signaling service for session discovery and WebRTC signaling.
- A QR generation library for creating session QR codes.
- A browser QR scanning library using the camera.
- Web APIs such as File, Blob, Streams, and IndexedDB where useful.

The exact libraries can be selected during implementation based on browser compatibility, maintenance, bundle size, and security.

## High-Level Flow

```text
Sender Browser
    |
    | 1. Select files
    v
QRShare Session
    |
    | 2. Generate temporary session
    v
QR Code
    |
    | 3. Scan
    v
Receiver Browser
    |
    | 4. Join/signaling
    +--------------------+
                         |
                    WebRTC setup
                         |
                         v
              Direct P2P DataChannel
                         |
              Chunked file transfer
                         |
              Receiver downloads file
```

## Signaling vs File Data

The signaling server is **not** intended to be a file-storage server.

It is responsible for short-lived coordination such as:

- Creating a session.
- Allowing a receiver to join using the session information.
- Exchanging WebRTC offer/answer information.
- Exchanging ICE candidates when required.
- Reporting connection/session state.

It should not receive or permanently store the files being transferred.

## Reliability

The implementation should account for real-world conditions:

- Large files.
- Multiple files in one transfer.
- Slow connections.
- Temporary connection drops.
- Browser tab suspension.
- Receiver rejecting a transfer.
- Sender cancelling a transfer.
- Duplicate or stale session QR codes.
- Invalid/expired QR payloads.
- Transfer corruption or incomplete chunks.

The protocol should have explicit session and transfer states rather than relying only on UI state.

## Suggested Repository Structure

```text
qrshare/
├── apps/
│   ├── web/                 # React + TypeScript client
│   └── signaling/           # Node.js signaling service
├── packages/
│   ├── protocol/            # Shared message/protocol types
│   └── shared/              # Shared utilities and validation
├── README.md
├── package.json
└── ...
```

This structure can evolve as implementation begins; it is a starting point rather than a rigid requirement.

## MVP Success Criteria

QRShare's first usable version should allow two people with nearby devices to:

1. Open the application without creating accounts.
2. Select a file on the sender device.
3. Display a QR code.
4. Scan that QR code from the receiver device.
5. Establish a peer connection.
6. Confirm the incoming file.
7. Transfer the file directly between peers.
8. See reliable progress.
9. Receive the completed file successfully.
10. End/expire the session after the transfer.

## Future Ideas

- Multi-device receiving.
- Multiple simultaneous transfers.
- Folder transfer and automatic ZIP packaging where necessary.
- Transfer history stored locally on the device.
- Optional passcode protection in addition to the QR code.
- Optional end-to-end application-level encryption on top of WebRTC.
- Resume interrupted large transfers.
- Native mobile/desktop clients using the same protocol.
- Local-network discovery as an alternative to QR scanning.
- Share text, links, and clipboard content in addition to files.
- Drag-and-drop sending.
- Transfer speed optimization and adaptive chunk sizing.

## Status

**Current stage: Project definition / initial implementation.**

The repository currently contains the product direction and technical foundation described above. Implementation should prioritize a working end-to-end file transfer over visual polish: sender → QR → receiver → peer connection → file transfer → verified completion.
