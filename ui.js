/* ui.js — مكونات الواجهة المشتركة */
import { html, render, useState, useEffect, useRef, useMemo } from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';
export { html, render, useState, useEffect, useRef, useMemo };

/* ---------- أيقونات (SVG داخلي) ---------- */
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M16 13h.01"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  list: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  sliders: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  send: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  back: '<path d="m9 18 6-6-6-6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
};
export const Icon = ({ name, size = 22, stroke = 2, class: cls }) => html`<svg class=${'ic ' + (cls || '')} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }}></svg>`;

/* ---------- Toast ---------- */
let toastSetter = () => {};
export const bindToast = (fn) => { toastSetter = fn; };
export const toast = (msg, kind) => toastSetter({ msg, kind: kind || 'ok', id: Date.now() + Math.random() });
export function ToastHost() {
  const [t, setT] = useState(null);
  const tmr = useRef(null);
  useEffect(() => {
    bindToast((v) => { setT(v); clearTimeout(tmr.current); tmr.current = setTimeout(() => setT(null), 3600); });
    return () => bindToast(() => {});
  }, []);
  if (!t) return null;
  return html`<div class=${'toast ' + (t.kind === 'bad' ? 'bad' : '')} role="status" key=${t.id}>
    <${Icon} name=${t.kind === 'bad' ? 'alert' : 'check'} size=${18} /><span>${t.msg}</span></div>`;
}

/* ---------- عناصر صغيرة ---------- */
export const Pill = ({ tone = 'gray', children, icon }) => html`<span class=${'pill t-' + tone}>${icon && html`<${Icon} name=${icon} size=${14} />`}${children}</span>`;
export const Avatar = ({ name, tone }) => html`<div class=${'avatar ' + (tone || '')}>${(String(name || '?').trim().charAt(0) || '?')}</div>`;
export const Empty = ({ icon = 'info', text }) => html`<div class="empty"><${Icon} name=${icon} size=${26} /><span>${text}</span></div>`;
export const Spinner = () => html`<div class="spin"></div>`;
export const Field = ({ label, hint, children }) => html`<label class="field"><span class="lbl">${label}</span>${children}${hint && html`<span class="hint">${hint}</span>`}</label>`;
export const Segmented = ({ value, onChange, items }) => html`<div class="seg">${items.map(([id, label, badge]) => html`<button type="button" class=${value === id ? 'on' : ''} onClick=${() => onChange(id)}>${label}${badge > 0 && html`<i>${badge}</i>`}</button>`)}</div>`;
export const Stat = ({ label, value, tone, sub }) => html`<div class=${'stat ' + (tone || '')}><div class="k">${label}</div><div class="v num">${value}</div>${sub && html`<div class="s">${sub}</div>`}</div>`;

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    document.body.classList.add('noscroll');
    return () => document.body.classList.remove('noscroll');
  }, []);
  return html`<div class="sheet-back" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="sheet" role="dialog">
      <div class="sheet-grip"></div>
      <div class="spread"><div class="h2">${title}</div>
        <button class="iconbtn light" onClick=${onClose} aria-label="إغلاق"><${Icon} name="x" size=${20} /></button></div>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}

/* ---------- الهيدر الغامق ---------- */
export function Hero({ title, sub, right, back, logo = true }) {
  return html`<header class="hero">
    <div class="hero-top">
      ${back ? html`<button class="iconbtn" onClick=${back} aria-label="رجوع"><${Icon} name="back" size=${22} /></button>` : html`<div class="brand"><span class="brand-tile"><img src="icon-192.png" alt="AF" /></span>${logo && html`<span class="brand-name">AF Fabworks</span>`}</div>`}
      <div class="row gap8">${right}</div>
    </div>
    ${title && html`<h1 class="hero-title">${title}</h1>`}
    ${sub && html`<div class="hero-sub">${sub}</div>`}
  </header>`;
}

export function BottomNav({ items, tab, onGo }) {
  return html`<nav class="nav">${items.map((it) => html`<button class=${tab === it.id ? 'on' : ''} onClick=${() => onGo(it.id)}>
    <span class="nav-ic"><${Icon} name=${it.icon} size=${22} />${it.badge > 0 && html`<i class="cnt">${it.badge > 9 ? '9+' : it.badge}</i>`}</span><span class="nav-lb">${it.label}</span></button>`)}</nav>`;
}

/* ---------- لوحة الإشعارات ---------- */
export function NotifSheet({ list, onClose }) {
  return html`<${Sheet} title="الإشعارات" onClose=${onClose}>
    ${list.length === 0 ? html`<${Empty} icon="bell" text="مفيش إشعارات" />` : html`<div class="stack">
      ${list.map((n) => html`<div class=${'notif ' + (n.read ? '' : 'new')}><div>${n.message}</div><div class="soft tiny">${n._when}</div></div>`)}</div>`}
  <//>`;
}

/* شاشة تحميل / خطأ */
export const Splash = ({ text }) => html`<div class="splash"><img src="logo-full-dark.png" alt="AF Fabworks" /><div class="spin light"></div>${text && html`<div class="soft-light">${text}</div>`}</div>`;
