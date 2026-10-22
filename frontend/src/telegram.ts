import { useEffect, useRef } from "react";

type BackButton = {
  show: () => void;
  hide: () => void;
  onClick: (handler: () => void) => void;
  offClick: (handler: () => void) => void;
};
type WebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  BackButton?: BackButton;
};
declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}
// The raw signed initData is sent to the backend; client fields are never
// used to establish identity or authorization.
export const telegramApp = () => window.Telegram?.WebApp;
export type AuthConfig = { telegram_enabled: boolean; demo_enabled: boolean };
export type AuthContext = { onboarding_required: boolean };

type BackRegistration = { priority: number; callback: () => void };
const backHandlers = new Map<symbol, BackRegistration>();
let wiredButton: BackButton | undefined;

const backPressed = () => {
  const active = [...backHandlers.values()].sort(
    (a, b) => b.priority - a.priority,
  )[0];
  active?.callback();
};

function syncTelegramBack() {
  // Never display Telegram chrome in the demo browser; do not trust
  // WebApp.initData for authentication (that is exclusively server-side).
  const button = telegramApp()?.initData ? telegramApp()?.BackButton : undefined;
  if (wiredButton !== button) {
    wiredButton?.offClick(backPressed);
    wiredButton = button;
    wiredButton?.onClick(backPressed);
  }
  if (wiredButton) {
    if (backHandlers.size) wiredButton.show();
    else {
      wiredButton.hide();
      wiredButton.offClick(backPressed);
      wiredButton = undefined;
    }
  }
}

/** Shared native back stack: dialog > mobile detail > vacancy > section.
 * React strict-mode cleanup is idempotent, and handlers see fresh state. */
export function useTelegramBack(
  enabled: boolean,
  callback: () => void,
  priority = 0,
) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    if (!enabled) return;
    const id = Symbol("telegram-back");
    backHandlers.set(id, {
      priority,
      callback: () => latest.current(),
    });
    syncTelegramBack();
    return () => {
      backHandlers.delete(id);
      syncTelegramBack();
    };
  }, [enabled, priority]);
}
