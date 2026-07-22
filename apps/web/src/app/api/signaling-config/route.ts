import { NextResponse } from "next/server";

// Tells the client which signaling transport to use. Firebase config is
// served at runtime (instead of NEXT_PUBLIC build-time vars) so the
// image needs no rebuild when the project wiring changes.
export async function GET() {
  const apiKey = process.env.FIREBASE_API_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (apiKey && projectId) {
    return NextResponse.json({
      transport: "firestore",
      apiKey,
      projectId,
      appId: process.env.FIREBASE_APP_ID ?? null,
    });
  }
  return NextResponse.json({ transport: "poll" });
}
