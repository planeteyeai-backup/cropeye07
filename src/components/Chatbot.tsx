import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageCircle, X, Mic, MicOff, Send, Loader2,
  Minimize2, Play, Pause, Trash2, FileText, Globe, RefreshCw,
} from "lucide-react";
import {
  getChatbotResponse,
  detectLanguage,
  getWelcomeMessageByChatLocale,
  type Language,
  type UserRole,
  type ChatLocaleCode,
} from "../services/ruleBasedChatbot";
import {
  getChatbotUiMessage,
  localizeChatbotServerError,
} from "../services/chatbotUiMessages";
import { useAppContext } from "../context/AppContext";
import { getUserRole, getUserData } from "../utils/auth";

// ── Backend API ────────────────────────────────────────────────────────────────
const CHATBOT_API_URL = "https://cropeye-chatbot.up.railway.app";

type ChatLanguage = ChatLocaleCode;

/** Avoid speaking a numeric-only `response` when the real text is in another field. */
function extractBotTextFromApiPayload(data: Record<string, unknown>): string | null {
  const tryString = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === "string") {
      const s = v.trim();
      return s.length ? s : null;
    }
    return null;
  };
  const fromNested = (v: unknown): string | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    return (
      tryString(o.text) ||
      tryString(o.message) ||
      tryString(o.answer) ||
      tryString(o.content) ||
      tryString(o.final_output)
    );
  };
  for (const key of [
    "final_output",
    "response",
    "text",
    "message",
    "answer",
    "content",
    "output",
  ] as const) {
    const s = tryString(data[key]);
    if (s) return s;
  }
  const nested = fromNested(data.response);
  if (nested) return nested;
  if (typeof data.response === "string") {
    const s = data.response.trim();
    if (s) return s;
  }
  return null;
}

function deepFindNarrationText(data: Record<string, unknown>): string | null {
  const skipKeys = new Set([
    "audio_base64",
    "speak_text",
    "audio",
    "embedding",
    "trace",
    "debug",
  ]);
  let best: string | null = null;
  const looksLikeBase64Blob = (s: string) =>
    /^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.replace(/\s/g, "").length > 120;
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || v == null) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s.length < 4 || looksLikeBase64Blob(s)) return;
      const letterOrScript = /[^\d\s.,()%°℃°C–\-+/:]/.test(s);
      if (!letterOrScript && s.length < 24) return;
      if (!best || s.length > best.length) best = s;
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (skipKeys.has(k)) continue;
      visit(val, depth + 1);
    }
  };
  visit(data, 0);
  return best;
}

/** Non-empty server MP3 payload (backend `/voicebot/*` → `audio_base64`). */
function getAudioBase64FromPayload(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const raw = data.audio_base64;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s.length ? s : null;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  language?: Language;
}

interface ChatbotProps {
  isOpen: boolean;
  onClose: () => void;
  userRole?: UserRole;
}

function chatLocaleToMessageLanguage(locale: ChatLocaleCode | null): Language {
  switch (locale) {
    case "hi":
      return "hindi";
    case "en":
      return "english";
    case "kn":
      return "kannada";
    default:
      return "marathi";
  }
}

/** Confirm Redis farm context exists before enabling farmer chat. */
async function verifyFarmerPlotReady(
  plotId: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; reason: "farm_context" | "processing" | "failed" }> {
  const res = await fetch(`${CHATBOT_API_URL}/chat/farmer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: ".", plot_id: plotId, language: "en" }),
    signal,
  });
  if (!res.ok) return { ok: false, reason: "failed" };
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "failed" };
  }
  const err = data.error ? String(data.error) : "";
  if (err && /farm context|initialize-plot|not initialized/i.test(err)) {
    return { ok: false, reason: "farm_context" };
  }
  const status = data.status ? String(data.status) : "";
  if (status === "failed") return { ok: false, reason: "failed" };
  if (status && status !== "ready") return { ok: false, reason: "processing" };
  return { ok: true };
}

// ── Component ──────────────────────────────────────────────────────────────────
const Chatbot: React.FC<ChatbotProps> = ({ isOpen, onClose, userRole }) => {
  const { selectedPlotName } = useAppContext();

  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages]           = useState<Message[]>([]);
  const [inputText, setInputText]         = useState("");
  const [isLoading, setIsLoading]         = useState(false);
  const [isRecording, setIsRecording]     = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [isMinimized, setIsMinimized]     = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  // API-specific state
  const [isInitialized, setIsInitialized]   = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  /** Raw init error from API (display via localizeChatbotServerError + chatLanguage). */
  const [initErrorRaw, setInitErrorRaw]     = useState<string | null>(null);
  /** Farmer only: true only after `/initialize-plot` succeeds for the current plot (backend requires this before /chat and /voicebot). */
  const [farmerBackendReady, setFarmerBackendReady] = useState(false);
  const [chatLanguage, setChatLanguage]     = useState<ChatLanguage | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [showReportModal, setShowReportModal]       = useState(false);
  const [reportContent, setReportContent]           = useState<string>("");
  const [reportLanguage, setReportLanguage]         = useState<ChatLanguage>("mr");

  // ── Refs ───────────────────────────────────────────────────────────────────
  const messagesEndRef        = useRef<HTMLDivElement>(null);
  const recognitionRef        = useRef<any>(null);
  /** One welcome per chatbot open, after user picks a language. */
  const welcomedThisOpenRef   = useRef(false);
  const lastBotMessageRef     = useRef<string>("");
  /** Text last used for TTS fallback / replay — prefers API `speak_text` when present. */
  const lastBotSpeakTextRef   = useRef<string>("");
  const mediaRecorderRef      = useRef<MediaRecorder | null>(null);
  const backendAudioRef       = useRef<HTMLAudioElement | null>(null);
  // Tracks which plotId was last successfully initialized so we don't
  // call /initialize-plot again when the chatbot is simply closed & reopened
  const initializedPlotRef    = useRef<string | null>(null);
  /** Latest plot id each render — avoids stale closure when profile/context updates right after open. */
  const latestPlotIdRef       = useRef<string | null>(null);
  /** Bumped on each init start; completions with an older seq are ignored (plot changed or superseded). */
  const plotInitSeqRef        = useRef(0);
  const plotInitAbortRef      = useRef<AbortController | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Use same role detection as the auth system:
  // prop takes precedence; if not provided fall back to localStorage ('role' key)
  const activeRole = (userRole || getUserRole() || "farmer") as UserRole;

  const isFarmerRole       = activeRole === "farmer";
  const isFieldOfficerRole = activeRole === "fieldofficer";
  const isManagerRole      = activeRole === "manager";

  // Per-role chat endpoint routing
  const getChatEndpoint = (): string => {
    if (isFarmerRole)       return "/chat/farmer";
    if (isFieldOfficerRole) return "/chat/field_officer";
    if (isManagerRole)      return "/chat/manager";
    return "/chat/field_officer"; // owner fallback
  };

  /** Voice pipeline (after STT) — matches standalone `chatbot_same_logic.html`. */
  const getVoiceEndpoint = (): string => {
    if (isFarmerRole)       return "/voicebot/farmer";
    if (isFieldOfficerRole) return "/voicebot/field-officer";
    if (isManagerRole)      return "/voicebot/manager";
    return "/voicebot/field-officer";
  };

  const releaseDictationMic = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Fall back to localStorage so the chatbot finds the plot even if context
  // hasn't been populated yet (profile still loading in FarmerDashboard)
  const plotId = selectedPlotName || localStorage.getItem("selectedPlot") || null;
  latestPlotIdRef.current = plotId;

  // ── Add message ────────────────────────────────────────────────────────────
  const addMessage = useCallback((text: string, isUser: boolean, language?: Language) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString() + Math.random(), text, isUser, timestamp: new Date(), language },
    ]);
  }, []);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Load voices ────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = () => setAvailableVoices(window.speechSynthesis.getVoices());
    if ("speechSynthesis" in window) {
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis.cancel();
    };
  }, []);

  // ── Auto-initialize ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    if (!isFarmerRole) {
      setIsInitialized(true);
      setFarmerBackendReady(true);
      return;
    }

    if (plotId && initializedPlotRef.current === plotId) {
      setIsInitialized(true);
      setFarmerBackendReady(true);
      const ac = new AbortController();
      plotInitAbortRef.current = ac;
      verifyFarmerPlotReady(plotId, ac.signal)
        .then((v) => {
          if (ac.signal.aborted) return;
          if (!v.ok) {
            initializedPlotRef.current = null;
            setFarmerBackendReady(false);
            setInitErrorRaw(
              v.reason === "farm_context"
                ? "Farm context not initialized. Please run /initialize-plot first."
                : "init_failed",
            );
            void initializePlot();
          }
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            initializedPlotRef.current = null;
            setFarmerBackendReady(false);
            initializePlot();
          }
        });
      return () => {
        ac.abort();
      };
    }

    if (!plotId && initializedPlotRef.current === "__no_plot__") {
      setIsInitialized(true);
      setFarmerBackendReady(false);
      return;
    }

    // New plot or first open — call the API (dedupe / stale handling is inside initializePlot)
    setIsInitialized(false);
    initializePlot();

    return () => {
      plotInitAbortRef.current?.abort();
    };
  }, [isOpen, isFarmerRole, plotId]);

  // ── Reset on close ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      welcomedThisOpenRef.current = false;
      setChatLanguage(null);
      // Do NOT reset isInitialized — the ref already tracks which plot is
      // initialized so the next open will skip the API call for the same plot
      setInitErrorRaw(null);
    }
  }, [isOpen]);

  // ── Welcome after user picks a language (text only — no voice API / TTS) ─
  useEffect(() => {
    if (!isOpen || isMinimized || !isInitialized || chatLanguage == null) return;
    if (welcomedThisOpenRef.current) return;
    welcomedThisOpenRef.current = true;

    const welcome = getWelcomeMessageByChatLocale(chatLanguage);
    addMessage(welcome.text, false, welcome.language);
  }, [isOpen, isMinimized, isInitialized, chatLanguage, addMessage]);

  // ── Plot Initialization (farmer only) ─────────────────────────────────────
  const initializePlot = async () => {
    const pid =
      (latestPlotIdRef.current || localStorage.getItem("selectedPlot") || "").trim() || null;

    if (!pid) {
      plotInitAbortRef.current?.abort();
      plotInitSeqRef.current += 1;
      initializedPlotRef.current = "__no_plot__";
      setFarmerBackendReady(false);
      setInitErrorRaw(null);
      setIsInitialized(true);
      setIsInitializing(false);
      return;
    }

    plotInitSeqRef.current += 1;
    const seq = plotInitSeqRef.current;
    plotInitAbortRef.current?.abort();
    const ac = new AbortController();
    plotInitAbortRef.current = ac;

    setFarmerBackendReady(false);
    setIsInitializing(true);
    setInitErrorRaw(null);

    const runOnce = async (): Promise<void> => {
      const res = await fetch(`${CHATBOT_API_URL}/initialize-plot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plot_id: pid }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(String(data.error));
    };

    try {
      try {
        await runOnce();
      } catch (firstErr: any) {
        if (firstErr?.name === "AbortError") throw firstErr;
        const msg = String(firstErr?.message || "");
        const retryable =
          /Server error: 502|Server error: 503|Server error: 504|Failed to fetch|NetworkError/i.test(
            msg,
          );
        if (retryable) {
          await new Promise((r) => setTimeout(r, 700));
          if (seq !== plotInitSeqRef.current || ac.signal.aborted) return;
          await runOnce();
        } else {
          throw firstErr;
        }
      }

      if (seq !== plotInitSeqRef.current) return;

      const verify = await verifyFarmerPlotReady(pid, ac.signal);
      if (seq !== plotInitSeqRef.current || ac.signal.aborted) return;
      if (!verify.ok) {
        throw new Error(
          verify.reason === "farm_context"
            ? "Farm context not initialized. Please run /initialize-plot first."
            : "Initialization failed. Please try again.",
        );
      }

      initializedPlotRef.current = pid;
      setFarmerBackendReady(true);
      setIsInitialized(true);
      setInitErrorRaw(null);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (seq !== plotInitSeqRef.current) return;
      console.error("[Chatbot] Init failed:", err);
      setInitErrorRaw(err.message || "Initialization failed. Please try again.");
      setFarmerBackendReady(false);
      initializedPlotRef.current = null;
      setIsInitialized(true);
    } finally {
      if (seq === plotInitSeqRef.current) {
        setIsInitializing(false);
      }
    }
  };

  // ── TTS (browser fallback) ─────────────────────────────────────────────────
  const cleanTextForTTS = (text: string): string => {
    return text
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[\s]*[•\-\*]\s+/gm, "")
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
      .replace(/[\u{2600}-\u{26FF}]/gu, "")
      .replace(/[\u{2700}-\u{27BF}]/gu, "")
      .replace(/\n{2,}/g, " ")
      .replace(/\n/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  const speakText = async (text: string): Promise<void> => {
    if (!text?.trim() || !("speechSynthesis" in window)) return;
    const cleaned = cleanTextForTTS(text);
    if (!cleaned) return;

    return new Promise<void>((resolve) => {
      window.speechSynthesis.cancel();
      setIsAudioPaused(false);
      lastBotMessageRef.current = text.trim();

      const voices = availableVoices.length ? availableVoices : window.speechSynthesis.getVoices();
      const utterance = new SpeechSynthesisUtterance(cleaned);

      const langPref =
        chatLanguage === "en"
          ? { exact: "en-IN" as const, prefix: "en-", fallback: "en-US" as const }
          : chatLanguage === "hi"
            ? { exact: "hi-IN" as const, prefix: "hi-", fallback: "hi-IN" as const }
            : chatLanguage === "kn"
              ? { exact: "kn-IN" as const, prefix: "kn-", fallback: "kn-IN" as const }
              : { exact: "mr-IN" as const, prefix: "mr-", fallback: "mr-IN" as const };

      const voice =
        voices.find((v) => v.lang === langPref.exact) ||
        voices.find((v) => v.lang.startsWith(langPref.prefix)) ||
        voices.find((v) => v.lang.includes("-IN")) ||
        voices[0];

      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = langPref.fallback;
      }

      utterance.rate = 0.85;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      setIsPlayingAudio(true);
      utterance.onend = () => { setIsPlayingAudio(false); setIsAudioPaused(false); resolve(); };
      utterance.onerror = () => { setIsPlayingAudio(false); setIsAudioPaused(false); resolve(); };

      setTimeout(() => window.speechSynthesis.speak(utterance), 100);
    });
  };

  // ── Backend MP3 (edge-tts, etc.) — same behaviour as `chatbot_same_logic.html`
  const playBackendAudio = (audioBase64: string) => {
    const fallbackTts = () => {
      const t =
        lastBotSpeakTextRef.current?.trim() || lastBotMessageRef.current?.trim();
      if (t) void speakText(t);
    };
    try {
      releaseDictationMic();
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }

      const cleanedBase64 = String(audioBase64 || "")
        .trim()
        .replace(/^data:audio\/[^;]+;base64,/, "")
        .replace(/\s/g, "");

      if (!cleanedBase64) throw new Error("Empty audio_base64");

      const byteStr = atob(cleanedBase64);
      const arr = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
      const blob = new Blob([arr], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);

      try {
        backendAudioRef.current?.pause();
      } catch {
        /* ignore */
      }
      const audio = new Audio(url);
      backendAudioRef.current = audio;
      setIsPlayingAudio(true);

      window.setTimeout(() => {
        if (!backendAudioRef.current) return;
        backendAudioRef.current.play().catch(() => {
          console.warn("[Chatbot] Backend audio playback failed, fallback to TTS");
          setIsPlayingAudio(false);
          backendAudioRef.current = null;
          fallbackTts();
        });
      }, 180);

      audio.addEventListener("ended", () => {
        setIsPlayingAudio(false);
        backendAudioRef.current = null;
        URL.revokeObjectURL(url);
      });
    } catch (err) {
      console.error("[Chatbot] Backend audio error:", err);
      setIsPlayingAudio(false);
      backendAudioRef.current = null;
      fallbackTts();
    }
  };

  /**
   * Prefer server MP3 (`audio_base64`) when the API returns it (`main.py` voice routes).
   * If missing, browser TTS uses `speak_text` when present (normalized for Edge TTS), else display text.
   */
  const playVoiceOrSpeakFallback = (
    data: Record<string, unknown> | null,
    displayText: string,
  ) => {
    const b64 = getAudioBase64FromPayload(data);
    if (b64) {
      playBackendAudio(b64);
      return;
    }
    const speakSrc =
      typeof data?.speak_text === "string" && data.speak_text.trim()
        ? data.speak_text.trim()
        : displayText;
    void speakText(speakSrc);
  };

  const pauseAudio = () => {
    backendAudioRef.current?.pause();
    window.speechSynthesis.cancel();
    setIsPlayingAudio(false);
    setIsAudioPaused(true);
  };

  const playAudio = () => {
    const replay =
      lastBotSpeakTextRef.current?.trim() || lastBotMessageRef.current?.trim();
    if (replay) {
      setIsAudioPaused(false);
      void speakText(replay);
    }
  };

  // ── Send text message via API ──────────────────────────────────────────────
  const sendTextMessageWithText = async (message: string) => {
    if (!message.trim() || isLoading) return;
    if (chatLanguage == null) {
      addMessage(getChatbotUiMessage(null, "selectLanguageFirst"), false, "english");
      return;
    }

    const uiLang = chatLocaleToMessageLanguage(chatLanguage);

    if (isFarmerRole) {
      if (!plotId) {
        addMessage(getChatbotUiMessage(chatLanguage, "selectPlotFirst"), false, uiLang);
        return;
      }
      if (!farmerBackendReady) {
        addMessage(getChatbotUiMessage(chatLanguage, "farmContextNotReady"), false, uiLang);
        return;
      }
    }

    const detectedLang = detectLanguage(message);
    addMessage(message, true, detectedLang);
    setIsLoading(true);

    // user_id is required by field_officer endpoints
    const userData = getUserData();
    const userId: number | undefined = userData?.id;

    try {
      const endpoint = getChatEndpoint();

      // Build payload per-role based on the API schema
      let payload: Record<string, any>;
      if (isFieldOfficerRole || isManagerRole) {
        // POST /chat/field_officer  →  { message, user_id, plot_id }
        // POST /chat/manager        →  { message, user_id, plot_id }
        payload = { message };
        if (userId)  payload.user_id = userId;
        if (plotId)  payload.plot_id = plotId;
      } else {
        // POST /chat/farmer  →  { message, plot_id, language }
        payload = { message, language: chatLanguage };
        if (plotId) payload.plot_id = plotId;
      }

      const res = await fetch(`${CHATBOT_API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`API ${res.status}`);

      // Response types differ per role:
      //   farmer        → JSON object: { response, final_output, audio_base64, status }
      //   field_officer → JSON object: { response, intent }
      //   manager       → plain string
      const rawData = await res.text();
      let botText: string;
      let parsedForAudio: Record<string, unknown> | null = null;
      try {
        const data = JSON.parse(rawData) as Record<string, unknown>;
        parsedForAudio = data;
        if (data.error) {
          const errStr = String(data.error);
          if (
            isFarmerRole &&
            /initialize-plot|farm context|not initialized/i.test(errStr)
          ) {
            setFarmerBackendReady(false);
            initializedPlotRef.current = null;
            setInitErrorRaw(errStr);
            addMessage(
              getChatbotUiMessage(chatLanguage, "farmContextLost"),
              false,
              chatLocaleToMessageLanguage(chatLanguage),
            );
            void initializePlot();
            return;
          }
          throw new Error(errStr);
        }

        // Handle "still loading" status (farmer only)
        if (isFarmerRole && data.status && data.status !== "ready") {
          const waitMsg =
            typeof data.message === "string" && data.message.trim()
              ? localizeChatbotServerError(data.message.trim(), chatLanguage)
              : getChatbotUiMessage(chatLanguage, "plotStillLoading");
          addMessage(waitMsg, false, chatLocaleToMessageLanguage(chatLanguage));
          return;
        }

        const extracted =
          extractBotTextFromApiPayload(data) ||
          deepFindNarrationText(data);
        botText = extracted || rawData || "No response received.";
      } catch {
        // Plain string response (manager)
        parsedForAudio = null;
        botText = rawData.replace(/^"|"$/g, "") || "No response received.";
      }

      // ── Show message first, then speak ──────────────────────────────────
      addMessage(botText, false);
      lastBotMessageRef.current = botText;
      lastBotSpeakTextRef.current =
        typeof parsedForAudio?.speak_text === "string" && parsedForAudio.speak_text.trim()
          ? parsedForAudio.speak_text.trim()
          : botText;

      // Small delay so React renders the bubble before TTS/audio starts
      await new Promise((r) => setTimeout(r, 150));

      playVoiceOrSpeakFallback(parsedForAudio, botText);
    } catch (err: any) {
      console.warn("[Chatbot] API failed, using static fallback:", err.message);
      const fallback = getChatbotResponse(message, activeRole);
      addMessage(fallback.text, false, fallback.language);
      await speakText(fallback.text);
    } finally {
      setIsLoading(false);
    }
  };

  /** After browser STT: `/voicebot/...` with `include_audio: true` (same as `chatbot_same_logic.html`). */
  const sendVoiceMessageWithText = async (message: string) => {
    if (!message.trim() || isLoading) return;
    if (chatLanguage == null) {
      addMessage(getChatbotUiMessage(null, "selectLanguageFirst"), false, "english");
      return;
    }

    const uiLang = chatLocaleToMessageLanguage(chatLanguage);

    if (isFarmerRole) {
      if (!plotId) {
        addMessage(getChatbotUiMessage(chatLanguage, "selectPlotFirst"), false, uiLang);
        return;
      }
      if (!farmerBackendReady) {
        addMessage(getChatbotUiMessage(chatLanguage, "farmContextNotReady"), false, uiLang);
        return;
      }
    }

    const detectedLang = detectLanguage(message);
    addMessage(message, true, detectedLang);
    releaseDictationMic();
    await new Promise((r) => setTimeout(r, 220));
    setIsLoading(true);

    const userData = getUserData();
    const userId: number | undefined = userData?.id;

    try {
      const endpoint = getVoiceEndpoint();
      const payload: Record<string, unknown> = {
        message,
        include_audio: true,
        language: chatLanguage,
      };
      if (plotId) payload.plot_id = plotId;
      if (userId != null) {
        payload.user_id = userId;
      }

      const res = await fetch(`${CHATBOT_API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Voice API ${res.status}`);

      const data = (await res.json()) as Record<string, unknown>;
      if (data.error) {
        const errStr = String(data.error);
        if (
          isFarmerRole &&
          /initialize-plot|farm context|not initialized/i.test(errStr)
        ) {
          setFarmerBackendReady(false);
          initializedPlotRef.current = null;
          setInitErrorRaw(errStr);
          addMessage(
            getChatbotUiMessage(chatLanguage, "farmContextLost"),
            false,
            chatLocaleToMessageLanguage(chatLanguage),
          );
          void initializePlot();
          return;
        }
        throw new Error(errStr);
      }

      if (isFarmerRole && data.status && data.status !== "ready") {
        addMessage(
          typeof data.message === "string" && String(data.message).trim()
            ? localizeChatbotServerError(String(data.message), chatLanguage)
            : getChatbotUiMessage(chatLanguage, "plotStillLoading"),
          false,
          chatLocaleToMessageLanguage(chatLanguage),
        );
        return;
      }

      const extracted =
        extractBotTextFromApiPayload(data) || deepFindNarrationText(data);
      const botText =
        extracted ||
        (typeof data.response === "string" ? data.response.trim() : "") ||
        "No response received.";

      addMessage(botText, false);
      lastBotMessageRef.current = botText;
      lastBotSpeakTextRef.current =
        typeof data.speak_text === "string" && data.speak_text.trim()
          ? data.speak_text.trim()
          : botText;

      await new Promise((r) => setTimeout(r, 150));

      playVoiceOrSpeakFallback(data, botText);
    } catch (err: any) {
      console.warn("[Chatbot] Voice API failed:", err.message);
      const fallback = getChatbotResponse(message, activeRole);
      addMessage(fallback.text, false, fallback.language);
      await speakText(fallback.text);
    } finally {
      setIsLoading(false);
    }
  };

  const sendTextMessage = async () => {
    if (!inputText.trim() || isLoading) return;
    const msg = inputText.trim();
    setInputText("");
    await sendTextMessageWithText(msg);
  };

  // ── Voice input via browser Speech Recognition ────────────────────────────
  // STT → `/voicebot/...` with `include_audio: true` (same as `chatbot_same_logic.html`).
  const startVoiceRecording = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      addMessage(
        "Voice input is not supported in this browser. Please use Chrome or Edge and try typing instead.",
        false
      );
      return;
    }

    if (chatLanguage == null) {
      addMessage("Please select a chat language first, then use voice input.", false, "english");
      return;
    }

    // Stop any existing session first
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    const langMap: Record<ChatLanguage, string> = {
      mr: "mr-IN",
      hi: "hi-IN",
      en: "en-US",
      kn: "kn-IN",
    };

    const recognition = new SR();
    recognition.continuous      = false; // releases mic sooner; avoids overlap with TTS playback
    recognition.interimResults  = true;
    recognition.maxAlternatives = 1;
    recognition.lang            = langMap[chatLanguage] || "mr-IN";

    let finalTranscript = "";
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSilenceTimer = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    };

    recognition.onstart = () => {
      setIsRecording(true);
      setInputText("🎤 Listening...");
    };

    recognition.onresult = (event: any) => {
      clearSilenceTimer();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + " ";
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setInputText(finalTranscript + interim);

      // Auto-send 2 s after last speech detected
      if (finalTranscript) {
        silenceTimer = setTimeout(() => {
          recognition.stop();
        }, 2000);
      }
    };

    recognition.onerror = (event: any) => {
      clearSilenceTimer();
      setIsRecording(false);
      setInputText("");
      if (event.error === "not-allowed" || event.error === "permission-denied") {
        addMessage("Microphone permission denied. Please allow mic access in your browser settings.", false);
      } else if (event.error === "network") {
        addMessage("Network error during voice recognition. Please check your connection.", false);
      } else if (event.error !== "aborted") {
        addMessage(`Voice error: ${event.error}. Please try again or type your message.`, false);
      }
      recognitionRef.current = null;
    };

    recognition.onend = async () => {
      clearSilenceTimer();
      setIsRecording(false);
      recognitionRef.current = null;
      const text = finalTranscript.trim();
      setInputText("");
      await new Promise((r) => setTimeout(r, 200));
      if (text) {
        await sendVoiceMessageWithText(text);
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      setIsRecording(false);
      addMessage("Could not start voice input. Please try again.", false);
      recognitionRef.current = null;
    }
  };

  const stopVoiceRecording = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
  };

  // ── Report generation ──────────────────────────────────────────────────────
  const generateReport = async () => {
    if (!plotId) {
      addMessage("Please select a plot first to generate a report.", false);
      return;
    }
    setIsGeneratingReport(true);
    setReportContent("");
    setShowReportModal(true);

    try {
      const res = await fetch(`${CHATBOT_API_URL}/generate-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plot_id: plotId, language: reportLanguage }),
      });
      if (!res.ok) throw new Error(`Report API ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReportContent(data.report || "No report content available.");
    } catch (err: any) {
      setReportContent(`Error generating report: ${err.message}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // ── Clear chat ─────────────────────────────────────────────────────────────
  const clearChat = () => {
    window.speechSynthesis.cancel();
    backendAudioRef.current?.pause();
    setMessages([]);
    setInputText("");
    setIsPlayingAudio(false);
    setIsAudioPaused(false);
    lastBotMessageRef.current = "";
    lastBotSpeakTextRef.current = "";
  };

  // ── Early return ───────────────────────────────────────────────────────────
  if (!isOpen) return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed bottom-6 right-6 z-[99999] notranslate"
      translate="no"
    >
      {isMinimized ? (
        <div
          className="bg-gradient-to-r from-green-600 to-emerald-600 text-white p-4 rounded-full shadow-2xl cursor-pointer hover:scale-110 transition-all duration-300 animate-bounce relative"
          onClick={() => setIsMinimized(false)}
          title="Expand Chatbot"
        >
          <MessageCircle className="w-6 h-6" />
          {messages.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
              {messages.length}
            </span>
          )}
        </div>
      ) : (
        <div className="w-96 h-[580px] bg-white rounded-2xl shadow-2xl flex flex-col border border-gray-200 overflow-hidden">

          {/* ── Header ── */}
          <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white p-3 rounded-t-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                <h3 className="font-semibold text-sm">CropEye Assistant</h3>
                {isRecording   && <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" title="Recording" />}
                {isPlayingAudio && <span className="w-2 h-2 bg-blue-300 rounded-full animate-pulse" title="Speaking" />}
                {isInitializing && <Loader2 className="w-3 h-3 animate-spin opacity-80" />}
              </div>

              <div className="flex items-center gap-1">
                {/* Language selector */}
                <div className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-1">
                  <Globe className="w-3 h-3" />
                  <select
                    value={chatLanguage ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setChatLanguage(v === "" ? null : (v as ChatLanguage));
                    }}
                    className="bg-transparent text-white text-xs outline-none cursor-pointer max-w-[9rem]"
                    title="Chat Language"
                  >
                    <option value="" className="text-gray-800">Select language…</option>
                    <option value="mr" className="text-gray-800">मराठी</option>
                    <option value="hi" className="text-gray-800">हिंदी</option>
                    <option value="kn" className="text-gray-800">ಕನ್ನಡ</option>
                    <option value="en" className="text-gray-800">English</option>
                  </select>
                </div>

                {/* Report button — only if plot available */}
                {plotId && (
                  <button
                    onClick={generateReport}
                    disabled={isGeneratingReport}
                    className="p-1 hover:bg-white/20 rounded transition-all duration-200 hover:scale-110 disabled:opacity-50"
                    title="Generate Yield Report"
                  >
                    {isGeneratingReport
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <FileText className="w-4 h-4" />
                    }
                  </button>
                )}

                <button onClick={() => setIsMinimized(true)} className="p-1 hover:bg-white/20 rounded transition-all" title="Minimize">
                  <Minimize2 className="w-4 h-4" />
                </button>
                <button onClick={onClose} className="p-1 hover:bg-white/20 rounded transition-all" title="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Plot info bar — farmers need /initialize-plot success (farmerBackendReady) */}
            {plotId && (
              <div className="mt-1 text-[10px] text-green-100 flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isInitializing
                      ? "bg-yellow-300 animate-pulse"
                      : isFarmerRole
                        ? farmerBackendReady
                          ? "bg-green-300"
                          : initErrorRaw
                            ? "bg-orange-300"
                            : "bg-yellow-300"
                        : isInitialized
                          ? "bg-green-300"
                          : "bg-yellow-300"
                  }`}
                />
                Plot: {plotId} •{" "}
                {isInitializing
                  ? "Initializing…"
                  : isFarmerRole
                    ? farmerBackendReady
                      ? "Ready"
                      : initErrorRaw
                        ? "Setup failed — Retry"
                        : "Syncing plot…"
                    : isInitialized
                      ? "Ready"
                      : "Initializing…"}
              </div>
            )}
          </div>

          {/* ── Init error banner ── */}
          {initErrorRaw && (
            <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 flex items-center justify-between">
              <p className="text-xs text-amber-700">
                {localizeChatbotServerError(initErrorRaw, chatLanguage)}
              </p>
              <button
                onClick={initializePlot}
                className="ml-2 text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          )}

          {isFarmerRole && !isInitialized && isInitializing && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <Loader2 className="w-10 h-10 text-green-500 animate-spin mb-3" />
              <p className="text-sm text-gray-600">
                {getChatbotUiMessage(chatLanguage, "loadingPlot")}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {getChatbotUiMessage(chatLanguage, "loadingPlotSub")}: {plotId}
              </p>
            </div>
          )}

          {/* ── Messages area ── */}
          {(isInitialized || !isFarmerRole) && (
            <>
              <div
                className="flex-1 overflow-y-auto p-4 space-y-3 relative"
                style={{
                  background: `linear-gradient(135deg,rgba(34,139,34,.08) 0%,rgba(144,238,144,.12) 25%,rgba(255,255,255,.98) 50%,rgba(255,215,0,.08) 75%,rgba(34,139,34,.08) 100%)`,
                  backgroundColor: "#f8fdf9",
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/50 via-white/30 to-white/70 pointer-events-none" />

                <div className="relative z-10">
                  {messages.length === 0 && (
                    <div className="text-center text-gray-500 text-sm py-10">
                      <div className="bg-white/80 rounded-full w-14 h-14 mx-auto mb-3 flex items-center justify-center shadow-lg">
                        <MessageCircle className="w-7 h-7 text-green-600" />
                      </div>
                      <p className="font-medium">Ask me about your farm!</p>
                      <p className="text-xs mt-1 text-green-600 animate-pulse">
                        {chatLanguage == null
                          ? "Choose a language above to begin"
                          : chatLanguage === "mr"
                            ? "मराठी mode"
                            : chatLanguage === "hi"
                              ? "हिंदी mode"
                              : chatLanguage === "kn"
                                ? "ಕನ್ನಡ mode"
                                : "English mode"}
                      </p>
                    </div>
                  )}

                  {messages.map((msg, i) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.isUser ? "justify-end" : "justify-start"} mb-3`}
                      style={{ animationDelay: `${i * 0.04}s` }}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm shadow-md ${
                          msg.isUser
                            ? "bg-gradient-to-r from-green-500 to-green-600 text-white rounded-br-sm"
                            : "bg-white text-gray-800 rounded-bl-sm border border-gray-100"
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        <span className={`text-[10px] mt-1 block ${msg.isUser ? "text-green-100" : "text-gray-400"}`}>
                          {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 shadow-md border border-gray-100">
                        <div className="flex gap-1">
                          {[0, 0.2, 0.4].map((d, i) => (
                            <span
                              key={i}
                              className="w-2 h-2 bg-green-400 rounded-full animate-bounce"
                              style={{ animationDelay: `${d}s` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* ── Input area ── */}
              <div className="border-t border-gray-200 bg-white/95 backdrop-blur-sm p-3 rounded-b-2xl">
                <div className="flex items-end gap-2">
                  {/* Pause / Play */}
                  {isPlayingAudio && !isAudioPaused && (
                    <button onClick={pauseAudio} className="p-2 text-gray-500 hover:text-orange-500 hover:bg-gray-100 rounded-full transition-all" title="Pause">
                      <Pause className="w-4 h-4" />
                    </button>
                  )}
                  {!isPlayingAudio && lastBotMessageRef.current && (
                    <button onClick={playAudio} className="p-2 text-gray-500 hover:text-green-600 hover:bg-gray-100 rounded-full transition-all" title="Replay">
                      <Play className="w-4 h-4" />
                    </button>
                  )}

                  {/* Text input */}
                  <div className="flex-1">
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && sendTextMessage()}
                      placeholder={
                        chatLanguage == null
                          ? "Select language first…"
                          : chatLanguage === "mr"
                            ? "प्रश्न विचारा..."
                            : chatLanguage === "hi"
                              ? "प्रश्न पूछें..."
                              : chatLanguage === "kn"
                                ? "ಪ್ರಶ್ನೆ ಕೇಳಿ..."
                                : "Ask a question..."
                      }
                      className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-gray-50 hover:bg-white transition-all"
                      disabled={isLoading || isRecording || chatLanguage == null}
                    />
                  </div>

                  {/* Mic */}
                  <button
                    onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
                    disabled={isLoading || chatLanguage == null}
                    className={`p-2.5 rounded-full transition-all hover:scale-110 ${
                      isRecording
                        ? "bg-red-500 text-white animate-pulse shadow-lg"
                        : "bg-green-600 text-white hover:bg-green-700 shadow-md"
                    } disabled:opacity-50`}
                    title={isRecording ? "Stop Recording" : "Voice Input"}
                  >
                    {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>

                  {/* Send */}
                  {inputText.trim() && (
                    <button
                      onClick={sendTextMessage}
                      disabled={isLoading || isRecording || chatLanguage == null}
                      className="p-2.5 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50 transition-all hover:scale-110 shadow-md"
                      title="Send"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}

                  {/* Clear */}
                  <button
                    onClick={clearChat}
                    disabled={isLoading || messages.length === 0}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 rounded-full transition-all disabled:opacity-30"
                    title="Clear Chat"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Status bar */}
                {(isRecording || isPlayingAudio) && (
                  <div className="flex items-center gap-3 mt-1.5 text-xs px-1">
                    {isRecording && (
                      <span className="flex items-center gap-1 text-red-500">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> Recording...
                      </span>
                    )}
                    {isPlayingAudio && (
                      <span className="flex items-center gap-1 text-blue-500">
                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" /> Speaking...
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Report Modal ── */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 z-[100000] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-green-600" />
                <h2 className="font-semibold text-gray-800">Yield Improvement Report</h2>
                {plotId && <span className="text-xs text-gray-400">— {plotId}</span>}
              </div>
              <div className="flex items-center gap-2">
                {/* Report language */}
                <select
                  value={reportLanguage}
                  onChange={(e) => setReportLanguage(e.target.value as ChatLanguage)}
                  className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="mr">मराठी</option>
                  <option value="hi">हिंदी</option>
                  <option value="kn">ಕನ್ನಡ</option>
                  <option value="en">English</option>
                </select>
                <button
                  onClick={generateReport}
                  disabled={isGeneratingReport}
                  className="text-sm bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                >
                  {isGeneratingReport ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Regenerate
                </button>
                <button
                  onClick={() => setShowReportModal(false)}
                  className="p-1 hover:bg-gray-100 rounded-lg transition-all"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Modal content */}
            <div className="flex-1 overflow-y-auto p-5">
              {isGeneratingReport ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <Loader2 className="w-10 h-10 animate-spin text-green-500 mb-3" />
                  <p className="text-sm">Generating report...</p>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap text-sm">
                  {reportContent || "No report content yet."}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t border-gray-200 p-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  const blob = new Blob([reportContent], { type: "text/plain;charset=utf-8" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `CropEye_Report_${plotId}_${new Date().toISOString().split("T")[0]}.txt`;
                  a.click();
                }}
                disabled={!reportContent || isGeneratingReport}
                className="text-sm border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-all"
              >
                📄 Download
              </button>
              <button
                onClick={() => setShowReportModal(false)}
                className="text-sm bg-gray-100 text-gray-700 px-4 py-1.5 rounded-lg hover:bg-gray-200 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chatbot;
