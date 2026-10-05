/* push.js — تفعيل إشعارات الـ Push للأدمن */
import { sb } from './api.js';

export const VAPID_PUBLIC_KEY = 'BKY8TgWQ9hvHgUQxHcQQ-oSgFxy0fKVbn8qrvI1p4Jak-3a_goIOcQPcRJhcA5LPlttzmPK5VFlbpgXhdK1Y0hs';

const toU8 = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/* على الآيفون الإشعارات بتشتغل بس لو الابلكيشن متضاف للشاشة الرئيسية */
export function needsInstallOnIOS() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return ios && !standalone;
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('sw', e); return null; }
}

export async function pushState() {
  if (needsInstallOnIOS()) return 'ios';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch (e) { return 'off'; }
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  await registerSW();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toU8(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw error;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    try { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch (e) { /* ignore */ }
    await sub.unsubscribe();
  }
}
