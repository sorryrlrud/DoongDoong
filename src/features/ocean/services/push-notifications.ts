import type { PushSubscriptionInput } from "@/features/ocean/types/ocean";

export type PushSetupProblem =
  | "unsupported"
  | "permission-denied"
  | "missing-public-key"
  | "subscription-invalid";

export class PushSetupError extends Error {
  constructor(public readonly problem: PushSetupProblem) {
    super(problem);
    this.name = "PushSetupError";
  }
}

const hasWindow = (): boolean => typeof window !== "undefined";

export const isPushSupported = (): boolean =>
  hasWindow()
  && "serviceWorker" in navigator
  && "PushManager" in window
  && "Notification" in window;

export const notificationPermission = (): NotificationPermission | "unsupported" =>
  isPushSupported() ? Notification.permission : "unsupported";

export const getVapidPublicKey = (): string | null => {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();
  return key || null;
};

export const urlBase64ToUint8Array = (value: string): Uint8Array => {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = window.atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const getRegistration = async (): Promise<ServiceWorkerRegistration> => {
  if (!isPushSupported()) throw new PushSetupError("unsupported");
  return navigator.serviceWorker.ready;
};

export const toPushSubscriptionInput = (subscription: PushSubscription): PushSubscriptionInput => {
  const json = subscription.toJSON();
  const endpoint = json.endpoint ?? subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new PushSetupError("subscription-invalid");

  return {
    endpoint,
    p256dh,
    auth,
    userAgent: navigator.userAgent.slice(0, 512),
  };
};

export const getExistingPushSubscription = async (): Promise<PushSubscriptionInput | null> => {
  if (!isPushSupported() || Notification.permission !== "granted") return null;
  const registration = await getRegistration();
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? toPushSubscriptionInput(subscription) : null;
};

/**
 * Must be called from an explicit user gesture. It intentionally never invokes
 * Notification.requestPermission during background synchronization.
 */
export const requestPushSubscription = async (): Promise<PushSubscriptionInput> => {
  if (!isPushSupported()) throw new PushSetupError("unsupported");

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushSetupError("permission-denied");

  const registration = await getRegistration();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return toPushSubscriptionInput(existing);

  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) throw new PushSetupError("missing-public-key");

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
  });
  return toPushSubscriptionInput(subscription);
};

export const clearBrowserPushSubscription = async (): Promise<void> => {
  if (!isPushSupported()) return;
  const registration = await getRegistration().catch(() => null);
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
};

export const onPushSubscriptionChange = (callback: () => void): (() => void) => {
  if (!hasWindow() || !("serviceWorker" in navigator)) return () => undefined;
  const listener = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data === "object" && data !== null && "type" in data && data.type === "PUSH_SUBSCRIPTION_CHANGED") {
      callback();
    }
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
};

export const isIosDevice = (): boolean => {
  if (!hasWindow()) return false;
  const userAgent = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
};

export const isStandalonePwa = (): boolean =>
  hasWindow()
  && (window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true);
