"use client";

// Signaling payload encryption: handshakes are AES-GCM encrypted with a
// key derived from the document's edit key, so only edit-key holders
// can complete a WebRTC handshake — the mesh stays editors-only even
// though the signaling mailbox itself is open.

async function deriveKey(editKey: string, docId: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`${editKey}:${docId}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export class SignalCrypto {
  private keyPromise: Promise<CryptoKey>;

  constructor(editKey: string, docId: string) {
    this.keyPromise = deriveKey(editKey, docId);
  }

  async encrypt(payload: unknown): Promise<string> {
    const key = await this.keyPromise;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
    );
    const packed = new Uint8Array(iv.length + ciphertext.length);
    packed.set(iv);
    packed.set(ciphertext, iv.length);
    return toBase64(packed);
  }

  // Returns null for payloads encrypted with a different key (ignored)
  async decrypt(value: string): Promise<unknown | null> {
    try {
      const key = await this.keyPromise;
      const packed = fromBase64(value);
      const iv = packed.slice(0, 12);
      const ciphertext = packed.slice(12);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        ciphertext
      );
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      return null;
    }
  }
}
