/* =====================================================================
   lib.js — دوال مساعدة + حساب المرتب الأسبوعي (نفس منطق النسخة القديمة بالظبط)
   الأسبوع: سبت → خميس، والجمعة إجازة دايمًا.
   ===================================================================== */

export let TZ = 'Africa/Cairo';
export const setTZ = (tz) => { if (tz) TZ = tz; };

const LOCALE = 'ar-EG-u-nu-latn'; // أرقام إنجليزي عشان تتقري بسهولة

/* ---------- التواريخ (كلها بتوقيت الشركة، مش توقيت الجهاز) ---------- */
export const ymd = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
export const todayStr = () => ymd(new Date());
export const dowOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay(); // 0=أحد ... 5=جمعة ... 6=سبت
export function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const satOnOrBefore = (iso) => addDaysIso(iso, -((dowOf(iso) + 1) % 7));
/* أقرب خميس بعد (أو يساوي) بداية الأسبوع */
export const weekEndOf = (start) => addDaysIso(start, (4 - dowOf(start) + 7) % 7);
export function weekDates(start) {
  const end = weekEndOf(start);
  const out = [];
  for (let c = start; c <= end; c = addDaysIso(c, 1)) out.push(c);
  return out;
}
export const isFriday = (iso) => dowOf(iso || todayStr()) === 5;

/* الأسبوع الفعلي: لو الأسبوع المسجل قديم (الأدمن لسه ما قفلهوش) نستخدم سبت الحالي */
export function effectiveWeekStart(S) {
  const sat = satOnOrBefore(todayStr());
  const st = S && S.current_week_start;
  return st && st >= sat ? st : sat;
}

/* ---------- تنسيق ---------- */
export const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const fmtTime = (iso) =>
  iso ? new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date(iso)) : '—';
export const fmtDateTime = (iso) =>
  iso ? new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ }).format(new Date(iso)) : '—';
export const fmtDateAr = (iso) =>
  iso ? new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')) : '—';
export const fmtDayShort = (iso) =>
  iso ? new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')) : '';
export const fmtDayNum = (iso) =>
  iso ? new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')) : '';
export const dayOfIso = (iso) => (iso ? ymd(new Date(iso)) : '');

export function minutesOfDay(iso) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
}
export function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

/* ---------- مسافة GPS ---------- */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------- خصم التأخير: 0 / 0.5 / 0.75 / 1 يوم ---------- */
export function lateFraction(checkInIso, S) {
  const mins = minutesOfDay(checkInIso);
  const halfT = timeToMinutes(S.half_day_time || '09:30');
  const threeQT = timeToMinutes(S.three_quarter_time || '10:30');
  const fullT = timeToMinutes(S.full_day_time || '12:00');
  if (mins > fullT) return 1;
  if (mins > threeQT) return 0.75;
  if (mins > halfT) return 0.5;
  return 0;
}

/* ---------- حالة يوم واحد لموظف واحد (للجدول ولشريط الأسبوع) ---------- */
export function dayStatus(emp, date, data, S) {
  const today = todayStr();
  if (date > today) return { kind: 'future' };
  const rec = (data.attendance || []).find((a) => a.employee_id === emp.id && a.work_date === date && a.check_in);
  const ex = (type) => (data.exemptions || []).some((x) => x.employee_id === emp.id && x.work_date === date && x.type === type);
  if (rec) {
    const frac = lateFraction(rec.check_in, S);
    if (frac > 0) return { kind: 'late', rec, frac, exempt: ex('late') };
    return { kind: 'present', rec };
  }
  const onLeave = (data.leave_requests || []).some((l) => l.employee_id === emp.id && l.status === 'approved' && date >= l.from_date && date <= l.to_date);
  if (onLeave) return { kind: 'leave', exempt: ex('leave') };
  return { kind: 'absent', exempt: ex('absence') };
}

/* ===================== تقرير المرتب الأسبوعي ===================== */
export function computeReport(emp, data, S, weekStart) {
  const weekEnd = weekEndOf(weekStart);
  const today = todayStr();
  const effectiveEnd = today < weekEnd ? today : weekEnd;
  const dates = weekDates(weekStart).filter((d) => d <= effectiveEnd);

  const workDaysPerWeek = Number(S.work_days_per_week) || 6;
  const shiftHours = Number(S.shift_hours) || 12;
  const base = Number(emp.base_salary) || 0;
  const dailyRate = base / workDaysPerWeek;
  const hourlyRate = dailyRate / shiftHours;

  let presentDays = 0, unexcusedAbsences = 0, excusedAbsences = 0;
  let lateDeduction = 0, absenceDeduction = 0, leaveDeduction = 0, overtimeHoursTotal = 0;
  let exemptedLateCount = 0, exemptedAbsenceCount = 0, exemptedLeaveCount = 0;
  const attendance = data.attendance || [];
  const exemptions = data.exemptions || [];
  const leaves = data.leave_requests || [];
  const ex = (date, type) => exemptions.some((x) => x.employee_id === emp.id && x.work_date === date && x.type === type);

  dates.forEach((date) => {
    const rec = attendance.find((a) => a.employee_id === emp.id && a.work_date === date && a.check_in);
    if (rec) {
      presentDays++;
      const frac = lateFraction(rec.check_in, S);
      if (frac > 0 && ex(date, 'late')) exemptedLateCount++;
      else lateDeduction += frac * dailyRate;
      if (rec.check_out) {
        const hoursWorked = (new Date(rec.check_out) - new Date(rec.check_in)) / 3600000;
        if (hoursWorked > shiftHours) overtimeHoursTotal += hoursWorked - shiftHours;
      }
    } else {
      const onLeave = leaves.some((l) => l.employee_id === emp.id && l.status === 'approved' && date >= l.from_date && date <= l.to_date);
      if (onLeave) {
        excusedAbsences++;
        if (ex(date, 'leave')) exemptedLeaveCount++;
        else leaveDeduction += 1 * dailyRate;
      } else {
        unexcusedAbsences++;
        if (ex(date, 'absence')) exemptedAbsenceCount++;
        else absenceDeduction += 2 * dailyRate;
      }
    }
  });

  const overtimePay = overtimeHoursTotal * hourlyRate * (Number(S.overtime_multiplier) || 1.5);

  const inWeek = (d) => d >= weekStart && d <= weekEnd;
  const mine = (data.deductions || []).filter((d) => d.employee_id === emp.id && inWeek(d.work_date));
  const weekDeductions = mine.filter((d) => (d.type || 'deduction') === 'deduction');
  const mistakesDeduction = weekDeductions.reduce((s, d) => s + Number(d.amount), 0);
  const weekBonuses = mine.filter((d) => d.type === 'bonus');
  const bonusTotal = weekBonuses.reduce((s, d) => s + Number(d.amount), 0);

  const weekAdvancesPaid = (data.advance_requests || []).filter((r) => r.employee_id === emp.id && r.status === 'paid' && inWeek(dayOfIso(r.paid_at)));
  const advancesTotal = weekAdvancesPaid.reduce((s, r) => s + Number(r.amount), 0);

  const net = base - absenceDeduction - lateDeduction - leaveDeduction - mistakesDeduction - advancesTotal + overtimePay + bonusTotal;
  return {
    weekStart, weekEnd, presentDays, unexcusedAbsences, excusedAbsences,
    absenceDeduction, lateDeduction, leaveDeduction,
    weekDeductions, mistakesDeduction, weekBonuses, bonusTotal, weekAdvancesPaid, advancesTotal,
    overtimeHoursTotal: Math.round(overtimeHoursTotal * 10) / 10, overtimePay,
    exemptedLateCount, exemptedAbsenceCount, exemptedLeaveCount, net,
  };
}

/* نص تقرير اليوم للواتساب */
export function buildDailyReportText({ employees, data, S, weekStart }) {
  const today = todayStr();
  const nm = (id) => (employees.find((e) => e.id === id) || {}).name || '—';
  const L = [];
  L.push('*AF Fabworks — تقرير الحضور*');
  L.push('📅 ' + today, '');
  employees.forEach((emp) => {
    const rec = data.attendance.find((a) => a.employee_id === emp.id && a.work_date === today);
    if (rec) L.push(`✅ ${emp.name}: حضور ${fmtTime(rec.check_in)}${rec.check_out ? ' — انصراف ' + fmtTime(rec.check_out) : ' — لسه في الشغل'}`);
    else {
      const onLeave = data.leave_requests.some((l) => l.employee_id === emp.id && l.status === 'approved' && today >= l.from_date && today <= l.to_date);
      L.push(onLeave ? `🟡 ${emp.name}: إجازة معتمدة` : `❌ ${emp.name}: غايب`);
    }
  });
  const td = data.deductions.filter((d) => d.work_date === today && (d.type || 'deduction') === 'deduction');
  if (td.length) { L.push('', '⚠️ أخطاء اليوم:'); td.forEach((d) => L.push(`- ${nm(d.employee_id)}: ${d.reason} (${money(d.amount)} جنيه)`)); }
  const tb = data.deductions.filter((d) => d.work_date === today && d.type === 'bonus');
  if (tb.length) { L.push('', '➕ بونصات اليوم:'); tb.forEach((d) => L.push(`- ${nm(d.employee_id)}: ${d.reason} (+${money(d.amount)} جنيه)`)); }
  L.push('', `📊 ملخص الأسبوع الحالي (${weekStart} → ${weekEndOf(weekStart)}):`);
  employees.forEach((emp) => {
    const r = computeReport(emp, data, S, weekStart);
    L.push(`- ${emp.name}: حضور ${r.presentDays}/6، غياب بدون إجازة ${r.unexcusedAbsences}، إجازة ${r.excusedAbsences}، صافي متوقع ${money(r.net)} جنيه`);
  });
  return L.join('\n');
}
