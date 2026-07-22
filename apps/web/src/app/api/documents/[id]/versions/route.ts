import { NextResponse } from "next/server";
import { listVersions } from "@/lib/versions";

type Context = { params: Promise<{ id: string }> };

// Version history list. Read access = knowing the document id, same
// capability rule as reading the document itself.
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  return NextResponse.json(await listVersions(id));
}
