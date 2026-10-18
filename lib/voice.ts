// Web Speech API dictation for the live loop (docs/SPEC.md → F3): ja-JP, continuous, and a restart after a
// pause, so a predecessor's whole spoken answer becomes text, even when they stop to think mid-answer.
// The screen (components/VoiceAnswer.tsx) only draws; everything the browser needs is here.
// SpeechRecognition is not in TypeScript's DOM lib, so only the parts we call are declared below.

const DEFAULT_LANG = "ja-JP";

export type DictationError =
  | "denied" // the person (or the phone) refused the microphone
  | "unsupported" // no SpeechRecognition in this browser
  | "network" // the browser's speech service was unreachable
  | "unknown";

export type DictationState = "idle" | "listening";

export type DictationOptions = {
  lang?: string; // default ja-JP
  /** The whole transcript so far: the text handed to start() plus everything said since. */
  onText: (text: string) => void;
  onStateChange?: (state: DictationState) => void;
  /** A fatal error. no-speech and aborted are silent: the session simply restarts. */
  onError?: (error: DictationError) => void;
};

export type Dictation = {
  readonly supported: boolean;
  /** Begin (or continue) listening. baseText is what was already in the field, so the answer is never lost. */
  start(baseText?: string): void;
  /** Stop listening; text stays in the field. */
  stop(): void;
};

// Minimal shapes of what we read from the events.
type SpeechAlternative = { transcript: string };
type SpeechResult = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
};
type SpeechResultList = {
  readonly length: number;
  readonly [index: number]: SpeechResult;
};
type SpeechEvent = {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
};
type SpeechErrorEvent = { readonly error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

const recognitionCtor = (): SpeechRecognitionCtor | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window.SpeechRecognition ?? window.webkitSpeechRecognition);

export function createDictation(options: DictationOptions): Dictation {
  const Ctor = recognitionCtor();
  const supported = Ctor !== undefined;
  let recognition: SpeechRecognitionLike | undefined;
  let wantListening = false; // stays true across the pauses we restart through
  let base = ""; // text handed to start()
  let finalized = ""; // finalised during this listening session
  let interim = ""; // the phrase still in progress

  const report = () => options.onText(`${base}${finalized}${interim}`);

  function build(): SpeechRecognitionLike | undefined {
    if (!Ctor) return undefined;
    const rec = new Ctor();
    rec.lang = options.lang ?? DEFAULT_LANG;
    rec.continuous = true; // keep both sentences; onend still restarts where continuous is ignored
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    return rec;
  }

  function onResult(event: SpeechEvent) {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        finalized += text;
        interim = "";
      } else {
        interim = text;
      }
    }
    report();
  }

  function onError(event: SpeechErrorEvent) {
    // Silence or a deliberate abort is not a failure: the session restarts or was stopped.
    if (event.error === "no-speech" || event.error === "aborted") return;
    wantListening = false; // a rejected microphone must not loop
    options.onError?.(
      event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture"
        ? "denied"
        : event.error === "network"
          ? "network"
          : "unknown",
    );
  }

  // Bind the handlers to this exact instance, so a session we stopped never reports or restarts again.
  function session(): SpeechRecognitionLike | undefined {
    const rec = build();
    if (!rec) return undefined;
    rec.onstart = () => {
      if (rec === recognition) options.onStateChange?.("listening");
    };
    rec.onresult = (event) => {
      if (rec === recognition) onResult(event);
    };
    rec.onerror = (event) => {
      if (rec === recognition) onError(event);
    };
    rec.onend = () => onEnd(rec);
    return rec;
  }

  function onEnd(rec: SpeechRecognitionLike) {
    if (rec !== recognition) return; // a stopped or replaced instance: ignore its late end
    // Some phones ignore continuous and stop after the first pause: start a fresh session to keep going.
    if (wantListening) {
      recognition = session();
      begin();
    } else {
      options.onStateChange?.("idle");
    }
  }

  function begin() {
    if (!wantListening || !recognition) return;
    try {
      recognition.start();
    } catch {
      // start() throws when a session is already running; that session still reports.
    }
  }

  return {
    supported,
    start(nextBase = "") {
      if (!supported) {
        options.onError?.("unsupported");
        return;
      }
      if (wantListening) return; // start() is idempotent (React may run the opening effect twice)
      wantListening = true;
      base = nextBase;
      finalized = "";
      interim = "";
      recognition = session();
      begin();
    },
    stop() {
      wantListening = false;
      const current = recognition;
      recognition = undefined; // its late onend must not restart us
      current?.stop();
      options.onStateChange?.("idle");
    },
  };
}
