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
- ⚠️ Pendiente: ElevenLabs solo permite integraciones de terceros (como LiveAvatar) en
  **cuentas de pago** (plan Starter, $5/mes). Con el plan activo, ejecutar:

```bash
# 1. Registrar la key de ElevenLabs en LiveAvatar (devuelve secret_id)
curl -X POST https://api.liveavatar.com/v1/secrets \
  -H "X-API-KEY: $LIVEAVATAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"secret_type": "ELEVENLABS_API_KEY", "secret_value": "<ELEVENLABS_KEY>", "secret_name": "ElevenLabs JD"}'

# 2. Importar la voz (devuelve el voice_id de LiveAvatar)
curl -X POST https://api.liveavatar.com/v1/voices/third_party \
  -H "X-API-KEY: $LIVEAVATAR_API_KEY" -H "Content-Type: application/json" \
  -d '{"secret_id": "<secret_id>", "voice_id": "WbPw2BEKJmkwDvOBt9Z9"}'

# 3. Poner el voice_id devuelto en LIVEAVATAR_VOICE_ID (.env.local y Vercel)
```

## Notas

- El firewall de `api.liveavatar.com` bloquea requests de Python `urllib` (403); usa curl.
- Skills del agente instalados en `.agents/skills/` (`liveavatar-integrate`, `-debug`, `-feedback`).
- Con `LIVEAVATAR_SANDBOX=true` las llamadas son gratis (~1 min, avatar genérico); ponlo
  en `false` cuando la cuenta tenga créditos para usar a Pedro.
