// Availability engine — clean-room implementation of the scheduling rules observed via REA
// (PAST, TOOSOON, RANGE, BUFFER, CALENDAR, EVENT, OVERLAP, DAYMAX/WEEKMAX/MONTHMAX, GROUP,
//  BLOCK_OUT_DATE, HOSTS, ROUNDROBIN, UNFAIR, USER_EVENT_LIMITS, RESERVED, no_rules, blackout).
import { DateTime, Interval } from 'luxon';
import { db, J, mapSchedule, mapBooking, DEFAULT_SETTINGS } from './db.js';

const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const REASONS = {
  PAST: 'This time slot is in the past.',
  TOOSOON: 'Falls inside the minimum scheduling notice.',
  RANGE: 'Falls outside the date range that has been set.',
  BUFFER: 'A before/after buffer is blocking this time.',
  CALENDAR: 'Overlaps a busy event on a connected calendar.',
  EVENT: 'This event type is already booked at this time.',
  OVERLAP: 'Overlaps another scheduled meeting.',
  DAYMAX: 'Daily limit for this event type reached.',
  WEEKMAX: 'Weekly limit for this event type reached.',
  MONTHMAX: 'Monthly limit for this event type reached.',
  GROUP: 'Maximum number of invitees for this group slot reached.',
  BLOCK_OUT_DATE: 'Marked as time off.',
  HOSTS: 'Not all hosts are available (collective event).',
  ROUNDROBIN: 'No round-robin hosts are available.',
  UNFAIR: 'Only hosts who are ahead in meeting count are available (equal distribution).',
  USER_EVENT_LIMITS: 'Host meeting limit per day reached.',
  RESERVED: 'Time is reserved for a meeting poll.',
  OUTSIDE_HOURS: 'Outside of working hours.',
};

export function settingsOf(et) { return { ...DEFAULT_SETTINGS, ...(et.settings || {}) }; }

export function hostIdsOf(et) {
  if (et.kind === 'collective' || et.kind === 'round_robin') {
    const h = (et.hosts || []).map(Number).filter(Boolean);
    return h.length ? h : [et.user_id];
  }
  return [et.user_id];
}

function scheduleFor(et, hostId) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(hostId);
  if (!user) return null;
  let sid = user.default_schedule_id;
  if (et.schedule_id && hostId === et.user_id) sid = et.schedule_id;
  const s = mapSchedule(db.prepare('SELECT * FROM schedules WHERE id=?').get(sid))
    || mapSchedule(db.prepare('SELECT * FROM schedules WHERE user_id=? ORDER BY id LIMIT 1').get(hostId));
  return { user, schedule: s };
}

function parseHM(date, hm, zone) {
  if (hm === '24:00') return DateTime.fromISO(`${date}T00:00`, { zone }).plus({ days: 1 });
  return DateTime.fromISO(`${date}T${hm}`, { zone });
}

function intervalsForDate(schedule, date) {
  const ov = schedule.overrides || {};
  if (Object.prototype.hasOwnProperty.call(ov, date)) return { intervals: ov[date] || [], source: 'override' };
  const wd = WD[DateTime.fromISO(date).weekday - 1];
  return { intervals: (schedule.rules || {})[wd] || [], source: 'rules', weekday: wd };
}

function hostBookings(hostId, fromISO, toISO, excludeUid) {
  return db.prepare(`SELECT * FROM bookings WHERE status='active' AND start_utc < ? AND end_utc > ?
      AND EXISTS (SELECT 1 FROM json_each(bookings.host_ids) WHERE value = ?) AND (? IS NULL OR uid <> ?)`)
    .all(toISO, fromISO, hostId, excludeUid ?? null, excludeUid ?? null).map(mapBooking);
}

function hostBusy(hostId) {
  const rows = db.prepare('SELECT busy FROM calendars WHERE user_id=? AND check_conflicts=1').all(hostId);
  const out = [];
  for (const r of rows) for (const b of J(r.busy, [])) out.push({ s: Date.parse(b.start), e: Date.parse(b.end), title: b.title });
  return out;
}

function hostReservations(hostId) {
  const polls = db.prepare(`SELECT * FROM polls WHERE user_id=? AND status='open' AND reserve_times=1`).all(hostId);
  const out = [];
  for (const p of polls) for (const o of J(p.options, [])) {
    const s = Date.parse(o.start); out.push({ s, e: s + p.duration * 60000, title: p.title, poll_id: p.id });
  }
  return out;
}

function timeOffFor(hostId) {
  return db.prepare('SELECT * FROM time_off WHERE user_id=?').all(hostId);
}

/**
 * Compute availability.
 * @param et mapped event type
 * @param opts { start: ISO date (inclusive), end: ISO date (inclusive), tz: invitee tz, duration, excludeUid, diagnostics, now }
 */
export function computeSlots(et, opts) {
  const st = settingsOf(et);
  const duration = Number(opts.duration) || et.duration;
  const tz = opts.tz && DateTime.local().setZone(opts.tz).isValid ? opts.tz : 'UTC';
  const now = opts.now ? DateTime.fromISO(opts.now) : DateTime.utc();
  const rangeStart = DateTime.fromISO(opts.start, { zone: tz }).startOf('day');
  const rangeEnd = DateTime.fromISO(opts.end || opts.start, { zone: tz }).endOf('day');
  const step = Math.max(5, Number(st.increment) || duration);
  const before = Number(st.buffer_before) || 0, after = Number(st.buffer_after) || 0;
  const isGroup = et.kind === 'group';
  const hostIds = hostIdsOf(et);
  const owner = scheduleFor(et, et.user_id);
  const ownerZone = owner?.schedule?.timezone || owner?.user?.timezone || 'UTC';

  const padFrom = rangeStart.minus({ days: 2 }).toUTC().toISO();
  const padTo = rangeEnd.plus({ days: 2 }).toUTC().toISO();

  // ---- per host data ----
  const hosts = [];
  for (const hid of hostIds) {
    const sf = scheduleFor(et, hid);
    if (!sf || !sf.schedule) continue;
    const zone = sf.schedule.timezone || sf.user.timezone || 'UTC';
    const bookings = hostBookings(hid, padFrom, padTo, opts.excludeUid);
    // starts of candidate slots within working hours
    const candidates = new Set();
    const dayNotes = {};
    let d = rangeStart.setZone(zone).startOf('day').minus({ days: 1 });
    const last = rangeEnd.setZone(zone).startOf('day').plus({ days: 1 });
    while (d <= last) {
      const date = d.toISODate();
      const { intervals, source, weekday } = intervalsForDate(sf.schedule, date);
      if (!intervals.length) dayNotes[date] = source === 'override' ? 'blackout' : `no_rules:${weekday}`;
      for (const iv of intervals) {
        let s = parseHM(date, iv.start, zone); const e = parseHM(date, iv.end, zone);
        while (s.plus({ minutes: duration }) <= e) {
          if (s >= rangeStart && s <= rangeEnd) candidates.add(s.toUTC().toMillis());
          s = s.plus({ minutes: step });
        }
      }
      d = d.plus({ days: 1 });
    }
    // meeting counts for this event type (round-robin fairness)
    const etCount = db.prepare(`SELECT COUNT(DISTINCT start_utc) c FROM bookings WHERE event_type_id=? AND status='active'
      AND EXISTS (SELECT 1 FROM json_each(bookings.host_ids) WHERE value = ?)`).get(et.id, hid).c;
    hosts.push({
      id: hid, name: sf.user.name, user: sf.user, zone, schedule: sf.schedule, bookings, busy: hostBusy(hid),
      reserved: hostReservations(hid), timeOff: timeOffFor(hid), candidates, dayNotes, etCount,
    });
  }

  // ---- event-level counts (limits / group) ----
  const etBookings = db.prepare(`SELECT start_utc, COUNT(*) n FROM bookings WHERE event_type_id=? AND status='active'
      AND start_utc >= ? AND start_utc < ? AND (? IS NULL OR uid <> ?) GROUP BY start_utc`)
    .all(et.id, rangeStart.minus({ days: 32 }).toUTC().toISO(), rangeEnd.plus({ days: 32 }).toUTC().toISO(), opts.excludeUid ?? null, opts.excludeUid ?? null);
  const groupCount = new Map(etBookings.map((r) => [Date.parse(r.start_utc), r.n]));
  const countInPeriod = (ms, unit) => {
    const dt = DateTime.fromMillis(ms, { zone: ownerZone });
    const a = dt.startOf(unit).toMillis(), b = dt.endOf(unit).toMillis();
    let c = 0; for (const r of etBookings) { const t = Date.parse(r.start_utc); if (t >= a && t <= b) c++; }
    return c;
  };

  // date range (in owner zone)
  const today = now.setZone(ownerZone).startOf('day');
  let lastDay = null, firstDay = null;
  const dr = st.date_range || { type: 'indefinite' };
  if (dr.type === 'rolling') lastDay = today.plus({ days: Math.max(1, Number(dr.days) || 60) - 1 }).endOf('day');
  if (dr.type === 'fixed') {
    if (dr.start) firstDay = DateTime.fromISO(dr.start, { zone: ownerZone }).startOf('day');
    if (dr.end) lastDay = DateTime.fromISO(dr.end, { zone: ownerZone }).endOf('day');
  }
  const minNotice = Number(st.min_notice_minutes) || 0;

  // ---- evaluate ----
  const union = new Set(); for (const h of hosts) for (const c of h.candidates) union.add(c);
  const sorted = [...union].sort((a, b) => a - b);
  const minCount = hosts.length ? Math.min(...hosts.filter((h) => h.candidates.size).map((h) => h.etCount)) : 0;

  const hostReasons = (h, s, e) => {
    const r = [];
    if (!h.candidates.has(s)) { r.push({ code: 'OUTSIDE_HOURS' }); return r; }
    const date = DateTime.fromMillis(s, { zone: h.zone }).toISODate();
    if (h.timeOff.some((t) => date >= t.start_date && date <= t.end_date)) r.push({ code: 'BLOCK_OUT_DATE' });
    for (const b of h.bookings) {
      const bs = Date.parse(b.start_utc), be = Date.parse(b.end_utc);
      if (isGroup && b.event_type_id === et.id && bs === s) continue; // joining an existing group slot
      if (bs < e && be > s) { r.push({ code: b.event_type_id === et.id ? 'EVENT' : 'OVERLAP', detail: b.invitee_name }); continue; }
      const bb = (b.buffer_before || 0) * 60000, ba = (b.buffer_after || 0) * 60000;
      if (bs - bb < e && be + ba > s) { r.push({ code: 'BUFFER', detail: bs >= e ? 'event_before_buffer' : 'event_after_buffer' }); continue; }
      if (bs < e + after * 60000 && be > s - before * 60000) r.push({ code: 'BUFFER', detail: bs >= e ? 'spot_after_buffer' : 'spot_before_buffer' });
    }
    for (const b of h.busy) if (b.s < e + after * 60000 && b.e > s - before * 60000) { r.push({ code: 'CALENDAR', detail: b.title || 'Busy' }); break; }
    for (const b of h.reserved) if (b.s < e && b.e > s) { r.push({ code: 'RESERVED', detail: b.title }); break; }
    const lim = Number(h.user.max_meetings_per_day);
    if (lim > 0) {
      const dd = DateTime.fromMillis(s, { zone: h.zone }); const a = dd.startOf('day').toMillis(), z = dd.endOf('day').toMillis();
      const n = h.bookings.filter((b) => { const t = Date.parse(b.start_utc); return t >= a && t <= z && !(isGroup && b.event_type_id === et.id && t === s); }).length;
      if (n >= lim) r.push({ code: 'USER_EVENT_LIMITS' });
    }
    return r;
  };

  const slots = [];
  for (const s of sorted) {
    const e = s + duration * 60000;
    const reasons = [];
    if (s < now.toMillis()) reasons.push({ code: 'PAST' });
    else if (s < now.toMillis() + minNotice * 60000) reasons.push({ code: 'TOOSOON' });
    const sdt = DateTime.fromMillis(s, { zone: ownerZone });
    if ((lastDay && sdt > lastDay) || (firstDay && sdt < firstDay)) reasons.push({ code: 'RANGE' });
    const taken = groupCount.get(s) || 0;
    const isExistingGroupSlot = isGroup && taken > 0;
    if (!isExistingGroupSlot) {
      if (st.daily_limit && countInPeriod(s, 'day') >= st.daily_limit) reasons.push({ code: 'DAYMAX' });
      if (st.weekly_limit && countInPeriod(s, 'week') >= st.weekly_limit) reasons.push({ code: 'WEEKMAX' });
      if (st.monthly_limit && countInPeriod(s, 'month') >= st.monthly_limit) reasons.push({ code: 'MONTHMAX' });
    }
    let spotsLeft = null;
    if (isGroup) {
      const max = Math.max(1, Number(st.max_invitees) || 1);
      spotsLeft = max - taken;
      if (spotsLeft <= 0) reasons.push({ code: 'GROUP' });
    }
    const perHost = hosts.map((h) => ({ id: h.id, name: h.name, reasons: hostReasons(h, s, e) }));
    let availableHosts = perHost.filter((p) => p.reasons.length === 0).map((p) => p.id);
    if (et.kind === 'collective') {
      if (availableHosts.length !== hosts.length) {
        const blocked = perHost.filter((p) => p.reasons.length);
        if (hosts.length > 1) reasons.push({ code: 'HOSTS', detail: `${blocked.length}/${hosts.length} hosts unavailable` });
        for (const p of blocked) for (const r of p.reasons) reasons.push({ ...r, host: p.name });
        availableHosts = [];
      }
    } else if (et.kind === 'round_robin') {
      if (!availableHosts.length) {
        reasons.push({ code: 'ROUNDROBIN' });
        for (const p of perHost) for (const r of p.reasons) if (r.code !== 'OUTSIDE_HOURS') reasons.push({ ...r, host: p.name });
      } else if (st.rr_strategy === 'equal') {
        const fair = availableHosts.filter((id) => hosts.find((h) => h.id === id).etCount <= minCount);
        if (!fair.length) reasons.push({ code: 'UNFAIR' });
        availableHosts = fair;
      }
    } else {
      for (const r of perHost[0]?.reasons || [{ code: 'OUTSIDE_HOURS' }]) reasons.push(r);
      if (!perHost.length) availableHosts = [];
    }
    const available = reasons.length === 0 && availableHosts.length > 0;
    slots.push({ start: s, available, reasons, availableHosts, spotsLeft });
  }

  // group into invitee-tz days
  const days = {};
  for (const sl of slots) {
    if (!sl.available) continue;
    const key = DateTime.fromMillis(sl.start, { zone: tz }).toISODate();
    (days[key] ||= []).push({ start: new Date(sl.start).toISOString(), ...(isGroup && st.show_spots_left ? { spots_left: sl.spotsLeft } : {}) });
  }
  const result = { timezone: tz, duration, days };
  if (opts.diagnostics) {
    result.diagnostics = slots.map((sl) => ({
      start: new Date(sl.start).toISOString(), available: sl.available, spots_left: sl.spotsLeft,
      reasons: dedupeReasons(sl.reasons).map((r) => ({ ...r, message: REASONS[r.code] || r.code })),
    }));
    // day-level notes in owner zone
    const notes = {};
    const ownerHost = hosts.find((h) => h.id === et.user_id) || hosts[0];
    if (ownerHost) {
      for (const [date, note] of Object.entries(ownerHost.dayNotes)) notes[date] = note;
      for (const t of ownerHost.timeOff) notes[`${t.start_date}..${t.end_date}`] = `time_off:${t.label}`;
    }
    result.day_notes = notes;
    result.owner_timezone = ownerZone;
  }
  result._slots = slots; // internal (stripped by API)
  return result;
}

function dedupeReasons(rs) {
  const seen = new Set(); const out = [];
  for (const r of rs) { const k = `${r.code}|${r.host || ''}|${r.detail || ''}`; if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}

/** Validate a specific start time and choose host(s). Returns { ok, hostIds, reason } */
export function checkAndAssign(et, startISO, duration, excludeUid) {
  const s = DateTime.fromISO(startISO, { zone: 'utc' });
  if (!s.isValid) return { ok: false, reason: 'Invalid start time' };
  const res = computeSlots(et, { start: s.toISODate(), end: s.toISODate(), tz: 'UTC', duration, excludeUid });
  const slot = res._slots.find((x) => x.start === s.toMillis());
  if (!slot) return { ok: false, reason: 'That time is not offered by this event.' };
  if (!slot.available) return { ok: false, reason: REASONS[slot.reasons[0]?.code] || 'That time is no longer available.', code: slot.reasons[0]?.code };
  if (et.kind === 'collective') return { ok: true, hostIds: hostIdsOf(et) };
  if (et.kind === 'round_robin') {
    // pick host with fewest meetings of this event type; tie-break: least recently assigned
    const scored = slot.availableHosts.map((id) => {
      const c = db.prepare(`SELECT COUNT(*) c, MAX(created_at) m FROM bookings WHERE event_type_id=? AND status='active'
        AND EXISTS (SELECT 1 FROM json_each(bookings.host_ids) WHERE value = ?)`).get(et.id, id);
      return { id, c: c.c, m: c.m || '' };
    }).sort((a, b) => a.c - b.c || a.m.localeCompare(b.m));
    return { ok: true, hostIds: [scored[0].id] };
  }
  return { ok: true, hostIds: [et.user_id], spotsLeft: slot.spotsLeft };
}

export function overlapsMs(a1, a2, b1, b2) { return a1 < b2 && a2 > b1; }
export { Interval };
