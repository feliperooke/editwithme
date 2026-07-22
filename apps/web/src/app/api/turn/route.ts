import { NextResponse } from "next/server";

// ICE servers for the WebRTC mesh: Google's public STUN always, plus
// short-lived Cloudflare TURN credentials when configured
// (CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN env vars).
// TURN relays traffic for the ~15-25% of peers whose NATs block P2P.

interface CachedIceServers {
  iceServers: unknown[];
  expiresAt: number;
}

const globalForTurn = globalThis as unknown as {
  __turnCache?: CachedIceServers;
};

const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const CREDENTIAL_TTL_SECONDS = 4 * 60 * 60;

export async function GET() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !apiToken) {
    return NextResponse.json({ iceServers: STUN_SERVERS });
  }

  const cached = globalForTurn.__turnCache;
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ iceServers: cached.iceServers });
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
      }
    );
    if (!response.ok) throw new Error(`Cloudflare TURN ${response.status}`);
    const data = (await response.json()) as { iceServers: unknown };
    const turnServers = Array.isArray(data.iceServers)
      ? data.iceServers
      : [data.iceServers];
    const iceServers = [...STUN_SERVERS, ...turnServers];
    globalForTurn.__turnCache = {
      iceServers,
      // Renew at half the TTL so clients never receive stale credentials
      expiresAt: Date.now() + (CREDENTIAL_TTL_SECONDS / 2) * 1000,
    };
    return NextResponse.json({ iceServers });
  } catch {
    // TURN unavailable: degrade to STUN-only (direct/LAN pairs still work)
    return NextResponse.json({ iceServers: STUN_SERVERS });
  }
}
