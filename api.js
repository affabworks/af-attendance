/* api.js — الاتصال بـ Supabase */
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

if (!window.supabase) throw new Error('مكتبة Supabase ما اتحمّلتش (cdn.jsdelivr.net)');
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'af-admin-auth' },
});

export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw error;
  return data;
}
export const isUnauthorized = (e) => /unauthorized/i.test((e && e.message) || '');

/* جلسة الموظف (توكن عشوائي بيتحفظ في المتصفح، مش الـ PIN) */
export const empSession = {
  get token() { try { return localStorage.getItem('af_emp_token') || ''; } catch (e) { return ''; } },
  set(token) { try { localStorage.setItem('af_emp_token', token); } catch (e) { /* ignore */ } },
  clear() { try { localStorage.removeItem('af_emp_token'); } catch (e) { /* ignore */ } },
};
export const lastRole = {
  get() { try { return localStorage.getItem('af_last_role') || 'employee'; } catch (e) { return 'employee'; } },
  set(r) { try { localStorage.setItem('af_last_role', r); } catch (e) { /* ignore */ } },
};

/* قراءة QR من صورة */
function loadJsQR() {
  return new Promise((resolve) => {
    if (window.jsQR) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsqr/1.4.0/jsQR.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}
export function decodeQRFromFile(file) {
  return new Promise(async (resolve) => {
    const ok = await loadJsQR();
    if (!ok || !window.jsQR) return resolve(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(d.data, canvas.width, canvas.height);
        resolve(code ? code.data : null);
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/* رسم QR من غير ما نبعت الكود لأي موقع خارجي */
function loadQrGen() {
  return new Promise((resolve) => {
    if (window.qrcode) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}
export async function qrDataUrl(text) {
  const ok = await loadQrGen();
  if (!ok || !window.qrcode) return null;
  const qr = window.qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  return qr.createDataURL(8, 3); // صورة GIF جاهزة، من غير أي موقع خارجي
}
