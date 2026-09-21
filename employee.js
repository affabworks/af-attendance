/* employee.js — حساب الموظف */
import { html, useState, useEffect, useMemo, Icon, Pill, Empty, Field, Stat, Sheet, Hero, BottomNav, NotifSheet, Splash, toast } from './ui.js';
import { rpc, isUnauthorized, decodeQRFromFile } from './api.js';
import * as L from './lib.js';

const CHECK_ERR = {
  friday: () => 'النهاردة الجمعة — إجازة أسبوعية',
  no_location: () => 'الإدارة لازم تحدد موقع الشغل الأول',
  no_position: () => 'مقدرناش نحدد موقعك',
  weak_accuracy: (r) => `دقة الموقع ضعيفة (${r.accuracy} م) — جرب في مكان مفتوح`,
  outside: (r) => `أنت برّه نطاق الشغل (${r.distance} متر)`,
  bad_qr: () => 'الكود ده مش بتاع الشركة دي',
  already_in: () => 'مسجل حضور بالفعل النهاردة',
  no_open: () => 'مفيش حضور مفتوح النهاردة',
};
const getPosition = () => new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }));
const LEAVE_LABEL = { pending: 'قيد المراجعة', approved: 'تمت الموافقة', rejected: 'مرفوضة' };
const LEAVE_TONE = { pending: 'amber', approved: 'green', rejected: 'gray' };

export function EmployeeApp({ token, onLogout }) {
  const [st, setSt] = useState(null);
  const [tab, setTab] = useState('attendance');
  const [sheet, setSheet] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const d = await rpc('emp_state', { p_token: token });
      L.setTZ(d.settings.tz);
      setSt(d); setErr('');
    } catch (e) {
      if (isUnauthorized(e)) { onLogout(); return; }
      setErr('مقدرناش نوصل للسيرفر. اتأكد من النت وجرّب تاني.');
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);

  /* تذكير بالحضور/الانصراف (مرة واحدة في اليوم لما التطبيق يكون مفتوح) */
  useEffect(() => {
    if (!st) return;
    const today = L.todayStr();
    if (L.isFriday(today)) return;
    const key = 'af_remind_' + st.employee.id + '_' + today;
    if (sessionStorage.getItem(key)) return;
    const rec = st.attendance.find((a) => a.work_date === today);
    const nowM = L.minutesOfDay(new Date().toISOString());
    if (!rec) {
      if (nowM > L.timeToMinutes(st.employee.shift_start || '09:00') + 15) { toast('متنساش تسجل حضورك النهاردة'); sessionStorage.setItem(key, '1'); }
    } else if (!rec.check_out && nowM > L.minutesOfDay(rec.check_in) + (Number(st.settings.shift_hours) || 12) * 60) {
      toast('متنساش تسجل انصرافك'); sessionStorage.setItem(key, '1');
    }
  }, [st && st.attendance.length, st && st.attendance.filter((a) => a.check_out).length]);

  const emp = st && st.employee;
  const S = st && st.settings;
  const weekStart = st ? L.effectiveWeekStart(S) : null;
  const report = useMemo(() => (st ? L.computeReport(emp, st, S, weekStart) : null), [st]);

  if (!st) {
    return html`<${Splash} text=${err || 'لحظة...'} />${err && html`<div class="splash-act"><button class="btn" onClick=${load}>حاول تاني</button></div>`}`;
  }

  const notes = st.notifications.map((n) => ({ ...n, _when: L.fmtDateTime(n.created_at) }));
  const unread = notes.filter((n) => !n.read).length;
  const X = { token, reload: load, emp, S, st, weekStart, report };
  const nav = [
    { id: 'attendance', icon: 'pin', label: 'الحضور' },
    { id: 'leave', icon: 'sun', label: 'إجازة' },
    { id: 'advance', icon: 'cash', label: 'سلفة' },
    { id: 'balance', icon: 'wallet', label: 'رصيدي' },
  ];
  async function openNotifs() {
    setSheet('notif');
    if (unread) { try { await rpc('emp_mark_read', { p_token: token }); load(); } catch (e) { /* ignore */ } }
  }

  return html`<div class="app">
    <${Hero} title=${'أهلاً، ' + emp.name} sub=${'أسبوع العمل: ' + L.fmtDayNum(weekStart) + ' ← ' + L.fmtDayNum(L.weekEndOf(weekStart))}
      right=${html`<button class="iconbtn" onClick=${openNotifs} aria-label="الإشعارات"><${Icon} name="bell" size=${21} />${unread > 0 && html`<i class="dot"></i>`}</button>
        <button class="iconbtn" onClick=${() => setSheet('account')} aria-label="حسابي"><${Icon} name="user" size=${21} /></button>`} />
    <main class="body">
      ${tab === 'attendance' && html`<${AttendanceTab} ...${X} />`}
      ${tab === 'leave' && html`<${LeaveTab} ...${X} />`}
      ${tab === 'advance' && html`<${AdvanceTab} ...${X} />`}
      ${tab === 'balance' && html`<${BalanceTab} ...${X} />`}
    </main>
    <${BottomNav} items=${nav} tab=${tab} onGo=${setTab} />
    ${sheet === 'notif' && html`<${NotifSheet} list=${notes} onClose=${() => setSheet(null)} />`}
    ${sheet === 'account' && html`<${AccountSheet} ...${X} onLogout=${onLogout} onClose=${() => setSheet(null)} />`}
  </div>`;
}

/* ===================== الحضور ===================== */
function AttendanceTab({ token, reload, emp, S, st, weekStart }) {
  const today = L.todayStr();
  const rec = st.attendance.find((a) => a.work_date === today);
  const friday = L.isFriday(today);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [scanning, setScanning] = useState(false);
  const kind = !rec ? 'in' : !rec.check_out ? 'out' : null;

  async function send(k, p, qr) {
    setBusy(true);
    try {
      const r = await rpc('emp_check', { p_token: token, p_kind: k, p_lat: p.lat, p_lng: p.lng, p_acc: p.acc, p_qr: qr || null });
      if (!r.ok) { toast((CHECK_ERR[r.error] || (() => 'حصلت مشكلة، جرّب تاني'))(r), 'bad'); }
      else { toast(k === 'in' ? 'تم تسجيل الحضور ✅' : 'تم تسجيل الانصراف ✅'); setPending(null); await reload(); }
    } catch (e) {
      if (isUnauthorized(e)) return;
      toast('مقدرناش نسجّل. اتأكد من النت وجرّب تاني.', 'bad');
    }
    setBusy(false);
  }

  async function start() {
    if (friday) return toast('النهاردة الجمعة — إجازة أسبوعية', 'bad');
    if (S.lat == null) return toast('الإدارة لازم تحدد موقع الشغل الأول', 'bad');
    if (!navigator.geolocation) return toast('المتصفح مش بيدعم تحديد الموقع', 'bad');
    setBusy(true);
    let pos;
    try { pos = await getPosition(); } catch (e) { setBusy(false); return toast('مقدرناش نحدد موقعك، فعّل إذن الموقع', 'bad'); }
    const { latitude, longitude, accuracy } = pos.coords;
    const p = { lat: latitude, lng: longitude, acc: accuracy || 0 };
    if (accuracy && accuracy > 150) { setBusy(false); return toast(`دقة الموقع ضعيفة (${Math.round(accuracy)} م) — جرب في مكان مفتوح`, 'bad'); }
    const dist = L.haversineMeters(latitude, longitude, S.lat, S.lng);
    if (dist > S.radius) { setBusy(false); return toast(`أنت برّه نطاق الشغل (${Math.round(dist)} متر)`, 'bad'); }
    if (S.qr_required) { setPending({ kind, p }); setBusy(false); return toast('الموقع تمام — دلوقتي صوّر كود الشركة'); }
    await send(kind, p, null);
  }
  async function onQr(file) {
    if (!file || !pending) return;
    setScanning(true);
    const decoded = await decodeQRFromFile(file);
    setScanning(false);
    if (!decoded) return toast('مقدرناش نقرا الكود، جرب صورة أوضح وأقرب للوحة', 'bad');
    await send(pending.kind, pending.p, decoded);
  }

  const dates = L.weekDates(weekStart);
  const statusIcon = { present: 'check', late: 'clock', leave: 'sun', absent: 'x' };
  const statusLbl = { present: 'حضور', late: 'متأخر', leave: 'إجازة', absent: 'غياب', future: '' };

  return html`
    ${friday ? html`<section class="card center off">
      <div class="ring amber"><${Icon} name="sun" size=${30} /></div>
      <div class="h2">النهاردة الجمعة</div>
      <div class="soft">إجازة أسبوعية — مفيش تسجيل حضور أو انصراف</div></section>` : html`
    <section class="card status">
      <div class="spread"><span class="soft">${L.fmtDateAr(today)}</span>
        ${rec ? (rec.check_out ? html`<${Pill} tone="dark" icon="check">خلّصت يومك<//>` : html`<${Pill} tone="green" icon="check">حاضر<//>`) : html`<${Pill} tone="gray">لسه<//>`}</div>
      <div class="times">
        <div><div class="k">حضور</div><div class="v num">${rec ? L.fmtTime(rec.check_in) : '—'}</div></div>
        <div class="sep"></div>
        <div><div class="k">انصراف</div><div class="v num">${rec && rec.check_out ? L.fmtTime(rec.check_out) : '—'}</div></div>
      </div>
      ${!pending && kind && html`<button class=${'btn bigbtn ' + (kind === 'out' ? 'dark' : '')} disabled=${busy} onClick=${start}>
        <${Icon} name=${kind === 'in' ? 'pin' : 'logout'} size=${24} /> ${busy ? 'جارِ التحديد...' : kind === 'in' ? 'سجّل حضورك' : 'سجّل انصرافك'}</button>`}
      ${!kind && html`<div class="note ok"><${Icon} name="check" size=${18} /> تم تسجيل يومك. تسلم إيدك</div>`}
      ${pending && html`<div class="qrstep">
        <div class="ring red"><${Icon} name="qr" size=${28} /></div>
        <div class="h3">الموقع اتأكد ✅</div>
        <div class="soft">دلوقتي صوّر كود QR المعلّق في الشركة عشان تخلّص ${pending.kind === 'in' ? 'الحضور' : 'الانصراف'}</div>
        <label class=${'btn bigbtn ' + (scanning || busy ? 'disabled' : '')}>
          <input type="file" accept="image/*" capture="environment" hidden onChange=${(e) => onQr(e.target.files[0])} />
          <${Icon} name="camera" size=${24} /> ${scanning ? 'جارِ القراءة...' : 'افتح الكاميرا وصوّر الكود'}</label>
        <button class="linkbtn" onClick=${() => setPending(null)}>إلغاء</button></div>`}
      ${!pending && !friday && html`<div class="soft tiny center-t"><${Icon} name="pin" size=${13} /> نطاق السماح ${S.radius} متر حوالين الشركة</div>`}
    </section>`}

    <section class="card">
      <div class="h3 mb8">أسبوعك</div>
      <div class="weekstrip">
        ${dates.map((d) => {
          const s = L.dayStatus(emp, d, st, S);
          return html`<div class=${'wd ' + s.kind + (d === today ? ' today' : '')}>
            <div class="dn">${L.fmtDayShort(d)}</div>
            <div class="dc">${s.kind === 'future' ? html`<span class="dash"></span>` : html`<${Icon} name=${statusIcon[s.kind]} size=${16} stroke=${2.6} />`}</div>
            <div class="dl">${s.kind === 'future' ? L.fmtDayNum(d).split(' ')[0] : statusLbl[s.kind]}</div>
          </div>`;
        })}
      </div>
    </section>`;
}

/* ===================== الإجازات ===================== */
function LeaveTab({ token, reload, st }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!from || !to) return toast('حدد تاريخ البداية والنهاية', 'bad');
    if (to < from) return toast('تاريخ النهاية لازم يكون بعد البداية', 'bad');
    setBusy(true);
    try {
      await rpc('emp_request_leave', { p_token: token, p_from: from, p_to: to, p_reason: reason.trim() });
      toast('تم إرسال طلب الإجازة ✅');
      setFrom(''); setTo(''); setReason('');
      await reload();
    } catch (e) { toast('مقدرناش نبعت الطلب، جرّب تاني', 'bad'); }
    setBusy(false);
  }
  const mine = st.leave_requests.slice().sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
  return html`
    <section class="card">
      <div class="h3">طلب إجازة</div>
      <div class="grid2">
        <${Field} label="من تاريخ"><input class="input" type="date" value=${from} onInput=${(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value); }} /><//>
        <${Field} label="لحد تاريخ"><input class="input" type="date" value=${to} min=${from} onInput=${(e) => setTo(e.target.value)} /><//>
      </div>
      <${Field} label="سبب الإجازة (اختياري)"><input class="input" value=${reason} onInput=${(e) => setReason(e.target.value)} placeholder="مثال: ظرف عائلي" /><//>
      <button class="btn" disabled=${busy} onClick=${submit}><${Icon} name="send" size=${20} /> إرسال طلب الإجازة</button>
    </section>
    <div class="sec-title">طلباتك السابقة</div>
    <section class="card tight">
      ${mine.length === 0 ? html`<${Empty} icon="sun" text="مفيش طلبات إجازة لسه" />` : mine.map((l) => html`<div class="row-item">
        <div class="ico t-amber"><${Icon} name="sun" size=${20} /></div>
        <div class="grow"><div class="b">${L.fmtDayNum(l.from_date)}${l.to_date !== l.from_date ? ' ← ' + L.fmtDayNum(l.to_date) : ''}</div>
          <div class="soft tiny">${l.reason || 'بدون سبب'}</div></div>
        <${Pill} tone=${LEAVE_TONE[l.status]}>${LEAVE_LABEL[l.status]}<//></div>`)}
    </section>`;
}

/* ===================== السلف ===================== */
function AdvanceTab({ token, reload, st }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  async function submit() {
    if (!Number(amount) || Number(amount) <= 0) return toast('اكتب المبلغ', 'bad');
    setBusy(true);
    try {
      const r = await rpc('emp_request_advance', { p_token: token, p_amount: Number(amount), p_note: note.trim() });
      setLast(r);
      toast('تم إرسال طلب السلفة — وريه للأدمن');
      setAmount(''); setNote('');
      await reload();
    } catch (e) { toast('مقدرناش نبعت الطلب، جرّب تاني', 'bad'); }
    setBusy(false);
  }
  const mine = st.advance_requests.slice().sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
  return html`
    <section class="card">
      <div class="h3">طلب سلفة</div>
      <${Field} label="مبلغ السلفة (جنيه)"><input class="input num" type="number" inputmode="numeric" value=${amount} onInput=${(e) => setAmount(e.target.value)} placeholder="0" /><//>
      <${Field} label="السبب (اختياري)"><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} /><//>
      <button class="btn" disabled=${busy} onClick=${submit}><${Icon} name="send" size=${20} /> إرسال الطلب</button>
    </section>
    ${last && html`<section class="card center showadmin">
      <div class="soft">وريّ الأدمن الشاشة دي عشان يسجّل الصرف</div>
      <div class="bignum num">${L.money(last.amount)} <small>جنيه</small></div>
      <div class="soft tiny">${L.fmtDateTime(last.requested_at)}</div></section>`}
    <div class="sec-title">طلباتك السابقة</div>
    <section class="card tight">
      ${mine.length === 0 ? html`<${Empty} icon="cash" text="مفيش طلبات لسه" />` : mine.map((r) => html`<div class="row-item">
        <div class="ico t-red"><${Icon} name="cash" size=${20} /></div>
        <div class="grow"><div class="b num">${L.money(r.amount)} جنيه</div>
          <div class="soft tiny">${L.fmtDateTime(r.requested_at)}${r.note ? ' — ' + r.note : ''}</div></div>
        <${Pill} tone=${r.status === 'paid' ? 'dark' : 'amber'}>${r.status === 'paid' ? 'تم الصرف' : 'قيد الانتظار'}<//></div>`)}
    </section>`;
}

/* ===================== رصيدي ===================== */
function BalanceTab({ emp, report: r, weekStart }) {
  return html`
    <section class="card netcard">
      <div class="soft-light">صافي رصيدك المتوقع</div>
      <div class="bignum num">${L.money(r.net)} <small>جنيه</small></div>
      <div class="soft-light tiny">أسبوع ${L.fmtDayNum(weekStart)} ← ${L.fmtDayNum(L.weekEndOf(weekStart))} · القبض يوم الخميس</div>
    </section>
    <div class="grid2 gap10">
      <${Stat} label="المرتب الأسبوعي" value=${L.money(emp.base_salary)} />
      <${Stat} label="أيام الحضور" value=${r.presentDays + ' / 6'} />
      <${Stat} label="غياب من غير إجازة" value=${r.unexcusedAbsences + ' يوم'} tone="bad" />
      <${Stat} label="خصم الغياب" value=${'-' + L.money(r.absenceDeduction)} tone="bad" />
      <${Stat} label="أيام إجازة" value=${r.excusedAbsences + ' يوم'} />
      <${Stat} label="خصم الإجازة" value=${'-' + L.money(r.leaveDeduction)} tone="bad" />
      <${Stat} label="خصم التأخير" value=${'-' + L.money(r.lateDeduction)} tone="bad" />
      <${Stat} label="خصم أخطاء" value=${'-' + L.money(r.mistakesDeduction)} tone="bad" />
      <${Stat} label="بونس" value=${'+' + L.money(r.bonusTotal)} tone="good" />
      <${Stat} label="سلف مصروفة" value=${'-' + L.money(r.advancesTotal)} tone="bad" />
      <${Stat} label="أوفر تايم" value=${'+' + L.money(r.overtimePay)} tone="good" sub=${r.overtimeHoursTotal + ' ساعة زيادة'} />
    </div>
    ${r.weekDeductions.length > 0 && html`<div class="sec-title">تفاصيل خصومات الأخطاء</div>
      <section class="card tight">${r.weekDeductions.map((d) => html`<div class="row-item"><div class="ico t-red"><${Icon} name="minus" size=${18} /></div>
        <div class="grow">${d.reason || 'بدون سبب مذكور'}</div><div class="amt neg num">-${L.money(d.amount)}</div></div>`)}</section>`}
    ${r.weekBonuses.length > 0 && html`<div class="sec-title">تفاصيل البونصات</div>
      <section class="card tight">${r.weekBonuses.map((d) => html`<div class="row-item"><div class="ico t-green"><${Icon} name="gift" size=${18} /></div>
        <div class="grow">${d.reason || 'بدون سبب مذكور'}</div><div class="amt pos num">+${L.money(d.amount)}</div></div>`)}</section>`}`;
}

/* ===================== حسابي: تغيير الـ PIN وتسجيل الخروج ===================== */
function AccountSheet({ token, emp, onClose, onLogout }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [cf, setCf] = useState('');
  const [busy, setBusy] = useState(false);
  const digits = (setter) => (e) => setter(e.target.value.replace(/\D/g, ''));
  async function save() {
    if (nw.length < 4) return toast('الرقم السري الجديد لازم يكون 4 أرقام على الأقل', 'bad');
    if (nw !== cf) return toast('الرقم السري الجديد مش متطابق', 'bad');
    if (nw === cur) return toast('اختار رقم سري مختلف عن القديم', 'bad');
    setBusy(true);
    try {
      const r = await rpc('emp_change_pin', { p_token: token, p_cur: cur, p_new: nw });
      if (!r.ok) toast(r.error === 'wrong_pin' ? 'الرقم السري الحالي غلط' : 'الرقم السري الجديد مش مقبول (4 لـ 8 أرقام)', 'bad');
      else { toast('تم تغيير الرقم السري ✅'); onClose(); }
    } catch (e) { toast('حصلت مشكلة، جرّب تاني', 'bad'); }
    setBusy(false);
  }
  async function out() {
    try { await rpc('emp_logout', { p_token: token }); } catch (e) { /* ignore */ }
    onLogout();
  }
  return html`<${Sheet} title=${emp.name} onClose=${onClose}>
    <div class="h3"><${Icon} name="key" size=${18} /> تغيير الرقم السري</div>
    <${Field} label="الرقم السري الحالي"><input class="input pin" type="password" inputmode="numeric" maxlength="8" value=${cur} onInput=${digits(setCur)} /><//>
    <${Field} label="الرقم السري الجديد"><input class="input pin" type="password" inputmode="numeric" maxlength="8" value=${nw} onInput=${digits(setNw)} /><//>
    <${Field} label="تأكيد الرقم السري الجديد"><input class="input pin" type="password" inputmode="numeric" maxlength="8" value=${cf} onInput=${digits(setCf)} /><//>
    <button class="btn" disabled=${busy || !cur || !nw} onClick=${save}>حفظ الرقم السري</button>
    <button class="btn ghost" onClick=${out}><${Icon} name="logout" size=${20} /> تسجيل الخروج</button>
  <//>`;
}
