/* app.js — نقطة البداية: تسجيل الدخول والتوجيه */
import { html, render, useState, useEffect, Icon, Field, Segmented, Splash, ToastHost, toast } from './ui.js';
import { SUPABASE_URL } from './config.js';
import { sb, rpc, empSession, lastRole } from './api.js';
import { EmployeeApp } from './employee.js';
import { AdminApp } from './admin.js';

/* لو حصل خطأ غير متوقع نعرضه بدل شاشة بيضاء (مفيد على الموبايل) */
function showFatal(msg) {
  let el = document.getElementById('fatal');
  if (!el) { el = document.createElement('div'); el.id = 'fatal'; document.body.appendChild(el); }
  el.innerHTML = '<div class="fatal-card"><b>حصلت مشكلة</b><pre dir="ltr"></pre><button onclick="location.reload()">إعادة تحميل</button></div>';
  el.querySelector('pre').textContent = String(msg).slice(0, 400);
}
window.addEventListener('error', (e) => {
  if (!e.error || /ResizeObserver|Script error/i.test(e.message || '')) return;
  showFatal(e.error.stack || e.message);
});
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });

/* ===================== تسجيل الدخول ===================== */
function Login({ onEmp, onAdmin }) {
  const [role, setRole] = useState(lastRole.get());
  const [list, setList] = useState(null);
  const [empId, setEmpId] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { rpc('public_employees').then(setList).catch(() => setList([])); }, []);

  async function empLogin() {
    if (!empId) return toast('اختر اسمك', 'bad');
    if (!pin) return toast('اكتب الرقم السري', 'bad');
    setBusy(true);
    try {
      const r = await rpc('emp_login', { p_emp: empId, p_pin: pin });
      if (r.ok) { empSession.set(r.token); lastRole.set('employee'); onEmp(r.token); return; }
      if (r.error === 'locked') toast(`المحاولات كتير — جرّب تاني بعد ${r.minutes} دقيقة`, 'bad');
      else if (r.error === 'wrong_pin') toast(r.left > 0 ? `الرقم السري غلط (باقي ${r.left} محاولات)` : 'الرقم السري غلط', 'bad');
      else toast('مقدرناش ندخلك، كلم الأدمن', 'bad');
      setPin('');
    } catch (e) { toast('مقدرناش نوصل للسيرفر. اتأكد من النت.', 'bad'); }
    setBusy(false);
  }
  async function adminLogin() {
    if (!email.trim() || !pass) return toast('اكتب الإيميل وكلمة السر', 'bad');
    setBusy(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass });
      if (error) { toast('الإيميل أو كلمة السر غلط', 'bad'); setBusy(false); return; }
      const ok = await rpc('is_admin');
      if (!ok) { await sb.auth.signOut(); toast('الحساب ده مش أدمن', 'bad'); setBusy(false); return; }
      lastRole.set('admin'); onAdmin(); return;
    } catch (e) { toast('مقدرناش نوصل للسيرفر. اتأكد من النت.', 'bad'); }
    setBusy(false);
  }
  const key = (fn) => (e) => { if (e.key === 'Enter') fn(); };

  return html`<div class="login">
    <div class="login-cover"><img src="logo-black.jpg" alt="AF Fabworks" /><div class="login-sub">نظام الحضور والمرتبات</div></div>
    <div class="login-card">
      <${Segmented} value=${role} onChange=${setRole} items=${[['employee', 'موظف'], ['admin', 'الإدارة']]} />
      ${role === 'employee' ? html`
        <${Field} label="اختر اسمك">
          <select class="input" value=${empId} onChange=${(e) => setEmpId(e.target.value)}>
            <option value="">${list === null ? 'لحظة...' : '-- اختر --'}</option>
            ${(list || []).map((e) => html`<option value=${e.id}>${e.name}</option>`)}
          </select><//>
        ${list && list.length === 0 && html`<div class="soft tiny center-t">مفيش موظفين — كلم الأدمن يضيفك.</div>`}
        ${empId && html`<${Field} label="الرقم السري (PIN)">
          <input class="input pin" type="password" inputmode="numeric" maxlength="8" value=${pin} onInput=${(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown=${key(empLogin)} /><//>`}
        <button class="btn bigbtn" disabled=${busy || !empId} onClick=${empLogin}><${Icon} name="lock" size=${22} /> دخول</button>` : html`
        <${Field} label="الإيميل"><input class="input ltr" type="email" autocomplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} /><//>
        <${Field} label="كلمة السر"><input class="input ltr" type="password" autocomplete="current-password" value=${pass} onInput=${(e) => setPass(e.target.value)} onKeyDown=${key(adminLogin)} /><//>
        <button class="btn bigbtn" disabled=${busy} onClick=${adminLogin}><${Icon} name="lock" size=${22} /> دخول لوحة الإدارة</button>`}
    </div>
  </div>`;
}

/* ===================== الجذر ===================== */
function Root() {
  const [view, setView] = useState({ name: 'boot' });
  useEffect(() => { const b = document.getElementById('boot'); if (b) b.remove(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (data && data.session) {
          let ok = false;
          try { ok = await rpc('is_admin'); } catch (e) { ok = false; }
          if (ok) return setView({ name: 'admin' });
          await sb.auth.signOut();
        }
      } catch (e) { /* كمّل للموظف */ }
      const tok = empSession.token;
      setView(tok ? { name: 'emp', token: tok } : { name: 'login' });
    })();
  }, []);

  const logoutEmp = () => { empSession.clear(); setView({ name: 'login' }); };
  const logoutAdmin = async () => { try { await sb.auth.signOut(); } catch (e) { /* ignore */ } setView({ name: 'login' }); };

  let body;
  if (SUPABASE_URL.includes('YOUR-PROJECT')) body = html`<${Splash} text="لسه ما ظبطتش ملف config.js (رابط Supabase والمفتاح)" />`;
  else if (view.name === 'boot') body = html`<${Splash} />`;
  else if (view.name === 'login') body = html`<${Login} onEmp=${(token) => setView({ name: 'emp', token })} onAdmin=${() => setView({ name: 'admin' })} />`;
  else if (view.name === 'emp') body = html`<${EmployeeApp} token=${view.token} onLogout=${logoutEmp} />`;
  else body = html`<${AdminApp} onLogout=${logoutAdmin} />`;

  return html`${body}<${ToastHost} />`;
}

render(html`<${Root} />`, document.getElementById('app'));
