"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveAvatarSession,
  SessionEvent,
  AgentEventsEnum,
  VoiceChatEvent,
  SessionDisconnectReason,
} from "@heygen/liveavatar-web-sdk";
import { startChromaKey } from "./chromaKey";

const POSTER_URL =
  "https://files2.heygen.ai/avatar/v3/2a658e2358c24bf299c40701a82f40c2_55410/preview_target.webp";

// variante vertical del mismo avatar para móviles en retrato
const POSTER_PORTRAIT_URL =
  "https://files2.heygen.ai/avatar/v3/45f7de4da32248ef952a8db325aee258_55910/preview_target.webp";

const KEEP_ALIVE_MS = 120_000;

type CallState = "idle" | "connecting" | "live" | "ended" | "error";

type TranscriptEntry = {
  id: number;
  role: "user" | "avatar";
  text: string;
};

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function AvatarCall() {
  const [callState, setCallState] = useState<CallState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [micPermDenied, setMicPermDenied] = useState(false);
  const [micRetryFailed, setMicRetryFailed] = useState(false);
  const [isSandbox, setIsSandbox] = useState(false);
  const [avatarSpeaking, setAvatarSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [caption, setCaption] = useState<TranscriptEntry | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chromaStopRef = useRef<(() => void) | null>(null);
  const [chromaFailed, setChromaFailed] = useState(false);
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptBodyRef = useRef<HTMLDivElement>(null);
  const entryIdRef = useRef(0);

  const cleanup = useCallback(() => {
    if (keepAliveRef.current) clearInterval(keepAliveRef.current);
    if (clockRef.current) clearInterval(clockRef.current);
    keepAliveRef.current = null;
    clockRef.current = null;
    chromaStopRef.current?.();
    chromaStopRef.current = null;
    sessionRef.current = null;
    setAvatarSpeaking(false);
    setUserSpeaking(false);
    setCaption(null);
    setMuted(false);
  }, []);

  useEffect(() => {
    return () => {
      sessionRef.current?.stop().catch(() => {});
      cleanup();
    };
  }, [cleanup]);

  // ?autostart=1 lanza la llamada al cargar (pruebas / modo kiosco)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (new URLSearchParams(window.location.search).get("autostart") === "1") {
      autoStartedRef.current = true;
      startCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autoscroll de la transcripción
  useEffect(() => {
    const el = transcriptBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, caption]);

  // con ?debug=1 reporta eventos al servidor (diagnóstico local)
  const debugLog = useCallback((tag: string, data?: unknown) => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("debug") !== "1")
      return;
    navigator.sendBeacon(
      "/api/debug-log",
      JSON.stringify({ tag, data: data ?? null }),
    );
  }, []);

  // ¿el permiso del micrófono quedó bloqueado a nivel del navegador?
  // (en ese estado getUserMedia falla al instante, sin mostrar diálogo)
  const checkMicPermission = useCallback(async () => {
    try {
      const status = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      setMicPermDenied(status.state === "denied");
    } catch {
      setMicPermDenied(false);
    }
  }, []);

  const pushEntry = useCallback((role: "user" | "avatar", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTranscript((prev) => [
      ...prev,
      { id: ++entryIdRef.current, role, text: trimmed },
    ]);
  }, []);

  const startCall = useCallback(async () => {
    setCallState("connecting");
    setErrorMsg(null);
    setTranscript([]);
    setElapsed(0);
    setMicBlocked(false);

    try {
      const portrait = window.matchMedia("(orientation: portrait)").matches;
      const sttProvider =
        new URLSearchParams(window.location.search).get("stt") ?? undefined;
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portrait, sttProvider }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.detail || "Error creando sesión");
      }
      setIsSandbox(Boolean(data.sandbox));

      const session = new LiveAvatarSession(data.sessionToken, {
        voiceChat: true,
      });
      sessionRef.current = session;

      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        if (videoRef.current) {
          session.attach(videoRef.current);
          if (canvasRef.current) {
            try {
              chromaStopRef.current = startChromaKey(
                videoRef.current,
                canvasRef.current,
              );
              setChromaFailed(false);
            } catch {
              // sin WebGL mostramos el video tal cual (fondo verde)
              setChromaFailed(true);
            }
          }
        }
        setCallState("live");
        setElapsed(0);
        clockRef.current = setInterval(
          () => setElapsed((e) => e + 1),
          1000,
        );
        keepAliveRef.current = setInterval(() => {
          session.keepAlive().catch(() => {});
        }, KEEP_ALIVE_MS);
      });

      session.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
        cleanup();
        setCallState((prev) => {
          if (prev === "error") return prev;
          if (
            reason === SessionDisconnectReason.SESSION_START_FAILED &&
            prev !== "live"
          ) {
            setErrorMsg("La sesión no pudo iniciarse. Inténtalo de nuevo.");
            return "error";
          }
          return "ended";
        });
      });

      session.on(AgentEventsEnum.USER_SPEAK_STARTED, () => {
        setUserSpeaking(true);
        debugLog("user.speak_started");
      });
      session.on(AgentEventsEnum.USER_SPEAK_ENDED, () =>
        setUserSpeaking(false),
      );
      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () =>
        setAvatarSpeaking(true),
      );
      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        setAvatarSpeaking(false);
        setCaption((c) => (c?.role === "avatar" ? null : c));
      });

      // subtítulos en streaming + transcripción final
      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION_CHUNK, (ev) => {
        setCaption({ id: -1, role: "avatar", text: ev.text });
      });
      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (ev) => {
        pushEntry("avatar", ev.text);
        setCaption(null);
      });
      session.on(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, (ev) => {
        setCaption({ id: -2, role: "user", text: ev.text });
      });
      session.on(AgentEventsEnum.USER_TRANSCRIPTION, (ev) => {
        pushEntry("user", ev.text);
        debugLog("user.transcription", ev.text);
        setCaption((c) => (c?.role === "user" ? null : c));
      });

      session.voiceChat.on(VoiceChatEvent.MUTED, () => setMuted(true));
      session.voiceChat.on(VoiceChatEvent.UNMUTED, () => setMuted(false));

      await session.start();
      try {
        await session.voiceChat.start();
        setMicBlocked(false);
        debugLog("voicechat.started", { muted: session.voiceChat.isMuted });
      } catch (e) {
        // sin micrófono la llamada sigue: el avatar saluda y habla igual
        setMicBlocked(true);
        checkMicPermission();
        debugLog("voicechat.failed", String(e));
      }
    } catch (err) {
      sessionRef.current?.stop().catch(() => {});
      cleanup();
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setCallState("error");
    }
  }, [cleanup, pushEntry, checkMicPermission, debugLog]);

  const endCall = useCallback(async () => {
    const session = sessionRef.current;
    cleanup();
    setCallState("ended");
    await session?.stop().catch(() => {});
  }, [cleanup]);

  const toggleMute = useCallback(async () => {
    const vc = sessionRef.current?.voiceChat;
    if (!vc) return;
    if (vc.isMuted) await vc.unmute();
    else await vc.mute();
  }, []);

  // reintenta capturar el micrófono sin reiniciar la llamada
  const retryMic = useCallback(async () => {
    const vc = sessionRef.current?.voiceChat;
    if (!vc) return;
    try {
      await vc.start();
      setMicBlocked(false);
      setMicRetryFailed(false);
    } catch {
      setMicBlocked(true);
      setMicRetryFailed(true);
      checkMicPermission();
    }
  }, [checkMicPermission]);

  const isLive = callState === "live";

  return (
    <div className="stage-wrap">
      <section className="stage" aria-label="Videollamada con Pedro">
        {/* poster mientras no hay video en vivo */}
        {!isLive && (
          <picture>
            <source
              media="(orientation: portrait)"
              srcSet={POSTER_PORTRAIT_URL}
            />
            <img
              className="stage-poster"
              src={POSTER_URL}
              alt="Pedro, asistente virtual de raaamp"
            />
          </picture>
        )}
        {isLive && !chromaFailed && <div className="stage-live-bg" />}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={isLive && chromaFailed ? "video-raw" : "video-hidden"}
        />
        <canvas
          ref={canvasRef}
          className="stage-canvas"
          style={{ display: isLive && !chromaFailed ? "block" : "none" }}
        />
        <div className="stage-veil" />
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />

        <div className="stage-status">
          {isLive ? (
            <>
              <span className="chip live">
                <span className="dot" /> En vivo
              </span>
              <span className="chip timer">{formatClock(elapsed)}</span>
              {isSandbox && (
                <span className="chip">Modo prueba · ~1 min · gratis</span>
              )}
              {avatarSpeaking && (
                <span className="chip live">
                  <span className="eq">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  Pedro habla
                </span>
              )}
              {userSpeaking && !avatarSpeaking && (
                <span className="chip hearing">
                  <span className="eq">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  Te escucho…
                </span>
              )}
              {muted && <span className="chip">Mic apagado</span>}
            </>
          ) : (
            <span className="chip">
              <span className="dot" /> Asistente · raaamp
            </span>
          )}
        </div>

        {callState === "idle" && (
          <div className="idle-panel">
            <span className="idle-kicker">Recepcionista virtual — IA en vivo</span>
            <h1 className="idle-title">
              Habla con Pedro sobre automatizar tu empresa.
            </h1>
            <p className="idle-sub">
              Pedro es el asistente de IA de raaamp. Pregúntale por agentes de
              IA, automatización de procesos, precios o resultados reales — te
              responde con voz, en español y en tiempo real.
            </p>
            <div className="idle-actions">
              <button className="btn btn-start" onClick={startCall}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                  <path d="M8 5.5v13l11-6.5-11-6.5z" />
                </svg>
                Iniciar llamada
              </button>
              <span className="idle-hint">Necesitas micrófono · ~1 min para conocerlo</span>
            </div>
          </div>
        )}

        {callState === "connecting" && (
          <div className="overlay-note">
            <div className="connecting">
              <span />
              <span />
              <span />
            </div>
            <h3>Llamando a Pedro…</h3>
            <p>
              Estamos levantando la sesión en vivo. Acepta el permiso del
              micrófono cuando el navegador lo pida.
            </p>
          </div>
        )}

        {callState === "ended" && (
          <div className="overlay-note">
            <h3>Llamada finalizada</h3>
            <p>
              Gracias por hablar con Pedro. ¿Listo para el siguiente paso?
              Agenda una llamada estratégica gratuita de 30 minutos en
              raaamp.co/book-call.
            </p>
            <button className="btn btn-start" onClick={startCall}>
              Llamar de nuevo
            </button>
          </div>
        )}

        {callState === "error" && (
          <div className="overlay-note">
            <h3>No pudimos conectar</h3>
            <p>Ocurrió un problema al iniciar la llamada con el avatar.</p>
            {errorMsg && <span className="err-detail">{errorMsg}</span>}
            <button className="btn btn-start" onClick={startCall}>
              Reintentar
            </button>
          </div>
        )}

        {isLive && micBlocked && (
          <div className="mic-banner">
            {micPermDenied ? (
              <>
                <strong>
                  El navegador tiene bloqueado el micrófono para este sitio.
                </strong>
                <span>
                  El botón no puede pedir el permiso de nuevo: hay que
                  desbloquearlo a mano. En Chrome, haz clic en el icono a la
                  izquierda de la dirección (candado o controles), activa
                  «Micrófono» y recarga la página. En Mac revisa también
                  Ajustes del Sistema → Privacidad y seguridad → Micrófono →
                  permite tu navegador.
                </span>
                <button
                  className="btn btn-start btn-mic-retry"
                  onClick={retryMic}
                >
                  Ya lo desbloqueé — reintentar
                </button>
              </>
            ) : (
              <>
                <strong>
                  Pedro no puede escucharte: sin acceso al micrófono.
                </strong>
                <span>
                  {micRetryFailed
                    ? "Sigue sin funcionar. Si el navegador no muestra ningún diálogo, el permiso está bloqueado: revisa el icono junto a la dirección y los Ajustes del Sistema (Privacidad → Micrófono), y recarga la página."
                    : "Pulsa el botón y acepta el diálogo de permiso del navegador."}
                </span>
                <button
                  className="btn btn-start btn-mic-retry"
                  onClick={retryMic}
                >
                  Permitir micrófono
                </button>
              </>
            )}
          </div>
        )}

        {isLive && caption && (
          <div
            className={`caption ${caption.role === "user" ? "user-caption" : ""}`}
          >
            {caption.text}
          </div>
        )}

        {isLive && (
          <div className="call-controls">
            <button
              className={`ctl ${muted ? "muted" : ""}`}
              onClick={toggleMute}
              aria-label={muted ? "Activar micrófono" : "Silenciar micrófono"}
              title={muted ? "Activar micrófono" : "Silenciar micrófono"}
            >
              {muted ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="2" y1="2" x2="22" y2="22" />
                  <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
                  <path d="M5 10v2a7 7 0 0 0 12 5" />
                  <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                </svg>
              )}
            </button>
            <button
              className="ctl hang"
              onClick={endCall}
              aria-label="Colgar"
              title="Colgar"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M21.7 15.2l-3.6-1.5a1.5 1.5 0 0 0-1.7.4l-1.3 1.6a13.4 13.4 0 0 1-6.8-6.8l1.6-1.3a1.5 1.5 0 0 0 .4-1.7L8.8 2.3A1.5 1.5 0 0 0 7 1.4l-3.3.9A1.5 1.5 0 0 0 2.6 4 19.4 19.4 0 0 0 20 21.4a1.5 1.5 0 0 0 1.7-1.1l.9-3.3a1.5 1.5 0 0 0-.9-1.8z" transform="rotate(135 12 12)" />
              </svg>
            </button>
          </div>
        )}
      </section>

      <aside className="transcript" aria-label="Transcripción de la conversación">
        <div className="transcript-head">
          <h2>Transcripción</h2>
          <span className="count">
            {transcript.length > 0 ? `${transcript.length} turnos` : "—"}
          </span>
        </div>
        <div className="transcript-body" ref={transcriptBodyRef}>
          {transcript.length === 0 ? (
            <div className="transcript-empty">
              <span className="glyph">[ · · · ]</span>
              Aquí verás lo que digan tú y Pedro durante la llamada.
            </div>
          ) : (
            transcript.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                <span className="who">
                  {m.role === "avatar" ? "Pedro · raaamp" : "Tú"}
                </span>
                <span className="bubble">{m.text}</span>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
