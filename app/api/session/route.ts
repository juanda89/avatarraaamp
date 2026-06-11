import { NextResponse } from "next/server";

const API_URL = "https://api.liveavatar.com";

// Avatar fijo del sandbox de LiveAvatar (gratis, sesiones de ~1 min)
const SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

export async function POST(req: Request) {
  // pantallas en retrato (móvil) usan la variante vertical del avatar
  let portrait = false;
  try {
    portrait = Boolean((await req.json())?.portrait);
  } catch {
    // sin body → landscape
  }

  const apiKey = process.env.LIVEAVATAR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta LIVEAVATAR_API_KEY en .env.local" },
      { status: 500 },
    );
  }

  const sandbox = process.env.LIVEAVATAR_SANDBOX === "true";

  // con 0 créditos el token se crea pero la sesión falla al arrancar:
  // mejor avisar claro antes (el sandbox no consume créditos)
  if (!sandbox) {
    const creditsRes = await fetch(`${API_URL}/v1/users/credits`, {
      headers: { "X-API-KEY": apiKey },
      cache: "no-store",
    });
    if (creditsRes.ok) {
      const credits = parseFloat(
        (await creditsRes.json()).data?.credits_left ?? "0",
      );
      if (credits <= 0) {
        return NextResponse.json(
          {
            error:
              "La cuenta de LiveAvatar no tiene créditos. Recarga en app.liveavatar.com, o activa el modo de prueba gratis poniendo LIVEAVATAR_SANDBOX=true en .env.local.",
          },
          { status: 402 },
        );
      }
    }
  }

  const body = {
    mode: "FULL",
    ...(sandbox && { is_sandbox: true }),
    avatar_id: sandbox
      ? SANDBOX_AVATAR_ID
      : (portrait && process.env.LIVEAVATAR_AVATAR_ID_PORTRAIT) ||
        process.env.LIVEAVATAR_AVATAR_ID,
    avatar_persona: {
      voice_id: process.env.LIVEAVATAR_VOICE_ID,
      context_id: process.env.LIVEAVATAR_CONTEXT_ID,
      language: process.env.LIVEAVATAR_LANGUAGE ?? "es",
    },
  };

  const res = await fetch(`${API_URL}/v1/sessions/token`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("LiveAvatar token error:", res.status, detail);
    return NextResponse.json(
      { error: "No se pudo crear la sesión con LiveAvatar", detail },
      { status: 502 },
    );
  }

  const json = await res.json();
  return NextResponse.json({
    sessionToken: json.data.session_token,
    sandbox,
  });
}
