/* admin.js — لوحة الإدارة */
import { html, useState, useEffect, useMemo, Icon, Pill, Avatar, Empty, Field, Segmented, Sheet, Hero, BottomNav, NotifSheet, Splash, toast } from './ui.js';
import { sb, rpc, qrDataUrl } from './api.js';
import * as L from './lib.js';

const must = (r) => { if (r.error) throw r.error; return r.data; };
const errMsg = (e) => ({ forbidden: 'مش مسموحلك بالعملية دي', bad_pin: 'الرقم السري لازم يكون من 4 لـ 8 أرقام' }[e && e.message] || (e && e.message) || 'حصلت مشكلة');
const nowIso = () => new Date().toISOString();

async function fetchAll() {
  const T = (t) => sb.from(t).select('*');
  const r = await Promise.all([
    sb.from('employees').select('*').order('created_at'),
    T('attendance'), T('leave_requests'), T('advance_requests'), T('deductions'), T('exemptions'),
    sb.from('notifications').select('*').eq('target', 'admin').order('created_at', { ascending: false }).limit(100),
    sb.from('payroll_history').select('*').order('week_start', { ascending: false }).limit(20),
    sb.from('settings').select('*').eq('id', 1).single(),
  ]);
  return {
    employees: must(r[0]), attendance: must(r[1]), leave_requests: must(r[2]), advance_requests: must(r[3]),
    deductions: must(r[4]), exemptions: must(r[5]), notifications: must(r[6]), history: must(r[7]), S: must(r[8]),
  };
}
const notify = (target, type, message) => sb.from('notifications').insert({ target, type, message });

/* لقطة تقرير الأسبوع (بتتحفظ في الأرشيف وقت القفل) */
function snapshotOf(d, weekStart) {
  return d.employees.map((emp) => {
    const r = L.computeReport(emp, d, d.S, weekStart);
    return { employee_id: emp.id, name: emp.name, base_salary: emp.base_salary, ...r };
  });
}
async function closeOneWeek(d, oldStart) {
  const oldEnd = L.weekEndOf(oldStart);
  const newStart = L.addDaysIso(oldEnd, 2); // الخميس + يومين = السبت (الجمعة إجازة)
  const snap = snapshotOf(d, oldStart);
  await rpc('admin_close_week', { p_old_start: oldStart, p_old_end: oldEnd, p_new_start: newStart, p_snapshot: snap });
  return { weekStart: oldStart, weekEnd: oldEnd, employees: snap, newStart };
}

/* ===================================================================== */
export function AdminApp({ onLogout }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('today');
  const [sub, setSub] = useState({ today: 'list', requests: 'leaves' });
  const [sheet, setSheet] = useState(null);
  const [fatal, setFatal] = useState('');

  async function load() {
    try {
      let data = await fetchAll();
      L.setTZ(data.S.tz);
      /* قفل تلقائي لأي أسبوع خلص (زي النسخة القديمة) */
      const sat = L.satOnOrBefore(L.todayStr());
      if (!data.S.current_week_start) {
        must(await sb.from('settings').update({ current_week_start: sat }).eq('id', 1));
        data = await fetchAll();
      } else if (data.S.current_week_start < sat) {
        let cursor = data.S.current_week_start;
        while (cursor < sat) { const r = await closeOneWeek(data, cursor); cursor = r.newStart; }
        toast('اتقفل الأسبوع اللي فات تلقائي وتم حفظ تقريره في الأرشيف');
        data = await fetchAll();
      }
      setD(data); setFatal('');
    } catch (e) { setFatal(errMsg(e)); }
  }
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 45000);
    return () => clearInterval(t);
  }, []);

  if (!d) return html`<${Splash} text=${fatal || 'لحظة...'} />${fatal && html`<div class="splash-act"><button class="btn" onClick=${load}>حاول تاني</button><button class="btn ghost light" onClick=${onLogout}>خروج</button></div>`}`;

  const weekStart = d.S.current_week_start;
  const pendL = d.leave_requests.filter((l) => l.status === 'pending').length;
  const pendA = d.advance_requests.filter((r) => r.status === 'pending').length;
  const unread = d.notifications.filter((n) => !n.read).length;
  const A = {
    d, S: d.S, reload: load, weekStart, sub,
    go: (t, s) => { setTab(t); if (s) setSub((x) => ({ ...x, [t]: s })); },
    setSub: (t, s) => setSub((x) => ({ ...x, [t]: s })),
    open: setSheet, pendL, pendA,
    async act(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); await load(); return true; } catch (e) { toast(errMsg(e), 'bad'); return false; } },
  };
  const nav = [
    { id: 'today', icon: 'home', label: 'الحضور' },
    { id: 'employees', icon: 'users', label: 'الموظفين' },
    { id: 'requests', icon: 'list', label: 'الطلبات', badge: pendL + pendA },
    { id: 'report', icon: 'chart', label: 'المرتبات' },
    { id: 'settings', icon: 'sliders', label: 'الإعدادات' },
  ];
  const titles = { today: 'لوحة الإدارة', employees: 'الموظفين', requests: 'الطلبات', report: 'المرتبات', settings: 'الإعدادات' };

  async function openNotifs() {
    setSheet({ type: 'notif' });
    if (unread) { try { must(await sb.from('notifications').update({ read: true }).eq('target', 'admin').eq('read', false)); load(); } catch (e) { /* ignore */ } }
  }
  const notes = d.notifications.map((n) => ({ ...n, _when: L.fmtDateTime(n.created_at) }));

  return html`<div class="app wide">
    <${Hero} title=${titles[tab]} sub=${tab === 'today' ? L.fmtDateAr(L.todayStr()) : tab === 'report' ? 'أسبوع ' + L.fmtDayNum(weekStart) + ' ← ' + L.fmtDayNum(L.weekEndOf(weekStart)) : ''}
      right=${html`<button class="iconbtn" onClick=${openNotifs} aria-label="الإشعارات"><${Icon} name="bell" size=${21} />${unread > 0 && html`<i class="dot"></i>`}</button>
        <button class="iconbtn" onClick=${onLogout} aria-label="تسجيل خروج"><${Icon} name="logout" size=${21} /></button>`} />
    <main class="body">
      ${tab === 'today' && html`<${TodayTab} A=${A} />`}
      ${tab === 'employees' && html`<${EmployeesTab} A=${A} />`}
      ${tab === 'requests' && html`<${RequestsTab} A=${A} />`}
      ${tab === 'report' && html`<${ReportTab} A=${A} />`}
      ${tab === 'settings' && html`<${SettingsTab} A=${A} />`}
    </main>
    <${BottomNav} items=${nav} tab=${tab} onGo=${setTab} />
    ${sheet && sheet.type === 'notif' && html`<${NotifSheet} list=${notes} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.type === 'quick' && html`<${QuickSheet} A=${A} s=${sheet} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.type === 'waive' && html`<${WaiveSheet} A=${A} s=${sheet} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.type === 'empform' && html`<${EmpFormSheet} A=${A} s=${sheet} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.type === 'pin' && html`<${PinSheet} A=${A} s=${sheet} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.type === 'creds' && html`<${CredsSheet} s=${sheet} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.type === 'final' && html`<${FinalSheet} s=${sheet} onClose=${() => setSheet(null)} />`}
  </div>`;
}

/* ===================== الحضور: النهاردة + جدول الأسبوع ===================== */
function TodayTab({ A }) {
  const { d, S } = A;
  const today = L.todayStr();
  const mode = A.sub.today;
  return html`
    ${(A.pendL > 0 || A.pendA > 0) && html`<div class="alerts">
      ${A.pendL > 0 && html`<button class="alert-chip" onClick=${() => A.go('requests', 'leaves')}><${Icon} name="sun" size=${20} /> ${A.pendL} طلب إجازة محتاج رد</button>`}
      ${A.pendA > 0 && html`<button class="alert-chip" onClick=${() => A.go('requests', 'advances')}><${Icon} name="cash" size=${20} /> ${A.pendA} طلب سلفة محتاج رد</button>`}</div>`}
    <${Segmented} value=${mode} onChange=${(v) => A.setSub('today', v)} items=${[['list', 'النهاردة'], ['schedule', 'جدول الأسبوع']]} />
    ${mode === 'list' ? html`
      ${L.isFriday(today) && html`<div class="note warn"><${Icon} name="sun" size=${18} /> النهاردة الجمعة — إجازة أسبوعية</div>`}
      <div class="stack">
        ${d.employees.map((emp) => {
          const s = L.dayStatus(emp, today, d, S);
          const st = s.kind === 'present' ? { t: 'حضر', tone: 'green', icon: 'check' } : s.kind === 'late' ? { t: 'متأخر', tone: 'amber', icon: 'clock' } : s.kind === 'leave' ? { t: 'إجازة', tone: 'gray', icon: 'sun' } : { t: 'غايب لسه', tone: 'red', icon: 'x' };
          return html`<section class="card emp-card">
            <div class="row gap12"><${Avatar} name=${emp.name} />
              <div class="grow"><div class="b">${emp.name}</div>
                <div class="soft tiny num">${s.rec ? 'حضور ' + L.fmtTime(s.rec.check_in) + (s.rec.check_out ? ' · انصراف ' + L.fmtTime(s.rec.check_out) : ' · لسه في الشغل') : 'معاد الحضور ' + emp.shift_start}</div></div>
              <${Pill} tone=${st.tone} icon=${st.icon}>${st.t}<//></div>
            <div class="quick">
              <button onClick=${() => A.open({ type: 'quick', emp, kind: 'advance' })}><${Icon} name="cash" size=${18} /> سلفة</button>
              <button onClick=${() => A.open({ type: 'quick', emp, kind: 'deduction' })}><${Icon} name="minus" size=${18} /> خصم</button>
              <button onClick=${() => A.open({ type: 'quick', emp, kind: 'bonus' })}><${Icon} name="gift" size=${18} /> بونص</button>
            </div></section>`;
        })}
        ${d.employees.length === 0 && html`<${Empty} icon="users" text="مفيش موظفين مضافين — ضيفهم من تبويب الموظفين" />`}
      </div>` : html`<${Schedule} A=${A} />`}`;
}

function Schedule({ A }) {
  const { d, S, weekStart } = A;
  const dates = L.weekDates(weekStart);
  const today = L.todayStr();
  if (d.employees.length === 0) return html`<${Empty} icon="users" text="أضف موظفين الأول عشان تشوف الجدول" />`;
  const icon = { present: 'check', late: 'clock', leave: 'sun', absent: 'x' };
  const lbl = { present: '', late: 'متأخر', leave: 'إجازة', absent: 'غياب' };
  const wtype = { late: 'late', leave: 'leave', absent: 'absence' };
  async function undo(emp, date, type) {
    const ex = d.exemptions.find((x) => x.employee_id === emp.id && x.work_date === date && x.type === type);
    if (!ex || !confirm('متأكد إنك عايز تلغي الإعفاء ده؟ الخصم هيرجع تاني.')) return;
    A.act(async () => must(await sb.from('exemptions').delete().eq('id', ex.id)), 'تم إلغاء الإعفاء');
  }
  return html`<div class="sched-legend soft tiny">
      <span><i class="lg green"></i>حضور</span><span><i class="lg amber"></i>متأخر</span><span><i class="lg gray"></i>إجازة</span><span><i class="lg red"></i>غياب</span></div>
    <section class="card tight sched-wrap"><table class="sched">
      <thead><tr><th class="sticky">الموظف</th>${dates.map((dt) => html`<th class=${dt === today ? 'today' : ''}>${L.fmtDayShort(dt)}<small>${L.fmtDayNum(dt)}</small></th>`)}</tr></thead>
      <tbody>${d.employees.map((emp) => html`<tr><td class="sticky b">${emp.name}</td>
        ${dates.map((dt) => {
          const s = L.dayStatus(emp, dt, d, S);
          if (s.kind === 'future') return html`<td class="c"><span class="dash"></span></td>`;
          const type = wtype[s.kind];
          return html`<td class=${'c ' + s.kind}>
            <div class="cell-ic"><${Icon} name=${icon[s.kind]} size=${16} stroke=${2.6} /></div>
            <div class="cell-t num">${s.rec ? L.fmtTime(s.rec.check_in).replace(' ', '') : lbl[s.kind]}</div>
            ${type && (s.exempt
              ? html`<button class="waive on" onClick=${() => undo(emp, dt, type)}>معفى ✕</button>`
              : html`<button class="waive" onClick=${() => A.open({ type: 'waive', emp, date: dt, wtype: type })}>إعفاء</button>`)}
          </td>`;
        })}</tr>`)}</tbody></table></section>
    <p class="soft tiny">دوس "إعفاء" جنب أي يوم فيه تأخير أو غياب أو إجازة عشان تلغي خصم اليوم ده مع كتابة السبب.</p>`;
}

/* سلفة / خصم / بونص سريع */
function QuickSheet({ A, s, onClose }) {
  const { emp, kind } = s;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const T = { advance: ['تسجيل سلفة', 'مبلغ السلفة'], deduction: ['تسجيل خصم', 'مبلغ الخصم'], bonus: ['تسجيل بونص', 'مبلغ البونص'] }[kind];
  async function save() {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast('اكتب مبلغ صحيح', 'bad');
    if (!reason.trim()) return toast('اكتب السبب', 'bad');
    setBusy(true);
    const ok = await A.act(async () => {
      if (kind === 'advance') {
        must(await sb.from('advance_requests').insert({ employee_id: emp.id, amount: amt, note: reason.trim(), status: 'paid', paid_at: nowIso() }));
        await notify(emp.id, 'advance_status', `تم صرف سلفة ${L.money(amt)} جنيه — ${reason.trim()}`);
      } else {
        must(await sb.from('deductions').insert({ employee_id: emp.id, amount: amt, reason: reason.trim(), work_date: L.todayStr(), type: kind }));
        await notify(emp.id, kind, kind === 'bonus' ? `اتسجل ليك بونس ${L.money(amt)} جنيه — السبب: ${reason.trim()}` : `اتسجل عليك خصم ${L.money(amt)} جنيه — السبب: ${reason.trim()}`);
      }
    }, kind === 'advance' ? 'تم تسجيل السلفة ✅' : kind === 'bonus' ? 'تم تسجيل البونس ✅' : 'تم تسجيل الخصم ✅');
    setBusy(false);
    if (ok) onClose();
  }
  return html`<${Sheet} title=${T[0]} onClose=${onClose}>
    <div class="who"><${Avatar} name=${emp.name} /><b>${emp.name}</b></div>
    <${Field} label=${T[1]}><input class="input num" type="number" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)} placeholder="0" /><//>
    <${Field} label="السبب"><textarea class="input" rows="2" value=${reason} onInput=${(e) => setReason(e.target.value)}></textarea><//>
    <button class=${'btn ' + (kind === 'bonus' ? 'green' : kind === 'advance' ? 'dark' : '')} disabled=${busy} onClick=${save}>تأكيد</button>
  <//>`;
}

/* إعفاء */
function WaiveSheet({ A, s, onClose }) {
  const { emp, date, wtype } = s;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const label = wtype === 'late' ? 'خصم التأخير' : wtype === 'leave' ? 'خصم يوم الإجازة' : 'خصم الغياب';
  async function save() {
    if (!reason.trim()) return toast('اكتب سبب الإعفاء', 'bad');
    setBusy(true);
    const ok = await A.act(async () => {
      must(await sb.from('exemptions').insert({ employee_id: emp.id, work_date: date, type: wtype, reason: reason.trim() }));
      await notify(emp.id, 'exemption', `الأدمن عفاك من ${label} يوم ${date} — السبب: ${reason.trim()}`);
    }, 'تم الإعفاء ✅');
    setBusy(false);
    if (ok) onClose();
  }
  return html`<${Sheet} title=${'إعفاء من ' + label} onClose=${onClose}>
    <div class="who"><${Avatar} name=${emp.name} /><div><b>${emp.name}</b><div class="soft tiny">${L.fmtDateAr(date)}</div></div></div>
    <${Field} label="سبب الإعفاء"><textarea class="input" rows="3" value=${reason} onInput=${(e) => setReason(e.target.value)}></textarea><//>
    <button class="btn" disabled=${busy} onClick=${save}>تأكيد الإعفاء</button>
  <//>`;
}

/* ===================== الموظفين ===================== */
function EmployeesTab({ A }) {
  const { d } = A;
  async function remove(emp) {
    if (!confirm(`متأكد إنك عايز تمسح ${emp.name}؟ هيتمسح معاه كل سجلاته.`)) return;
    A.act(async () => must(await sb.from('employees').delete().eq('id', emp.id)), 'تم مسح الموظف');
  }
  return html`
    <button class="btn" onClick=${() => A.open({ type: 'empform' })}><${Icon} name="plus" size=${20} /> إضافة موظف</button>
    <div class="stack mt12">
      ${d.employees.map((e) => html`<section class="card">
        <div class="row gap12"><${Avatar} name=${e.name} />
          <div class="grow"><div class="b">${e.name}</div>
            <div class="soft tiny"><span class="num">${L.money(e.base_salary)}</span> جنيه/أسبوع · معاد الحضور <span class="num">${e.shift_start}</span></div></div></div>
        <div class="quick three">
          <button onClick=${() => A.open({ type: 'empform', emp: e })}><${Icon} name="edit" size=${18} /> تعديل</button>
          <button onClick=${() => A.open({ type: 'pin', emp: e })}><${Icon} name="key" size=${18} /> PIN</button>
          <button class="danger" onClick=${() => remove(e)}><${Icon} name="trash" size=${18} /> مسح</button>
        </div></section>`)}
      ${d.employees.length === 0 && html`<${Empty} icon="users" text="مفيش موظفين مضافين" />`}
    </div>`;
}

function EmpFormSheet({ A, s, onClose }) {
  const e = s.emp;
  const [name, setName] = useState(e ? e.name : '');
  const [salary, setSalary] = useState(e ? String(e.base_salary) : '');
  const [shift, setShift] = useState(e ? e.shift_start : '09:00');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim() || !salary) return toast('اكتب الاسم والمرتب', 'bad');
    if (!e && !/^\d{4,8}$/.test(pin)) return toast('الرقم السري لازم يكون من 4 لـ 8 أرقام', 'bad');
    setBusy(true);
    let created = null;
    const ok = await A.act(async () => {
      if (e) must(await sb.from('employees').update({ name: name.trim(), base_salary: Number(salary), shift_start: shift }).eq('id', e.id));
      else { await rpc('admin_add_employee', { p_name: name.trim(), p_salary: Number(salary), p_shift: shift, p_pin: pin }); created = { name: name.trim(), pin }; }
    }, e ? 'تم تعديل بيانات الموظف ✅' : 'تم إضافة الموظف ✅');
    setBusy(false);
    if (ok) { onClose(); if (created) A.open({ type: 'creds', ...created }); }
  }
  return html`<${Sheet} title=${e ? 'تعديل موظف' : 'إضافة موظف'} onClose=${onClose}>
    <${Field} label="اسم الموظف"><input class="input" value=${name} onInput=${(ev) => setName(ev.target.value)} /><//>
    <div class="grid2">
      <${Field} label="المرتب الأسبوعي"><input class="input num" type="number" inputmode="numeric" value=${salary} onInput=${(ev) => setSalary(ev.target.value)} /><//>
      <${Field} label="معاد الحضور الرسمي"><input class="input num" type="time" value=${shift} onInput=${(ev) => setShift(ev.target.value)} /><//>
    </div>
    ${!e && html`<${Field} label="الرقم السري (4 لـ 8 أرقام)" hint="الموظف هيدخل بيه، وتقدر يغيّره بنفسه بعد كده"><input class="input pin" inputmode="numeric" maxlength="8" value=${pin} onInput=${(ev) => setPin(ev.target.value.replace(/\D/g, ''))} /><//>`}
    <button class="btn" disabled=${busy} onClick=${save}>${e ? 'حفظ التعديل' : 'إضافة الموظف'}</button>
  <//>`;
}

function PinSheet({ A, s, onClose }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!/^\d{4,8}$/.test(pin)) return toast('الرقم السري لازم يكون من 4 لـ 8 أرقام', 'bad');
    setBusy(true);
    const ok = await A.act(async () => rpc('admin_set_pin', { p_emp: s.emp.id, p_pin: pin }), 'تم تغيير الرقم السري ✅');
    setBusy(false);
    if (ok) { onClose(); A.open({ type: 'creds', name: s.emp.name, pin }); }
  }
  return html`<${Sheet} title="رقم سري جديد" onClose=${onClose}>
    <div class="who"><${Avatar} name=${s.emp.name} /><b>${s.emp.name}</b></div>
    <div class="note info"><${Icon} name="shield" size=${18} /> الأرقام السرية متشفّرة ومش بتظهر تاني، ولو الموظف نسي رقمه بتعمله رقم جديد من هنا.</div>
    <${Field} label="الرقم السري الجديد"><input class="input pin" inputmode="numeric" maxlength="8" value=${pin} onInput=${(e) => setPin(e.target.value.replace(/\D/g, ''))} /><//>
    <button class="btn" disabled=${busy} onClick=${save}>حفظ</button>
  <//>`;
}

function CredsSheet({ s, onClose }) {
  const url = location.origin + location.pathname.replace(/[^/]*$/, '');
  const text = `أهلاً ${s.name}، دي بيانات دخولك لنظام الحضور:\nاختار اسمك من القايمة وادخل الرقم السري: ${s.pin}\nالرابط: ${url}\nتقدر تغيّر الرقم السري من أيقونة حسابي.`;
  return html`<${Sheet} title="بيانات دخول الموظف" onClose=${onClose}>
    <div class="creds"><div class="soft">الرقم السري لـ ${s.name}</div><div class="bignum num pinshow">${s.pin}</div>
      <div class="soft tiny">خُد الرقم ده دلوقتي — مش هيظهر تاني</div></div>
    <a class="btn green" target="_blank" href=${'https://wa.me/?text=' + encodeURIComponent(text)}><${Icon} name="send" size=${20} /> ابعته على واتساب</a>
    <button class="btn ghost" onClick=${onClose}>تمام</button>
  <//>`;
}

/* ===================== الطلبات ===================== */
function RequestsTab({ A }) {
  const sub = A.sub.requests;
  return html`
    <${Segmented} value=${sub} onChange=${(v) => A.setSub('requests', v)} items=${[['leaves', 'إجازات', A.pendL], ['advances', 'سلف', A.pendA], ['deductions', 'أخطاء وبونص']]} />
    ${sub === 'leaves' && html`<${Leaves} A=${A} />`}
    ${sub === 'advances' && html`<${Advances} A=${A} />`}
    ${sub === 'deductions' && html`<${Deductions} A=${A} />`}`;
}

const nameOf = (d, id) => (d.employees.find((e) => e.id === id) || {}).name || '—';

function Leaves({ A }) {
  const { d } = A;
  const pending = d.leave_requests.filter((l) => l.status === 'pending').sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
  const done = d.leave_requests.filter((l) => l.status !== 'pending').sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
  const setStatus = (l, status) => A.act(async () => {
    must(await sb.from('leave_requests').update({ status }).eq('id', l.id));
    await notify(l.employee_id, 'leave_status', status === 'approved' ? `تمت الموافقة على إجازتك (${l.from_date} → ${l.to_date})` : `تم رفض طلب إجازتك (${l.from_date} → ${l.to_date})`);
  }, status === 'approved' ? 'تمت الموافقة على الإجازة ✅' : 'تم رفض الطلب');
  return html`
    <div class="sec-title">قيد المراجعة</div>
    <div class="stack">${pending.map((l) => html`<section class="card pend">
      <div class="row gap12"><div class="ico t-amber"><${Icon} name="sun" size=${20} /></div>
        <div class="grow"><div class="b">${nameOf(d, l.employee_id)}</div><div class="soft tiny">${L.fmtDayNum(l.from_date)}${l.to_date !== l.from_date ? ' ← ' + L.fmtDayNum(l.to_date) : ''} · ${l.reason || 'بدون سبب'}</div></div></div>
      <div class="quick two"><button class="ok" onClick=${() => setStatus(l, 'approved')}><${Icon} name="check" size=${18} /> موافقة</button>
        <button class="danger" onClick=${() => setStatus(l, 'rejected')}><${Icon} name="x" size=${18} /> رفض</button></div></section>`)}
      ${pending.length === 0 && html`<${Empty} icon="check" text="مفيش طلبات جديدة" />`}</div>
    <div class="sec-title">طلبات سابقة</div>
    <section class="card tight">${done.map((l) => html`<div class="row-item"><div class="grow"><div class="b">${nameOf(d, l.employee_id)}</div>
      <div class="soft tiny">${L.fmtDayNum(l.from_date)}${l.to_date !== l.from_date ? ' ← ' + L.fmtDayNum(l.to_date) : ''}</div></div>
      <${Pill} tone=${l.status === 'approved' ? 'green' : 'gray'}>${l.status === 'approved' ? 'تمت الموافقة' : 'مرفوضة'}<//></div>`)}
      ${done.length === 0 && html`<${Empty} icon="info" text="مفيش سجل لسه" />`}</section>`;
}

function Advances({ A }) {
  const { d } = A;
  const pending = d.advance_requests.filter((r) => r.status === 'pending').sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
  const paid = d.advance_requests.filter((r) => r.status === 'paid').sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1));
  const markPaid = (r) => A.act(async () => {
    must(await sb.from('advance_requests').update({ status: 'paid', paid_at: nowIso() }).eq('id', r.id));
    await notify(r.employee_id, 'advance_status', `تم صرف سلفتك ${L.money(r.amount)} جنيه`);
  }, 'تم تسجيل الصرف ✅');
  const remove = (r) => confirm('مسح الطلب ده؟') && A.act(async () => must(await sb.from('advance_requests').delete().eq('id', r.id)));
  return html`
    <div class="sec-title">قيد الانتظار</div>
    <div class="stack">${pending.map((r) => html`<section class="card pend">
      <div class="row gap12"><div class="ico t-red"><${Icon} name="cash" size=${20} /></div>
        <div class="grow"><div class="b">${nameOf(d, r.employee_id)} — <span class="num">${L.money(r.amount)}</span> جنيه</div>
          <div class="soft tiny">${L.fmtDateTime(r.requested_at)}${r.note ? ' — ' + r.note : ''}</div></div></div>
      <div class="quick two"><button class="ok" onClick=${() => markPaid(r)}><${Icon} name="check" size=${18} /> تم الصرف</button>
        <button class="danger" onClick=${() => remove(r)}><${Icon} name="trash" size=${18} /> مسح</button></div></section>`)}
      ${pending.length === 0 && html`<${Empty} icon="check" text="مفيش طلبات جديدة" />`}</div>
    <div class="sec-title">تم صرفها</div>
    <section class="card tight">${paid.map((r) => html`<div class="row-item"><div class="grow"><div class="b">${nameOf(d, r.employee_id)} — <span class="num">${L.money(r.amount)}</span> جنيه</div>
      <div class="soft tiny">اتصرفت ${L.fmtDateTime(r.paid_at)}${r.note ? ' — ' + r.note : ''}</div></div>
      <button class="iconbtn light" onClick=${() => remove(r)} aria-label="مسح"><${Icon} name="trash" size=${18} /></button></div>`)}
      ${paid.length === 0 && html`<${Empty} icon="info" text="مفيش سلف اتصرفت لسه" />`}</section>`;
}

function Deductions({ A }) {
  const { d } = A;
  const [type, setType] = useState('deduction');
  const [emp, setEmp] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!emp || !Number(amount) || !reason.trim()) return toast('اختر الموظف واكتب المبلغ والسبب', 'bad');
    setBusy(true);
    const amt = Number(amount);
    const ok = await A.act(async () => {
      must(await sb.from('deductions').insert({ employee_id: emp, amount: amt, reason: reason.trim(), work_date: L.todayStr(), type }));
      await notify(emp, type, type === 'bonus' ? `اتسجل ليك بونس ${L.money(amt)} جنيه — السبب: ${reason.trim()}` : `اتسجل عليك خصم ${L.money(amt)} جنيه — السبب: ${reason.trim()}`);
    }, type === 'bonus' ? 'تم تسجيل البونس ✅' : 'تم تسجيل الخصم ✅');
    setBusy(false);
    if (ok) { setAmount(''); setReason(''); }
  }
  const remove = (x) => A.act(async () => must(await sb.from('deductions').delete().eq('id', x.id)));
  const list = d.deductions.slice().sort((a, b) => (a.work_date < b.work_date ? 1 : -1));
  return html`
    <section class="card">
      <${Segmented} value=${type} onChange=${setType} items=${[['deduction', 'خصم (-)'], ['bonus', 'بونس (+)']]} />
      <${Field} label="الموظف"><select class="input" value=${emp} onChange=${(e) => setEmp(e.target.value)}>
        <option value="">اختر موظف</option>${d.employees.map((e) => html`<option value=${e.id}>${e.name}</option>`)}</select><//>
      <div class="grid2">
        <${Field} label=${type === 'bonus' ? 'مبلغ البونس' : 'مبلغ الخصم'}><input class="input num" type="number" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)} /><//>
        <${Field} label="السبب"><input class="input" value=${reason} onInput=${(e) => setReason(e.target.value)} /><//>
      </div>
      <button class=${'btn ' + (type === 'bonus' ? 'green' : '')} disabled=${busy} onClick=${add}><${Icon} name="plus" size=${20} /> ${type === 'bonus' ? 'تسجيل بونس' : 'تسجيل خصم'}</button>
    </section>
    <div class="sec-title">السجل</div>
    <section class="card tight">${list.map((x) => html`<div class="row-item">
      <div class=${'ico ' + (x.type === 'bonus' ? 't-green' : 't-red')}><${Icon} name=${x.type === 'bonus' ? 'gift' : 'minus'} size=${18} /></div>
      <div class="grow"><div class="b">${nameOf(d, x.employee_id)}</div><div class="soft tiny">${x.reason} · ${L.fmtDayNum(x.work_date)}</div></div>
      <div class=${'amt num ' + (x.type === 'bonus' ? 'pos' : 'neg')}>${x.type === 'bonus' ? '+' : '-'}${L.money(x.amount)}</div>
      <button class="iconbtn light" onClick=${() => remove(x)} aria-label="مسح"><${Icon} name="trash" size=${18} /></button></div>`)}
      ${list.length === 0 && html`<${Empty} icon="info" text="مفيش خصومات أو بونصات مسجلة" />`}</section>`;
}

/* ===================== المرتبات ===================== */
function ReportTab({ A }) {
  const { d, S, weekStart } = A;
  const rows = d.employees.map((emp) => ({ emp, r: L.computeReport(emp, d, S, weekStart) }));
  const total = rows.reduce((s, x) => s + x.r.net, 0);
  const [openHist, setOpenHist] = useState('');

  function sendWa() {
    const phone = (S.wa_phone || '').replace(/[^0-9]/g, '');
    if (!phone) return toast('سجل رقم واتساب من الإعدادات الأول', 'bad');
    const text = L.buildDailyReportText({ employees: d.employees, data: d, S, weekStart });
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  }
  async function lockNow() {
    if (weekStart > L.todayStr()) return toast('الأسبوع الحالي مضبوط لتاريخ مستقبلي — استخدم زرار إصلاح الأسبوع في الإعدادات', 'bad');
    const end = L.weekEndOf(weekStart);
    if (!confirm(`متأكد إنك عايز تقفل الأسبوع الحالي (${L.fmtDateAr(weekStart)} → ${L.fmtDateAr(end)}) دلوقتي؟\n\nهيتحفظ تقرير الأسبوع في الأرشيف، وبعدين هيتمسح: الحضور، الخصومات، البونصات، الإعفاءات، طلبات السلف، وطلبات الإجازة اللي خلصت.\n\nالأسبوع الجديد هيبدأ صفحة بيضاء. متأكد؟`)) return;
    try {
      const r = await closeOneWeek(d, weekStart);
      A.open({ type: 'final', ...r });
      toast('تم قفل الأسبوع ✅');
      await A.reload();
    } catch (e) { toast(errMsg(e), 'bad'); }
  }
  return html`
    <div class="row gap8 wrap">
      <button class="btn dark sm grow" onClick=${sendWa}><${Icon} name="send" size=${18} /> تقرير اليوم واتساب</button>
      <button class="btn sm grow" onClick=${lockNow}><${Icon} name="lock" size=${18} /> قفل الأسبوع</button>
    </div>
    <section class="card netcard mt12">
      <div class="soft-light">مين له كام (لحد النهاردة) · القبض الخميس</div>
      <div class="owe">${rows.map(({ emp, r }) => html`<div class="owe-row"><span>${emp.name}</span><b class="num">${L.money(r.net)} جنيه</b></div>`)}
        ${rows.length === 0 && html`<div class="soft-light center-t">مفيش موظفين</div>`}</div>
      ${rows.length > 0 && html`<div class="owe-total"><span>الإجمالي</span><b class="num">${L.money(total)} جنيه</b></div>`}
    </section>
    <div class="stack">${rows.map(({ emp, r }) => html`<section class="card">
      <div class="spread"><div class="row gap12"><${Avatar} name=${emp.name} /><div class="b">${emp.name}</div></div>
        <div class="bignum sm num">${L.money(r.net)} <small>جنيه</small></div></div>
      <div class="grid3 mt12">
        <div class="mini"><span>الأساسي</span><b class="num">${L.money(emp.base_salary)}</b></div>
        <div class="mini"><span>الحضور</span><b class="num">${r.presentDays} / 6</b></div>
        <div class="mini"><span>غياب بدون إجازة</span><b class="num neg">${r.unexcusedAbsences} يوم</b></div>
        <div class="mini"><span>خصم الغياب</span><b class="num neg">-${L.money(r.absenceDeduction)}</b></div>
        <div class="mini"><span>أيام إجازة</span><b class="num">${r.excusedAbsences} يوم</b></div>
        <div class="mini"><span>خصم الإجازة</span><b class="num neg">-${L.money(r.leaveDeduction)}</b></div>
        <div class="mini"><span>خصم التأخير</span><b class="num neg">-${L.money(r.lateDeduction)}</b></div>
        <div class="mini"><span>خصم أخطاء</span><b class="num neg">-${L.money(r.mistakesDeduction)}</b></div>
        <div class="mini"><span>بونس</span><b class="num pos">+${L.money(r.bonusTotal)}</b></div>
        <div class="mini"><span>سلف</span><b class="num neg">-${L.money(r.advancesTotal)}</b></div>
        <div class="mini"><span>أوفر تايم</span><b class="num pos">+${L.money(r.overtimePay)}</b><i>${r.overtimeHoursTotal} س</i></div>
      </div></section>`)}
      ${rows.length === 0 && html`<${Empty} icon="users" text="أضف موظفين الأول عشان تشوف التقرير" />`}</div>

    <div class="sec-title"><${Icon} name="history" size=${16} /> أرشيف الأسابيع</div>
    <section class="card tight">
      ${d.history.length === 0 && html`<${Empty} icon="history" text="مفيش أسابيع متقفلة لسه" />`}
      ${d.history.map((h) => {
        const list = Array.isArray(h.employees) ? h.employees : [];
        const sum = list.reduce((s, e) => s + (Number(e.net) || 0), 0);
        const open = openHist === h.week_start;
        return html`<div class="hist"><button class="hist-head" onClick=${() => setOpenHist(open ? '' : h.week_start)}>
            <div class="grow"><div class="b">${L.fmtDayNum(h.week_start)} ← ${L.fmtDayNum(h.week_end)}</div><div class="soft tiny">${list.length} موظف</div></div>
            <b class="num">${L.money(sum)} جنيه</b><span class=${'chev ' + (open ? 'up' : '')}><${Icon} name="back" size=${18} /></span></button>
          ${open && html`<div class="hist-body">${list.map((e) => html`<div class="owe-row dark"><span>${e.name}</span><b class="num">${L.money(e.net)} جنيه</b></div>`)}</div>`}</div>`;
      })}
    </section>`;
}

function FinalSheet({ s, onClose }) {
  const total = s.employees.reduce((a, e) => a + (Number(e.net) || 0), 0);
  return html`<${Sheet} title="تم قفل الأسبوع ✅" onClose=${onClose}>
    <div class="soft">${L.fmtDateAr(s.weekStart)} ← ${L.fmtDateAr(s.weekEnd)}</div>
    <div class="soft tiny">مين له كام:</div>
    <div class="stack">${s.employees.map((e) => html`<div class="owe-row dark"><span>${e.name}</span><b class="num">${L.money(e.net)} جنيه</b></div>`)}
      ${s.employees.length === 0 && html`<${Empty} icon="users" text="مفيش موظفين" />`}</div>
    <div class="owe-total dark"><span>الإجمالي</span><b class="num">${L.money(total)} جنيه</b></div>
    <button class="btn" onClick=${onClose}>تمام</button>
  <//>`;
}

/* ===================== الإعدادات ===================== */
function SettingsTab({ A }) {
  const { S } = A;
  const [locating, setLocating] = useState(false);
  const [num, setNum] = useState({ radius: S.radius, work: S.work_days_per_week, hours: S.shift_hours, ot: S.overtime_multiplier });
  const [late, setLate] = useState({ half: S.half_day_time, tq: S.three_quarter_time, full: S.full_day_time });
  const [wa, setWa] = useState(S.wa_phone || '');
  const [pw, setPw] = useState('');
  const [qrImg, setQrImg] = useState('');
  const correct = L.satOnOrBefore(L.todayStr());
  const mismatch = S.current_week_start !== correct;

  useEffect(() => { let on = true; if (S.qr_token) qrDataUrl(S.qr_token).then((u) => { if (on) setQrImg(u || ''); }); else setQrImg(''); return () => { on = false; }; }, [S.qr_token]);

  const save = (patch, msg) => A.act(async () => must(await sb.from('settings').update(patch).eq('id', 1)), msg);
  function useMyLocation() {
    if (!navigator.geolocation) return toast('المتصفح مش بيدعم تحديد الموقع', 'bad');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (p) => { setLocating(false); await save({ lat: p.coords.latitude, lng: p.coords.longitude }, 'تم حفظ موقع الشركة ✅'); },
      () => { setLocating(false); toast('مقدرناش نحدد الموقع', 'bad'); },
      { enableHighAccuracy: true, timeout: 12000 });
  }
  const fixWeek = () => confirm(`الأسبوع المسجل: ${L.fmtDateAr(S.current_week_start)}\nالأسبوع الصحيح المفروض يبدأ: ${L.fmtDateAr(correct)}\n\nده هيصلّح بس تاريخ بداية الأسبوع، من غير ما يمسح أي بيانات. تكمّل؟`) && save({ current_week_start: correct }, 'تم إصلاح الأسبوع الحالي ✅');
  const genQr = () => save({ qr_token: (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).slice(0, 8).toUpperCase() }, 'تم توليد كود جديد — اطبعه وعلّقه في الشركة');
  async function changePw() {
    if (pw.length < 6) return toast('كلمة السر 6 حروف على الأقل', 'bad');
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) return toast(errMsg(error), 'bad');
    setPw(''); toast('تم تغيير كلمة السر ✅');
  }
  const N = (k) => (e) => setNum({ ...num, [k]: e.target.value });

  return html`<div class="stack">
    <section class=${'card ' + (mismatch ? 'warnbox' : '')}>
      <div class="h3"><${Icon} name="cal" size=${19} /> أسبوع العمل الحالي</div>
      <div class="soft">المسجل دلوقتي: <b>${L.fmtDateAr(S.current_week_start)} ← ${L.fmtDateAr(L.weekEndOf(S.current_week_start))}</b></div>
      ${mismatch ? html`<div class="note bad"><${Icon} name="alert" size=${18} /> التاريخ ده مش متوافق مع النهاردة — الأسبوع المفروض يبدأ ${L.fmtDateAr(correct)}.</div>
        <button class="btn sm" onClick=${fixWeek}>إصلاح الأسبوع الحالي</button>` : html`<div class="note ok"><${Icon} name="check" size=${18} /> متوافق مع تاريخ النهاردة</div>`}
    </section>

    <section class="card">
      <div class="h3"><${Icon} name="pin" size=${19} /> موقع الشركة</div>
      ${S.lat != null ? html`<div class="soft num">محفوظ: ${S.lat.toFixed(5)}, ${S.lng.toFixed(5)}</div>` : html`<div class="soft">لسه محددتش موقع الشركة</div>`}
      <button class="btn sm" disabled=${locating} onClick=${useMyLocation}>${locating ? 'جارِ التحديد...' : 'استخدم موقعي الحالي كموقع الشركة'}</button>
    </section>

    <section class="card">
      <div class="h3">قواعد الخصم على وقت الحضور</div>
      <div class="rules">
        <div class="rule"><span>نص يوم بعد الساعة</span><input class="input num" type="time" value=${late.half} onInput=${(e) => setLate({ ...late, half: e.target.value })} /></div>
        <div class="rule"><span>3/4 يوم بعد الساعة</span><input class="input num" type="time" value=${late.tq} onInput=${(e) => setLate({ ...late, tq: e.target.value })} /></div>
        <div class="rule"><span>يوم كامل بعد الساعة</span><input class="input num" type="time" value=${late.full} onInput=${(e) => setLate({ ...late, full: e.target.value })} /></div>
      </div>
      <button class="btn dark sm" onClick=${() => save({ half_day_time: late.half, three_quarter_time: late.tq, full_day_time: late.full }, 'تم حفظ قواعد الخصم ✅')}>حفظ قواعد الخصم</button>
    </section>

    <section class="card">
      <div class="h3">إعدادات الحساب</div>
      <div class="grid2">
        <${Field} label="نطاق الحضور (متر)"><input class="input num" type="number" value=${num.radius} onInput=${N('radius')} /><//>
        <${Field} label="أيام الأسبوع"><input class="input num" type="number" value=${num.work} onInput=${N('work')} /><//>
        <${Field} label="ساعات الشيفت"><input class="input num" type="number" value=${num.hours} onInput=${N('hours')} /><//>
        <${Field} label="مضاعف الأوفر تايم"><input class="input num" type="number" step="0.1" value=${num.ot} onInput=${N('ot')} /><//>
      </div>
      <button class="btn dark sm" onClick=${() => save({ radius: Number(num.radius) || 150, work_days_per_week: Number(num.work) || 6, shift_hours: Number(num.hours) || 12, overtime_multiplier: Number(num.ot) || 1 }, 'تم الحفظ ✅')}>حفظ</button>
    </section>

    <section class="card">
      <div class="h3"><${Icon} name="send" size=${19} /> تقارير واتساب</div>
      <${Field} label="رقم واتساب لاستلام التقارير" hint="بالكود الدولي بدون + (مثال: 201012345678). هيفتحلك واتساب برسالة جاهزة من تبويب المرتبات."><input class="input num" inputmode="tel" value=${wa} onInput=${(e) => setWa(e.target.value)} placeholder="201012345678" /><//>
      <button class="btn dark sm" onClick=${() => save({ wa_phone: wa.trim() }, 'تم حفظ رقم الواتساب ✅')}>حفظ</button>
    </section>

    <section class="card center">
      <div class="h3"><${Icon} name="qr" size=${19} /> كود حضور الشركة (QR)</div>
      ${S.qr_token ? html`
        ${qrImg ? html`<img class="qrimg" src=${qrImg} alt="QR" />` : html`<div class="soft num bignum">${S.qr_token}</div>`}
        <div class="soft tiny">اطبع الصورة دي وعلّقها في مكان ثابت بالشركة. الموظف بيصوّرها وقت الحضور.</div>
        <div class="row gap8"><button class="btn dark sm" onClick=${genQr}>توليد كود جديد</button>
          <button class="btn ghost sm" onClick=${() => save({ qr_token: null }, 'تم إلغاء طلب الـ QR')}>إلغاء الاشتراط</button></div>` : html`
        <div class="soft">مفيش كود مفعّل — الحضور بيعتمد على الموقع بس.</div>
        <button class="btn sm" onClick=${genQr}>توليد كود QR</button>`}
    </section>

    <section class="card">
      <div class="h3"><${Icon} name="lock" size=${19} /> كلمة سر الأدمن</div>
      <${Field} label="كلمة سر جديدة (6 حروف على الأقل)"><input class="input" type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} /><//>
      <button class="btn dark sm" onClick=${changePw}>تغيير</button>
    </section>

    <section class="card note-card"><${Icon} name="shield" size=${20} />
      <div class="soft">تسجيل الحضور محمي بالموقع + الـ QR + الرقم السري، والتحقق كله بيتم على السيرفر. الحماية الكاملة من تزييف الـ GPS محتاجة تطبيق موبايل حقيقي، مش متاحة 100% من متصفح.</div></section>
  </div>`;
}
