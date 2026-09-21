-- =====================================================================
--  AF Fabworks — نظام الحضور والمرتبات الأسبوعية (Supabase)
--  الصق الملف كله في: Supabase ← SQL Editor ← New query ← Run
--  آمن إنك تشغّله أكتر من مرة.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) الجداول
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  lat double precision,
  lng double precision,
  radius int not null default 150,
  work_days_per_week int not null default 6,
  shift_hours numeric not null default 12,
  overtime_multiplier numeric not null default 1.5,
  qr_token text,
  current_week_start date,
  half_day_time text not null default '09:30',
  three_quarter_time text not null default '10:30',
  full_day_time text not null default '12:00',
  wa_phone text not null default '',
  tz text not null default 'Africa/Cairo'
);

-- أول أسبوع = السبت اللي قبل النهاردة (أو النهاردة لو سبت)
insert into public.settings (id, current_week_start)
select 1, ((now() at time zone 'Africa/Cairo')::date
           - (((extract(dow from (now() at time zone 'Africa/Cairo')::date))::int + 1) % 7))
on conflict (id) do nothing;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_salary numeric not null default 0,
  shift_start text not null default '09:00',
  created_at timestamptz not null default now()
);

-- الأرقام السرية متشفّرة ومحدش يقدر يقراها (لا الأدمن ولا الموظفين)
create table if not exists public.employee_pins (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  pin_hash text not null,
  failed_count int not null default 0,
  locked_until timestamptz
);

create table if not exists public.emp_sessions (
  token_hash text primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  check_in timestamptz not null default now(),
  check_out timestamptz,
  distance int,
  accuracy int,
  unique (employee_id, work_date)
);
create index if not exists attendance_date_idx on public.attendance (work_date);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now()
);

create table if not exists public.advance_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric not null check (amount > 0),
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'paid')),
  requested_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  amount numeric not null check (amount > 0),
  reason text not null default '',
  work_date date not null,
  type text not null default 'deduction' check (type in ('deduction', 'bonus'))
);
create index if not exists deductions_date_idx on public.deductions (work_date);

create table if not exists public.exemptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  type text not null check (type in ('late', 'absence', 'leave')),
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  target text not null,              -- 'admin' أو id الموظف
  type text not null default '',
  message text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false
);
create index if not exists notifications_target_idx on public.notifications (target, created_at desc);

create table if not exists public.payroll_history (
  week_start date primary key,
  week_end date not null,
  saved_at timestamptz not null default now(),
  employees jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------
-- 2) الأدمن + الصلاحيات (RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['admins','settings','employees','attendance','leave_requests',
                           'advance_requests','deductions','exemptions','notifications','payroll_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- جداول مفيش وصول مباشر ليها لأي حد (الدوال بس اللي بتتعامل معاها)
alter table public.employee_pins enable row level security;
alter table public.emp_sessions enable row level security;
revoke all on public.employee_pins from anon, authenticated;
revoke all on public.emp_sessions from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- 3) دوال داخلية
-- ---------------------------------------------------------------------
create or replace function public._haversine(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )));
$$;

create or replace function public._emp_id(p_token text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  select s.employee_id into v
    from public.emp_sessions s
    join public.employees e on e.id = s.employee_id
   where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.expires_at > now();
  if v is null then
    raise exception 'unauthorized';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 4) دوال الموظف (بتشتغل بتوكن الجلسة، مش بالـ PIN كل مرة)
-- ---------------------------------------------------------------------
create or replace function public.public_employees()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
    from public.employees;
$$;

create or replace function public.emp_login(p_emp uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  ep public.employee_pins%rowtype;
  v_token text;
begin
  select * into ep from public.employee_pins where employee_id = p_emp for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if ep.locked_until is not null and ep.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked',
                              'minutes', ceil(extract(epoch from (ep.locked_until - now())) / 60));
  end if;
  if ep.pin_hash <> crypt(coalesce(p_pin, ''), ep.pin_hash) then
    update public.employee_pins
       set failed_count = case when failed_count + 1 >= 5 then 0 else failed_count + 1 end,
           locked_until = case when failed_count + 1 >= 5 then now() + interval '10 minutes' else locked_until end
     where employee_id = p_emp;
    return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'left', greatest(0, 5 - (ep.failed_count + 1)));
  end if;
  update public.employee_pins set failed_count = 0, locked_until = null where employee_id = p_emp;
  delete from public.emp_sessions where expires_at < now();
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into public.emp_sessions (token_hash, employee_id)
  values (encode(digest(v_token, 'sha256'), 'hex'), p_emp);
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

create or replace function public.emp_logout(p_token text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.emp_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.emp_state(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v uuid := public._emp_id(p_token);
  s public.settings%rowtype;
begin
  select * into s from public.settings where id = 1;
  return jsonb_build_object(
    'employee', (select jsonb_build_object('id', e.id, 'name', e.name, 'base_salary', e.base_salary, 'shift_start', e.shift_start)
                   from public.employees e where e.id = v),
    'settings', jsonb_build_object(
      'lat', s.lat, 'lng', s.lng, 'radius', s.radius,
      'work_days_per_week', s.work_days_per_week, 'shift_hours', s.shift_hours,
      'overtime_multiplier', s.overtime_multiplier, 'qr_required', s.qr_token is not null,
      'current_week_start', s.current_week_start, 'tz', s.tz,
      'half_day_time', s.half_day_time, 'three_quarter_time', s.three_quarter_time, 'full_day_time', s.full_day_time),
    'attendance', coalesce((select jsonb_agg(to_jsonb(a) order by a.work_date) from public.attendance a where a.employee_id = v), '[]'::jsonb),
    'leave_requests', coalesce((select jsonb_agg(to_jsonb(l) order by l.requested_at) from public.leave_requests l where l.employee_id = v), '[]'::jsonb),
    'advance_requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.requested_at) from public.advance_requests r where r.employee_id = v), '[]'::jsonb),
    'deductions', coalesce((select jsonb_agg(to_jsonb(d) order by d.work_date) from public.deductions d where d.employee_id = v), '[]'::jsonb),
    'exemptions', coalesce((select jsonb_agg(to_jsonb(x) order by x.work_date) from public.exemptions x where x.employee_id = v), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc)
                                 from (select * from public.notifications where target = v::text order by created_at desc limit 50) n), '[]'::jsonb)
  );
end $$;

create or replace function public.emp_check(
  p_token text, p_kind text, p_lat double precision, p_lng double precision, p_acc double precision, p_qr text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_emp uuid := public._emp_id(p_token);
  s public.settings%rowtype;
  v_now timestamptz := now();
  v_today date;
  v_time text;
  v_dist double precision;
  v_name text;
  rec public.attendance%rowtype;
begin
  select * into s from public.settings where id = 1;
  v_today := (v_now at time zone s.tz)::date;
  v_time := to_char(v_now at time zone s.tz, 'HH24:MI');
  select name into v_name from public.employees where id = v_emp;

  if extract(dow from v_today) = 5 then
    return jsonb_build_object('ok', false, 'error', 'friday');
  end if;
  if s.lat is null or s.lng is null then
    return jsonb_build_object('ok', false, 'error', 'no_location');
  end if;
  if p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'error', 'no_position');
  end if;
  if p_acc is not null and p_acc > 150 then
    return jsonb_build_object('ok', false, 'error', 'weak_accuracy', 'accuracy', round(p_acc));
  end if;
  v_dist := public._haversine(p_lat, p_lng, s.lat, s.lng);
  if v_dist > s.radius then
    return jsonb_build_object('ok', false, 'error', 'outside', 'distance', round(v_dist));
  end if;
  if s.qr_token is not null and btrim(coalesce(p_qr, '')) <> btrim(s.qr_token) then
    return jsonb_build_object('ok', false, 'error', 'bad_qr');
  end if;

  select * into rec from public.attendance where employee_id = v_emp and work_date = v_today;
  if p_kind = 'in' then
    if found then
      return jsonb_build_object('ok', false, 'error', 'already_in');
    end if;
    insert into public.attendance (employee_id, work_date, check_in, distance, accuracy)
    values (v_emp, v_today, v_now, round(v_dist)::int, round(coalesce(p_acc, 0))::int);
    insert into public.notifications (target, type, message)
    values ('admin', 'attendance', v_name || ' سجل حضور الساعة ' || v_time);
    return jsonb_build_object('ok', true, 'kind', 'in');
  elsif p_kind = 'out' then
    if not found or rec.check_out is not null then
      return jsonb_build_object('ok', false, 'error', 'no_open');
    end if;
    update public.attendance set check_out = v_now where id = rec.id;
    insert into public.notifications (target, type, message)
    values ('admin', 'attendance', v_name || ' سجل انصراف الساعة ' || v_time);
    return jsonb_build_object('ok', true, 'kind', 'out');
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $$;

create or replace function public.emp_request_leave(p_token text, p_from date, p_to date, p_reason text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := public._emp_id(p_token); v_name text;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'bad_dates';
  end if;
  select name into v_name from public.employees where id = v;
  insert into public.leave_requests (employee_id, from_date, to_date, reason)
  values (v, p_from, p_to, coalesce(btrim(p_reason), ''));
  insert into public.notifications (target, type, message)
  values ('admin', 'leave', v_name || ' طلب إجازة من ' || p_from || ' لحد ' || p_to);
end $$;

create or replace function public.emp_request_advance(p_token text, p_amount numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := public._emp_id(p_token); v_name text; r public.advance_requests%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'bad_amount';
  end if;
  select name into v_name from public.employees where id = v;
  insert into public.advance_requests (employee_id, amount, note)
  values (v, p_amount, coalesce(btrim(p_note), ''))
  returning * into r;
  insert into public.notifications (target, type, message)
  values ('admin', 'advance', v_name || ' طلب سلفة ' || round(p_amount) || ' جنيه');
  return to_jsonb(r);
end $$;

create or replace function public.emp_mark_read(p_token text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := public._emp_id(p_token);
begin
  update public.notifications set read = true where target = v::text and not read;
end $$;

create or replace function public.emp_change_pin(p_token text, p_cur text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v uuid := public._emp_id(p_token); ep public.employee_pins%rowtype;
begin
  select * into ep from public.employee_pins where employee_id = v for update;
  if ep.pin_hash <> crypt(coalesce(p_cur, ''), ep.pin_hash) then
    return jsonb_build_object('ok', false, 'error', 'wrong_pin');
  end if;
  if p_new is null or p_new !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_new');
  end if;
  update public.employee_pins set pin_hash = crypt(p_new, gen_salt('bf')) where employee_id = v;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 5) دوال الأدمن
-- ---------------------------------------------------------------------
create or replace function public.admin_add_employee(p_name text, p_salary numeric, p_shift text, p_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'bad_pin'; end if;
  insert into public.employees (name, base_salary, shift_start)
  values (btrim(p_name), p_salary, coalesce(nullif(p_shift, ''), '09:00'))
  returning id into v;
  insert into public.employee_pins (employee_id, pin_hash) values (v, crypt(p_pin, gen_salt('bf')));
  return v;
end $$;

create or replace function public.admin_set_pin(p_emp uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'bad_pin'; end if;
  update public.employee_pins
     set pin_hash = crypt(p_pin, gen_salt('bf')), failed_count = 0, locked_until = null
   where employee_id = p_emp;
  delete from public.emp_sessions where employee_id = p_emp;
end $$;

-- قفل الأسبوع: حفظ التقرير في الأرشيف + تصفير حضور/خصومات/إعفاءات الأسبوع ده + السلف والإجازات اللي خلصت
create or replace function public.admin_close_week(p_old_start date, p_old_end date, p_new_start date, p_snapshot jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_tz text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select tz into v_tz from public.settings where id = 1;

  insert into public.payroll_history (week_start, week_end, employees)
  values (p_old_start, p_old_end, coalesce(p_snapshot, '[]'::jsonb))
  on conflict (week_start) do update
    set week_end = excluded.week_end, employees = excluded.employees, saved_at = now();

  delete from public.attendance where work_date between p_old_start and p_old_end;
  delete from public.deductions where work_date between p_old_start and p_old_end;
  delete from public.exemptions where work_date between p_old_start and p_old_end;
  delete from public.advance_requests where (requested_at at time zone v_tz)::date <= p_old_end;
  delete from public.leave_requests where to_date <= p_old_end;
  delete from public.notifications where created_at < now() - interval '30 days';

  update public.settings set current_week_start = p_new_start where id = 1;
end $$;

-- ---------------------------------------------------------------------
-- 6) صلاحيات تشغيل الدوال
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.public_employees() to anon, authenticated;
grant execute on function public.emp_login(uuid, text) to anon, authenticated;
grant execute on function public.emp_logout(text) to anon, authenticated;
grant execute on function public.emp_state(text) to anon, authenticated;
grant execute on function public.emp_check(text, text, double precision, double precision, double precision, text) to anon, authenticated;
grant execute on function public.emp_request_leave(text, date, date, text) to anon, authenticated;
grant execute on function public.emp_request_advance(text, numeric, text) to anon, authenticated;
grant execute on function public.emp_mark_read(text) to anon, authenticated;
grant execute on function public.emp_change_pin(text, text, text) to anon, authenticated;
grant execute on function public.admin_add_employee(text, numeric, text, text) to authenticated;
grant execute on function public.admin_set_pin(uuid, text) to authenticated;
grant execute on function public.admin_close_week(date, date, date, jsonb) to authenticated;

-- =====================================================================
--  بعد ما تعمل حساب الأدمن (Authentication ← Users ← Add user)
--  شغّل السطر ده مرة واحدة (غيّر الإيميل بإيميلك):
--
--    insert into public.admins (user_id)
--    select id from auth.users where email = 'YOUR-EMAIL@example.com'
--    on conflict do nothing;
-- =====================================================================
