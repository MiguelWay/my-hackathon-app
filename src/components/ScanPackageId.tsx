import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Worker } from "tesseract.js";
import { api } from "../lib/api";
import { extractTokens } from "../../shared/ocrTokens";
import { useI18n } from "../i18n/I18nContext";

// Photograph a printed package ID and turn it into one of this campaign's IDs.
//
// The OCR runs in the browser (Tesseract in a Web Worker, loaded from /tesseract), so the photo never
// leaves the phone. The characters it reads are then sent to the API, which matches them against the
// campaign's own IDs and decides whether the read is trustworthy — see server/src/idMatch.ts. A tie
// comes back as a short list and the operator picks, because recording a return against the wrong
// package is worse than one extra tap.
//
// With `lookup={false}` there is no API call: the ID is new, so the best token the OCR saw is written
// into the caller's field for the operator to confirm.

interface ResolveResponse {
  senderId: string | null;
  distance: number;
  ambiguous: boolean;
  alternatives: { senderId: string; distance: number }[];
}

interface ScanPackageIdProps {
  campaignId: string;
  /** Called with a confirmed ID; the caller fills the search field and looks it up. */
  onResolved: (senderId: string) => void;
  disabled?: boolean;
  /**
   * When false, the read text is handed back as-is instead of being matched against the campaign.
   * Used for a new package ID, which by definition is not in the campaign yet.
   */
  lookup?: boolean;
}

type Phase = "starting" | "live" | "reading" | "choosing" | "error";

/** Height of the guide box, as a share of the frame. An ID line is wide and short. */
const GUIDE_HEIGHT = 0.24;
const GUIDE_WIDTH = 0.88;

/** Crops the guide box out of the frame, enlarges it and turns it into clean black-on-white. */
function readFrame(source: HTMLVideoElement | ImageBitmap, width: number, height: number) {
  const boxWidth = Math.round(width * GUIDE_WIDTH);
  const boxHeight = Math.round(height * GUIDE_HEIGHT);
  const left = Math.round((width - boxWidth) / 2);
  const top = Math.round((height - boxHeight) / 2);

  // Tesseract wants roughly 30+ pixel capitals. Enlarge small crops rather than feeding it mush.
  const scale = Math.min(3, Math.max(1, 240 / boxHeight));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(boxWidth * scale);
  canvas.height = Math.round(boxHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, left, top, boxWidth, boxHeight, 0, 0, canvas.width, canvas.height);
  binarise(canvas, ctx);
  return canvas;
}

/** Grayscale + Otsu threshold: a phone photo of a printed label becomes two-tone text. */
function binarise(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  const grey = new Uint8ClampedArray(pixels.length / 4);
  const histogram = new Uint32Array(256);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const value = Math.round((pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000);
    grey[p] = value;
    histogram[value] += 1;
  }

  const threshold = otsuThreshold(histogram, grey.length);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    const value = grey[p] > threshold ? 255 : 0;
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  }
  ctx.putImageData(image, 0, 0);
}

/** Otsu's method: the threshold that best separates ink from paper for this particular photo. */
function otsuThreshold(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 128;
  let bestVariance = -1;

  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = value;
    }
  }
  return best;
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function ScanPackageId({ campaignId, onResolved, disabled, lookup = true }: ScanPackageIdProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("starting");
  // Kept apart from `phase`: the camera stays usable while an OCR error is on screen, so the operator
  // can simply frame the ID again instead of closing and reopening the overlay.
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<ResolveResponse["alternatives"]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // One worker per mount: loading the model costs a few seconds, so retries reuse it.
  const workerRef = useRef<Promise<Worker> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopStream(streamRef.current);
      streamRef.current = null;
      // `terminate` frees the WASM heap; a rejected promise was never usable.
      workerRef.current?.then((worker) => worker.terminate()).catch(() => undefined);
      workerRef.current = null;
    };
  }, []);

  const close = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    setOpen(false);
    setError(null);
    setAlternatives([]);
  }, []);

  // Escape closes the overlay, and the page behind it does not scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  const startCamera = useCallback(async () => {
    setPhase("starting");
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera unsupported");
      // A permission prompt the user never answers must not leave the overlay spinning: give it ten
      // seconds, and if the stream arrives after that, stop it instead of leaking the camera.
      let abandoned = false;
      const pending = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      pending.then((late) => {
        if (abandoned) stopStream(late);
      }).catch(() => undefined);

      const stream = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            abandoned = true;
            reject(new Error("camera timeout"));
          }, 10_000);
        }),
      ]);
      if (!mounted.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("no video element");
      video.srcObject = stream;
      await video.play();
      setCameraReady(true);
      setPhase("live");
    } catch {
      // Permission refused or no camera API: the photo button (a plain file input) still works.
      stopStream(streamRef.current);
      streamRef.current = null;
      setCameraReady(false);
      setPhase("error");
      setError(t("scan.cameraDenied"));
    }
  }, [t]);

  const openScanner = useCallback(() => {
    setOpen(true);
    setAlternatives([]);
    setError(null);
    void startCamera();
  }, [startCamera]);

  const getWorker = useCallback(async (): Promise<Worker> => {
    if (!workerRef.current) {
      workerRef.current = (async () => {
        // Loaded on demand: the module, WASM core and language model are only fetched when someone
        // actually scans, and then cached by the browser.
        const { createWorker, OEM, PSM } = await import("tesseract.js");
        const worker = await createWorker("eng", OEM.LSTM_ONLY, {
          workerPath: "/tesseract/worker.min.js",
          corePath: "/tesseract",
          langPath: "/tesseract",
          gzip: true,
        });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        return worker;
      })();
      // A failed load must be retryable, so drop the rejected promise.
      workerRef.current.catch(() => {
        workerRef.current = null;
      });
    }
    return workerRef.current;
  }, []);

  const resolveText = useCallback(
    async (text: string) => {
      if (!lookup) {
        // A new ID is not in the campaign yet, so there is nothing to match: take the most ID-shaped
        // token the OCR saw and let the operator confirm it in the field before saving.
        const token = extractTokens(text, 1)[0];
        if (!token) {
          setPhase("error");
          setError(t("scan.noText"));
          return;
        }
        onResolved(token);
        close();
        return;
      }

      // Nothing readable, or nothing long enough to be an ID: skip the round-trip.
      if (!text.trim() || !/[A-Za-z0-9]{4}/.test(text)) {
        setPhase("error");
        setError(t("scan.noText"));
        return;
      }
      const result = await api.post<ResolveResponse>("/returns/resolve", {
        campaignId: Number(campaignId),
        text,
      });
      if (!mounted.current) return;

      if (result.senderId) {
        onResolved(result.senderId);
        close();
        return;
      }
      if (result.ambiguous && result.alternatives.length) {
        setAlternatives(result.alternatives);
        setPhase("choosing");
        return;
      }
      setPhase("error");
      setError(t("scan.noMatch"));
    },
    [campaignId, close, lookup, onResolved, t]
  );

  const readCanvas = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setPhase("reading");
      setError(null);
      try {
        const worker = await getWorker();
        const { data } = await worker.recognize(canvas);
        await resolveText(data.text ?? "");
      } catch {
        if (!mounted.current) return;
        setPhase("error");
        setError(t("scan.failed"));
      }
    },
    [getWorker, resolveText, t]
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setPhase("error");
      setError(t("scan.noText"));
      return;
    }
    await readCanvas(readFrame(video, video.videoWidth, video.videoHeight));
  }, [readCanvas, t]);

  /** The file input is the fallback when the live camera is unavailable (and a faster path on iOS). */
  const onFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setPhase("reading");
      setError(null);
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        await readCanvas(readFrame(bitmap, bitmap.width, bitmap.height));
        bitmap.close();
      } catch {
        if (!mounted.current) return;
        setPhase("error");
        setError(t("scan.failed"));
      }
    },
    [readCanvas, t]
  );

  return (
    <>
      <button
        type="button"
        className="secondary"
        onClick={openScanner}
        disabled={disabled}
        title={t("scan.title")}
      >
        {t("scan.open")}
      </button>

      {open && (
        <div
          className="scan-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("scan.title")}
        >
          <div className="scan-panel">
            <div className="scan-head">
              <h2>{t("scan.title")}</h2>
              <button type="button" className="scan-close" onClick={close} aria-label={t("scan.close")}>
                ✕
              </button>
            </div>

            <div className="scan-stage">
              <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
              <div className="scan-guide" aria-hidden="true" />
              {(phase === "starting" || phase === "reading") && (
                <p className="scan-busy">
                  {phase === "starting" ? t("scan.starting") : t("scan.reading")}
                </p>
              )}
            </div>

            <p className="scan-hint">{t("scan.hint")}</p>

            {phase === "choosing" && (
              <div className="scan-choices">
                <p>{t("scan.choose")}</p>
                <div className="btn-row">
                  {alternatives.map((option) => (
                    <button
                      key={option.senderId}
                      type="button"
                      onClick={() => {
                        onResolved(option.senderId);
                        close();
                      }}
                    >
                      {option.senderId}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && phase === "error" && <p className="error">{error}</p>}

            <div className="btn-row scan-actions">
              <button type="button" onClick={capture} disabled={!cameraReady || phase === "reading"}>
                {t("scan.capture")}
              </button>
              <button type="button" onClick={() => fileRef.current?.click()}>
                {t("scan.photo")}
              </button>
              <button type="button" className="secondary" onClick={close}>
                {t("scan.cancel")}
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={onFile}
            />
          </div>
        </div>
      )}
    </>
  );
}
