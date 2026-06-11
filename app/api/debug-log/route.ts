import { NextResponse } from "next/server";

// Recibe eventos del cliente cuando la página corre con ?debug=1.
// Solo para diagnóstico local; en producción no hace nada.
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const body = await req.text();
  console.log(`[debug-cliente] ${body}`);
  return NextResponse.json({ ok: true });
}
