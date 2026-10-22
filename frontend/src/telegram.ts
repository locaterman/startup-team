type WebApp = { initData: string; ready: () => void; expand: () => void };
declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}
// Read only the raw signed payload. Identity is established by the server.
export const telegramApp = () => window.Telegram?.WebApp;
export type AuthConfig = { telegram_enabled: boolean; demo_enabled: boolean };
export type AuthContext = { onboarding_required: boolean };
