#!/usr/bin/env node
/**
 * Activa la voz colombiana (acento paisa) del avatar.
 *
 * Requisito: plan de pago en ElevenLabs (Starter, $5/mes) — su API bloquea
 * integraciones de terceros como LiveAvatar en cuentas gratis.
 *
 * Uso:  node scripts/activar-voz-colombiana.mjs
 *
 * Lee las keys de .env.local, registra la key de ElevenLabs en LiveAvatar,
 * importa la voz "Christian" (hombre, Medellín) y actualiza
 * LIVEAVATAR_VOICE_ID en .env.local. Después solo falta copiar el nuevo
 * valor a Vercel y redesplegar.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.liveavatar.com";

// Voz elegida en ElevenLabs: "Christian - Calm Latin voice" (acento Medellín),
// ya agregada a la cuenta de ElevenLabs del proyecto.
const ELEVENLABS_VOICE_ID = "WbPw2BEKJmkwDvOBt9Z9";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local");

function leerEnv() {
  const text = readFileSync(envPath, "utf8");
  const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
  return { text, get };
}

async function llamar(path, body, apiKey) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.code === 1000, json };
}

const { text, get } = leerEnv();
const laKey = get("LIVEAVATAR_API_KEY");
const elKey = get("ELEVENLABS_API_KEY");

if (!laKey || !elKey) {
  console.error("Faltan LIVEAVATAR_API_KEY o ELEVENLABS_API_KEY en .env.local");
  process.exit(1);
}

console.log("1/3 Registrando la key de ElevenLabs en LiveAvatar…");
const secreto = await llamar(
  "/v1/secrets",
  {
    secret_type: "ELEVENLABS_API_KEY",
    secret_value: elKey,
    secret_name: "ElevenLabs raaamp",
  },
  laKey,
);

if (!secreto.ok) {
  const msg = JSON.stringify(secreto.json);
  if (msg.includes("paid users")) {
    console.error(
      "\n✗ ElevenLabs sigue en plan gratis. Activa el plan Starter ($5/mes)\n" +
        "  en https://elevenlabs.io/pricing y vuelve a ejecutar este script.",
    );
  } else {
    console.error("\n✗ Error registrando el secreto:", msg);
  }
  process.exit(1);
}

const secretId = secreto.json.data.id;
console.log(`    ✓ secret_id: ${secretId}`);

console.log("2/3 Importando la voz paisa (Christian, Medellín)…");
const voz = await llamar(
  "/v1/voices/third_party",
  { secret_id: secretId, provider_voice_id: ELEVENLABS_VOICE_ID },
  laKey,
);

if (!voz.ok) {
  console.error("\n✗ Error importando la voz:", JSON.stringify(voz.json));
  process.exit(1);
}

const nuevaVozId = voz.json.data.id;
console.log(`    ✓ voice_id en LiveAvatar: ${nuevaVozId}`);

console.log("3/3 Actualizando LIVEAVATAR_VOICE_ID en .env.local…");
writeFileSync(
  envPath,
  text.replace(/^LIVEAVATAR_VOICE_ID=.*$/m, `LIVEAVATAR_VOICE_ID=${nuevaVozId}`),
);
console.log("    ✓ listo");

console.log(`
🎉 Voz colombiana activada en local.

Pasos finales para producción:
  1. En Vercel → Settings → Environment Variables, cambia
     LIVEAVATAR_VOICE_ID a: ${nuevaVozId}
  2. Redeploy.
`);
