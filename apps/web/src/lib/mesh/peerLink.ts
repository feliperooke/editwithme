import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { Awareness } from "y-protocols/awareness";

// Yjs sync + awareness over a generic byte transport (a WebRTC data
// channel in production; an in-memory pair in tests). One PeerLink per
// connected peer; the mesh fans document/awareness updates out to all
// links and feeds inbound bytes into receive().

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface LinkTransport {
  send(data: Uint8Array): void;
}

export class PeerLink {
  constructor(
    private transport: LinkTransport,
    private ydoc: Y.Doc,
    private awareness: Awareness
  ) {}

  // Kicks off the handshake: sync step 1 + full awareness snapshot
  start() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.ydoc);
    this.transport.send(encoding.toUint8Array(encoder));

    const states = Array.from(this.awareness.getStates().keys());
    if (states.length > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)
      );
      this.transport.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  receive(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        // `this` as origin: the mesh skips echoing updates back here
        syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, this);
        if (encoding.length(encoder) > 1) {
          this.transport.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case MESSAGE_AWARENESS:
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this
        );
        break;
    }
  }

  sendDocUpdate(update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.transport.send(encoding.toUint8Array(encoder));
  }

  sendAwarenessUpdate(update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    this.transport.send(encoding.toUint8Array(encoder));
  }
}
