import { NextResponse } from "next/server";
import { readVersion } from "@/lib/versions";

type Context = { params: Promise<{ id: string; at: string }> };

// One version's snapshot: { at, html }.
export async function GET(_request: Request, { params }: Context) {
  const { id, at } = await params;
  const version = await readVersion(id, Number(at));
  if (!version) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }
  return NextResponse.json(version);
}
