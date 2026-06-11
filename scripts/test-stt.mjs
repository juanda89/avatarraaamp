#!/usr/bin/env node
/**
 * Test automatizado de STT: crea una sesión sandbox, se une a la sala
 * LiveKit desde Node, publica un audio en español como si fuera el
 * micrófono del usuario y muestra lo que el proveedor de STT transcribe.
 *
 * Uso: node scripts/test-stt.mjs <provider> [ruta.wav]
 *      provider: gladia | deepgram | assembly_ai | elevenlabs | none
 *      (el wav debe ser PCM 16-bit, 48kHz, mono; default .tmp/es_test.wav)
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Room,
  RoomEvent,
  AudioSource,
  LocalAudioTrack,
  AudioFrame,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";

const API = "https://api.liveavatar.com";
const SANDBOX_AVATAR = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const provider = process.argv[2] ?? "gladia";
const wavPath = process.argv[3] ?? resolve(root, ".tmp/es_test.wav");

const env = readFileSync(resolve(root, ".env.local"), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const API_KEY = get("LIVEAVATAR_API_KEY");
const CONTEXT_ID = get("LIVEAVATAR_CONTEXT_ID");

// --- 1. crear sesión sandbox con el proveedor pedido ---
const persona = { context_id: CONTEXT_ID, language: "es" };
if (provider !== "none") persona.stt_config = { provider };

const tokenRes = await fetch(`${API}/v1/sessions/token`, {
  method: "POST",
  headers: { "X-API-KEY": API_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    mode: "FULL",
    is_sandbox: true,
    avatar_id: SANDBOX_AVATAR,
    // push-to-talk: nosotros delimitamos el audio, sin depender del VAD
    interactivity_type: "PUSH_TO_TALK",
    avatar_persona: persona,
  }),
}).then((r) => r.json());

const sessionToken = tokenRes.data.session_token;

const startRes = await fetch(`${API}/v1/sessions/start`, {
  method: "POST",
  headers: { Authorization: `Bearer ${sessionToken}` },
}).then((r) => r.json());

const { livekit_url, livekit_client_token } = startRes.data;
console.log(`[stt=${provider}] sesión iniciada, conectando a LiveKit…`);

// --- 2. unirse a la sala y escuchar transcripciones ---
const room = new Room();
const transcripts = [];
let greetingDone;
const greetingPromise = new Promise((r) => (greetingDone = r));

room.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
  if (topic !== "agent-response") return;
  try {
    const ev = JSON.parse(Buffer.from(payload).toString("utf8"));
    if (ev.event_type === "user.transcription") {
      transcripts.push(ev.text);
      console.log(`  >> usuario (STT): "${ev.text}"`);
    } else if (ev.event_type === "avatar.transcription") {
      console.log(`  << avatar: "${ev.text.slice(0, 90)}"`);
    } else if (!ev.event_type.includes("chunk")) {
      console.log(`  -- ${ev.event_type}`);
    }
    if (ev.event_type === "avatar.speak_ended") greetingDone();
  } catch {}
});

await room.connect(livekit_url, livekit_client_token, {
  autoSubscribe: true,
  dynacast: false,
});
console.log("conectado; esperando a que el avatar termine el saludo…");
await Promise.race([
  greetingPromise,
  new Promise((r) => setTimeout(r, 15000)),
]);
await new Promise((r) => setTimeout(r, 1500));

// --- 3. publicar el wav como micrófono ---
const wav = readFileSync(wavPath);
const dataIdx = wav.indexOf(Buffer.from("data")) + 8;
const pcm = new Int16Array(
  wav.buffer,
  wav.byteOffset + dataIdx,
  (wav.length - dataIdx) / 2,
);

const source = new AudioSource(48000, 1);
const track = LocalAudioTrack.createAudioTrack("mic", source);
const opts = new TrackPublishOptions();
opts.source = TrackSource.SOURCE_MICROPHONE;
await room.localParticipant.publishTrack(track, opts);

// diagnóstico: ¿quién está en la sala y quién se suscribe a mi pista?
room.on(RoomEvent.LocalTrackSubscribed, () =>
  console.log("  -- el agente se suscribió a mi audio ✓"),
);
console.log(
  "  participantes remotos:",
  [...room.remoteParticipants.values()].map((p) => p.identity).join(", "),
);

// RMS para confirmar que el wav no está en silencio
let acc = 0;
for (let i = 0; i < pcm.length; i++) acc += pcm[i] * pcm[i];
console.log("  RMS del wav:", Math.sqrt(acc / pcm.length).toFixed(0));

const sendCommand = (event_type) =>
  room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({ event_type })),
    { reliable: true, topic: "agent-control" },
  );

console.log("push-to-talk: start…");
await sendCommand("user.start_push_to_talk");
await new Promise((r) => setTimeout(r, 1000));

console.log(`hablando (${(pcm.length / 48000).toFixed(1)}s de audio)…`);
const CHUNK = 480; // 10ms exactos; el último frame se rellena con ceros
const silence = new Int16Array(CHUNK);
const frame = (slice) => {
  if (slice.length === CHUNK)
    return new AudioFrame(slice, 48000, 1, CHUNK);
  const padded = new Int16Array(CHUNK);
  padded.set(slice);
  return new AudioFrame(padded, 48000, 1, CHUNK);
};
for (let i = 0; i < pcm.length; i += CHUNK) {
  await source.captureFrame(frame(pcm.subarray(i, Math.min(i + CHUNK, pcm.length))));
}
for (let i = 0; i < 100; i++) {
  await source.captureFrame(new AudioFrame(silence, 48000, 1, CHUNK));
}
// vaciar la cola interna antes de cerrar la ventana PTT
await source.waitForPlayout();
await new Promise((r) => setTimeout(r, 1500));

console.log("push-to-talk: stop…");
await sendCommand("user.stop_push_to_talk");

console.log("audio enviado; esperando transcripción (20s)…");
await new Promise((r) => setTimeout(r, 20000));

await room.disconnect();
await fetch(`${API}/v1/sessions/stop`, {
  method: "POST",
  headers: { Authorization: `Bearer ${sessionToken}` },
}).catch(() => {});

console.log(`\nRESULTADO [stt=${provider}]:`);
console.log(
  transcripts.length
    ? transcripts.map((t) => `  "${t}"`).join("\n")
    : "  (sin transcripción)",
);
process.exit(0);
