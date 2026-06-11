# raaamp — AI Live Avatar (Pedro)

Web app standalone (Next.js) con un avatar de IA en vivo de HeyGen LiveAvatar que actúa como
recepcionista virtual de [raaamp.co](https://raaamp.co): habla español, responde por voz en
tiempo real y conoce los servicios, precios y casos de éxito de raaamp.

## Cómo correrlo

```bash
npm install
npm run dev
```

Abre http://localhost:3000, pulsa **Iniciar llamada** y acepta el permiso de micrófono.

## Arquitectura

- **Modo FULL de LiveAvatar**: HeyGen maneja todo el pipeline (ASR → LLM → TTS → video).
  Cuesta 2 créditos/minuto por sesión.
- **`app/api/session/route.ts`** (backend): crea el token de sesión contra
  `api.liveavatar.com` usando la API key secreta. La key **nunca** llega al navegador.
- **`components/AvatarCall.tsx`** (frontend): usa `@heygen/liveavatar-web-sdk`
  (`LiveAvatarSession`) para conectarse vía LiveKit, renderizar el video, manejar el
  micrófono (mute/unmute), subtítulos en vivo y transcripción. Envía keep-alive cada 2 min
  (el timeout de LiveAvatar es de 5 min).
- **`components/chromaKey.ts`**: los avatares públicos llegan con fondo verde; este módulo
  lo elimina en el cliente con un shader WebGL (chroma key estilo OBS + supresión de spill)
  y lo reemplaza por la escena oscura de la marca.

## Configuración (`.env.local`)

| Variable | Valor actual | Descripción |
|---|---|---|
| `LIVEAVATAR_API_KEY` | (secreta) | API key de app.liveavatar.com |
| `LIVEAVATAR_AVATAR_ID` | `7001c332-…` | "Pedro in Blue Shirt" (avatar público) |
| `LIVEAVATAR_AVATAR_ID_PORTRAIT` | `9a5a4cb2-…` | Variante vertical para móviles en retrato |
| `LIVEAVATAR_VOICE_ID` | `98a984cd-…` | Voz preset "Pedro - IA" |
| `LIVEAVATAR_CONTEXT_ID` | `58153880-…` | Contexto "raaamp - Recepcionista Pedro (ES)" |
| `LIVEAVATAR_LANGUAGE` | `es` | Idioma de la conversación |
| `LIVEAVATAR_SANDBOX` | `false` | `true` = pruebas gratis (~1 min, avatar fijo de sandbox) |

## Cambiar la personalidad / conocimiento

El "cerebro" del avatar vive en un **contexto** de LiveAvatar (prompt + saludo + links).
Para editarlo, haz un `PUT`/`PATCH` al contexto o crea uno nuevo:

```bash
curl -X POST https://api.liveavatar.com/v1/contexts \
  -H "X-API-KEY: $LIVEAVATAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "...", "prompt": "...", "opening_text": "..."}'
```

y pon el `id` devuelto en `LIVEAVATAR_CONTEXT_ID`.

## Cambiar de avatar

Los avatares públicos se listan con:

```bash
curl https://api.liveavatar.com/v1/avatars/public -H "X-API-KEY: $LIVEAVATAR_API_KEY"
```

(El endpoint `/v1/avatars` solo muestra los avatares propios de la cuenta.)
Hay 6 variantes de Pedro (sitting / black suit / blue shirt, en horizontal y vertical).

## Despliegue en Vercel

1. En [vercel.com/new](https://vercel.com/new) importa el repo `juanda89/avatarraaamp`.
2. En **Environment Variables** agrega todas las variables de la tabla de arriba
   (los mismos valores de tu `.env.local`).
3. Deploy. Vercel sirve con HTTPS, requisito para que el micrófono funcione en móviles.

Cada `git push` a `main` redespliega automáticamente.

## Voz colombiana (acento paisa) — estado

Las 20 voces preset de LiveAvatar son en inglés; por eso el español suena con acento
gringo. La solución es una voz de ElevenLabs:

- ✅ Voz elegida y agregada a la cuenta de ElevenLabs: **"Christian - Calm Latin voice"**
  (hombre, acento de Medellín), ElevenLabs voice ID `WbPw2BEKJmkwDvOBt9Z9`.
- ✅ Script de activación listo: con `ELEVENLABS_API_KEY` en `.env.local`, ejecutar

  ```bash
  node scripts/activar-voz-colombiana.mjs
  ```

  Registra la key en LiveAvatar, importa la voz y actualiza `LIVEAVATAR_VOICE_ID`
  en `.env.local`; al final imprime el valor para copiarlo a Vercel y redesplegar.
- ⚠️ Único pendiente: ElevenLabs solo permite integraciones de terceros (como
  LiveAvatar) en **cuentas de pago** (plan Starter, $5/mes). En plan gratis el script
  lo detecta y te lo dice. Solo las voces externas tienen este requisito — el resto
  de la app no depende de ElevenLabs.

  Nota: el API de LiveAvatar solo importa voces de ElevenLabs (sus secretos aceptan
  únicamente claves de OpenAI, ElevenLabs y Gemini). Voces de Fish Audio u otros
  proveedores solo serían posibles re-arquitecturando a modo LITE (pipeline propio
  de STT + LLM + TTS).

## Notas

- El firewall de `api.liveavatar.com` bloquea requests de Python `urllib` (403); usa curl.
- Skills del agente instalados en `.agents/skills/` (`liveavatar-integrate`, `-debug`, `-feedback`).
- Con `LIVEAVATAR_SANDBOX=true` las llamadas son gratis (~1 min, avatar genérico); ponlo
  en `false` cuando la cuenta tenga créditos para usar a Pedro.
