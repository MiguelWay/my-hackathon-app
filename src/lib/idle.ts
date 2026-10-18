import { useEffect, useRef } from "react";

// The session ends after this long without use, on both sides: the server refuses a session whose
// `last_seen_at` is older, and the SPA signs out at the same moment so the screen never sits on stale
// data. Keep this in step with SESSION_IDLE_MINUTES (server default: 30).
export const IDLE_MINUTES = 30;
export const IDLE_LIMIT_MS = IDLE_MINUTES * 60_000;

// Shared across tabs, so being active in one tab keeps the others signed in.
const ACTIVITY_KEY = "pkgreturns.lastActivity";
// A mouse move fires many times a second; one stamp per second is plenty for a 30-minute clock.
const TOUCH_EVERY_MS = 1_000;
// Other tabs only need to hear about activity every so often.
const SHARE_EVERY_MS = 30_000;

export function isIdle(lastActivity: number, now: number, limitMs = IDLE_LIMIT_MS): boolean {
  return now - lastActivity >= limitMs;
}

/**
 * Signs the user out after `IDLE_MINUTES` without interaction. Interaction in any tab resets the clock
 * for all of them through localStorage; returning to a background tab checks the clock immediately,
 * because browsers throttle timers there.
 */
export function useIdleLogout(enabled: boolean, onIdle: () => void): void {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    let last = Date.now();
    let lastTouch = 0;
    let lastShare = 0;

    const readShared = (): number => {
      try {
        const value = Number(localStorage.getItem(ACTIVITY_KEY));
        return Number.isFinite(value) && value > 0 ? value : 0;
      } catch {
        return 0;
      }
    };

    const share = (now: number) => {
      if (now - lastShare < SHARE_EVERY_MS) return;
      lastShare = now;
      try {
        localStorage.setItem(ACTIVITY_KEY, String(now));
      } catch {
        // Private mode or a full store: the local timer still ends the session.
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, Math.max(0, IDLE_LIMIT_MS - (Date.now() - last)));
    };

    const check = () => {
      const shared = readShared();
      if (shared > last) last = shared;
      if (isIdle(last, Date.now())) {
        onIdleRef.current();
        return;
      }
      schedule();
    };

    const touch = () => {
      const now = Date.now();
      if (now - lastTouch < TOUCH_EVERY_MS) return;
      lastTouch = now;
      last = now;
      share(now);
      schedule();
    };

    // Coming back to the tab is use — but only if the clock had not already run out while away.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const shared = readShared();
      if (shared > last) last = shared;
      if (isIdle(last, Date.now())) {
        onIdleRef.current();
        return;
      }
      touch();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVITY_KEY || !event.newValue) return;
      const shared = Number(event.newValue);
      if (Number.isFinite(shared) && shared > last) {
        last = shared;
        schedule();
      }
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);

    last = Date.now();
    share(last);
    schedule();

    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled]);
}
