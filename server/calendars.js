// External calendars: Google Calendar + Microsoft Outlook (OAuth) and read-only ICS feeds.
// - keeps a cached copy of busy blocks per calendar (refreshed on demand before computing slots)
// - writes bookings into the host's chosen calendar (auto-creating Google Meet / Teams links)
import { DateTime } from 'luxon';
import { db, J, S, uid } from './db.js';
import { config, features, BASE_URL } from './config.js';
import { encrypt, decrypt, assertPublicUrl } from './security.js';

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GCAL = 'https://www.googleapis.com/calendar/v3';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const msTokenUrl = () => `https://login.microsoftonline.com/${config.microsoft.tenant}/oauth2/v2.0/token`;
export const MS_SCOPES = 'offline_access openid email profile User.Read Calendars.ReadWrite';
export const GOOGLE_CAL_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly';
const SYNC_DAYS = 120;
/** When Cadence has no email provider, calendar providers deliver invites/cancellations to invitees instead. */
const providerSends = () => !features().email;

export async function http(url, opts = {}, timeout = 10000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
    if (!r.ok) {
      const msg = data.error_description || data.error?.message || (typeof data.error === 'string' ? data.error : '') || `HTTP ${r.status}`;
      throw Object.assign(new Error(msg), { status: r.status, data });
    }
    return data;
  } finally { clearTimeout(t); }
}
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });

export async function exchangeCode(provider, code, redirectUri) {
  if (provider === 'google') {
    return http(GOOGLE_TOKEN, form({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }));
  }
  return http(msTokenUrl(), form({ code, client_id: config.microsoft.clientId, client_secret: config.microsoft.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', scope: MS_SCOPES }));
}

async function accessToken(account) {
  if (account.expires_at && Number(account.expires_at) > Date.now() + 60000) return decrypt(account.access_token);
  const refresh = decrypt(account.refresh_token);
  if (!refresh) throw new Error('Connection expired — please reconnect this calendar.');
  try {
    const t = account.provider === 'google'
      ? await http(GOOGLE_TOKEN, form({ client_id: config.google.clientId, client_secret: config.google.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }))
      : await http(msTokenUrl(), form({ client_id: config.microsoft.clientId, client_secret: config.microsoft.clientSecret, refresh_token: refresh, grant_type: 'refresh_token', scope: MS_SCOPES }));
    const exp = Date.now() + (Number(t.expires_in) || 3600) * 1000;
    await db.prepare('UPDATE calendar_accounts SET access_token=?, expires_at=?, refresh_token=COALESCE(?, refresh_token), last_error=NULL WHERE id=?')
      .run(encrypt(t.access_token), exp, t.refresh_token ? encrypt(t.refresh_token) : null, account.id);
    account.expires_at = exp; account.access_token = encrypt(t.access_token);
    return t.access_token;
  } catch (e) {
    const msg = /invalid_grant|AADSTS70008|AADSTS700082|revoked/i.test(e.message) ? 'Access was revoked or expired — please reconnect.' : e.message;
    await db.prepare('UPDATE calendar_accounts SET last_error=? WHERE id=?').run(String(msg).slice(0, 200), account.id);
    throw new Error(msg);
  }
}
async function api(account, url, opts = {}) {
  const tok = await accessToken(account);
  return http(url, { ...opts, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

/** Store (or update) a connected account after OAuth, then import its calendar list. */
export async function saveAccount(userId, provider, tokens, email) {
  const exp = Date.now() + (Number(tokens.expires_in) || 3600) * 1000;
  const row = await db.prepare(`INSERT INTO calendar_accounts (user_id, provider, email, access_token, refresh_token, expires_at, scope)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT (user_id, provider, email) DO UPDATE SET access_token=EXCLUDED.access_token,
      refresh_token=COALESCE(EXCLUDED.refresh_token, calendar_accounts.refresh_token), expires_at=EXCLUDED.expires_at, scope=EXCLUDED.scope, last_error=NULL
    RETURNING *`).get(userId, provider, email, encrypt(tokens.access_token), tokens.refresh_token ? encrypt(tokens.refresh_token) : null, exp, tokens.scope || '');
  await refreshCalendarList(row);
  await syncAccount(row).catch(() => {});
  return row;
}

export async function refreshCalendarList(account) {
  let list = [];
  if (account.provider === 'google') {
    const r = await api(account, `${GCAL}/users/me/calendarList?minAccessRole=freeBusyReader&maxResults=250`);
    list = (r.items || []).filter((c) => !c.deleted).map((c) => ({ external_id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, is_primary: !!c.primary, can_write: ['owner', 'writer'].includes(c.accessRole) }));
  } else {
    const r = await api(account, `${GRAPH}/me/calendars?$select=id,name,canEdit,isDefaultCalendar,hexColor&$top=100`);
    list = (r.value || []).map((c) => ({ external_id: c.id, name: c.name, color: c.hexColor || null, is_primary: !!c.isDefaultCalendar, can_write: !!c.canEdit }));
  }
  const existing = await db.prepare('SELECT * FROM calendars WHERE account_id=?').all(account.id);
  const seen = new Set();
  for (const c of list) {
    seen.add(c.external_id);
    const ex = existing.find((e) => e.external_id === c.external_id);
    if (ex) await db.prepare('UPDATE calendars SET name=?, color=?, is_primary=?, can_write=? WHERE id=?').run(c.name, c.color, c.is_primary ? 1 : 0, c.can_write ? 1 : 0, ex.id);
    else await db.prepare('INSERT INTO calendars (user_id, account_id, provider, external_id, name, color, is_primary, can_write, check_conflicts) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(account.user_id, account.id, account.provider, c.external_id, c.name, c.color, c.is_primary ? 1 : 0, c.can_write ? 1 : 0, c.is_primary ? 1 : 0);
  }
  for (const e of existing) if (!seen.has(e.external_id)) await db.prepare('DELETE FROM calendars WHERE id=?').run(e.id);
  // default "add bookings to" calendar
  const user = await db.prepare('SELECT write_calendar_id FROM users WHERE id=?').get(account.user_id);
  const valid = user?.write_calendar_id && await db.prepare('SELECT 1 FROM calendars WHERE id=? AND can_write=1').get(user.write_calendar_id);
  if (!valid) {
    const prim = await db.prepare('SELECT id FROM calendars WHERE account_id=? AND is_primary=1 AND can_write=1').get(account.id);
    if (prim) await db.prepare('UPDATE users SET write_calendar_id=? WHERE id=?').run(prim.id, account.user_id);
  }
}

// ---------------- busy times ----------------
async function syncAccount(account, onlyIds = null) {
  let cals = await db.prepare('SELECT * FROM calendars WHERE account_id=? AND check_conflicts=1').all(account.id);
  if (onlyIds) cals = cals.filter((c) => onlyIds.includes(c.id));
  if (!cals.length) return;
  const from = DateTime.utc().minus({ days: 1 }).startOf('hour');
  const busyById = Object.fromEntries(cals.map((c) => [c.id, []]));
  try {
    if (account.provider === 'google') {
      for (let w = 0; w < SYNC_DAYS; w += 40) {
        const a = from.plus({ days: w }), b = from.plus({ days: Math.min(SYNC_DAYS, w + 40) });
        const r = await api(account, `${GCAL}/freeBusy`, { method: 'POST', body: JSON.stringify({ timeMin: a.toISO(), timeMax: b.toISO(), items: cals.slice(0, 50).map((c) => ({ id: c.external_id })) }) });
        for (const c of cals) for (const x of r.calendars?.[c.external_id]?.busy || []) busyById[c.id].push({ start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString() });
      }
    } else {
      const to = from.plus({ days: SYNC_DAYS });
      for (const c of cals) {
        let url = `${GRAPH}/me/calendars/${encodeURIComponent(c.external_id)}/calendarView?startDateTime=${from.toISO()}&endDateTime=${to.toISO()}&$select=start,end,showAs,isCancelled&$top=250`;
        for (let page = 0; url && page < 20; page++) {
          const r = await api(account, url, { headers: { Prefer: 'outlook.timezone="UTC"' } });
          for (const e of r.value || []) {
            if (e.isCancelled || e.showAs === 'free') continue;
            busyById[c.id].push({ start: new Date(`${e.start.dateTime.replace(/\.\d+$/, '')}Z`).toISOString(), end: new Date(`${e.end.dateTime.replace(/\.\d+$/, '')}Z`).toISOString() });
          }
          url = r['@odata.nextLink'];
        }
      }
    }
    for (const c of cals) await db.prepare('UPDATE calendars SET busy=?, last_synced_at=now_iso(), last_error=NULL WHERE id=?').run(S(busyById[c.id]), c.id);
  } catch (e) {
    for (const c of cals) await db.prepare('UPDATE calendars SET last_error=?, last_synced_at=now_iso() WHERE id=?').run(String(e.message).slice(0, 200), c.id);
    throw e;
  }
}

export async function syncIcs(cal) {
  try {
    const url = await assertPublicUrl(String(cal.url).replace(/^webcal:\/\//, 'https://'));
    const ical = (await import('node-ical')).default;
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' }); clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 15_000_000) throw new Error('Calendar file is too large');
    const data = ical.sync.parseICS(text);
    const from = DateTime.utc().minus({ days: 1 }), to = DateTime.utc().plus({ days: 180 });
    const busy = [];
    for (const ev of Object.values(data)) {
      if (ev.type !== 'VEVENT' || !ev.start) continue;
      if (ev.transparency === 'TRANSPARENT' || ev.status === 'CANCELLED') continue;
      const dur = (ev.end ? +ev.end : +ev.start + 3600000) - +ev.start;
      const push = (s) => { const e = new Date(+s + dur); if (e > from.toJSDate() && s < to.toJSDate()) busy.push({ start: new Date(s).toISOString(), end: e.toISOString() }); };
      if (ev.rrule) {
        const ex = new Set(Object.values(ev.exdate || {}).map((d) => +new Date(d)));
        for (const s of ev.rrule.between(from.toJSDate(), to.toJSDate(), true)) if (!ex.has(+s)) push(s);
      } else push(ev.start);
      if (busy.length > 5000) break;
    }
    await db.prepare('UPDATE calendars SET busy=?, last_synced_at=now_iso(), last_error=NULL WHERE id=?').run(S(busy), cal.id);
    return { ok: true, count: busy.length };
  } catch (e) {
    await db.prepare('UPDATE calendars SET last_error=?, last_synced_at=now_iso() WHERE id=?').run(String(e.message).slice(0, 200), cal.id);
    return { ok: false, error: e.message };
  }
}

/** Sync one calendar row (any provider). */
export async function syncCalendar(cal) {
  if (cal.provider === 'ics') return syncIcs(cal);
  const acct = await db.prepare('SELECT * FROM calendar_accounts WHERE id=?').get(cal.account_id);
  if (!acct) return { ok: false, error: 'Account missing' };
  try { await syncAccount(acct, [cal.id]); const r = await db.prepare('SELECT busy FROM calendars WHERE id=?').get(cal.id); return { ok: true, count: J(r.busy, []).length }; } catch (e) { return { ok: false, error: e.message }; }
}

/** Refresh stale busy data for these users (bounded by timeoutMs so booking pages stay fast). */
export async function ensureFreshBusy(userIds, maxAgeMs = 120000, timeoutMs = 4500) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) return;
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const stale = await db.prepare(`SELECT * FROM calendars WHERE user_id = ANY(?::int[]) AND check_conflicts=1 AND (last_synced_at IS NULL OR last_synced_at < ?)`).all(ids, cutoff);
  if (!stale.length) return;
  const byAcct = new Map(); const ics = [];
  for (const c of stale) { if (c.provider === 'ics') ics.push(c); else (byAcct.get(c.account_id) || byAcct.set(c.account_id, []).get(c.account_id)).push(c.id); }
  const tasks = [...ics.map((c) => syncIcs(c))];
  for (const [aid, calIds] of byAcct) tasks.push(db.prepare('SELECT * FROM calendar_accounts WHERE id=?').get(aid).then((a) => a && syncAccount(a, calIds)));
  await Promise.race([Promise.allSettled(tasks), new Promise((r) => setTimeout(r, timeoutMs))]);
}

/** Background refresh of everything that is getting old (cron). */
export async function syncStaleCalendars(maxAgeMs = 15 * 60000, limit = 50) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const users = await db.prepare(`SELECT DISTINCT user_id FROM calendars WHERE check_conflicts=1 AND (last_synced_at IS NULL OR last_synced_at < ?) LIMIT ?`).all(cutoff, limit);
  await ensureFreshBusy(users.map((u) => u.user_id), maxAgeMs, 25000);
}

// ---------------- writing bookings to calendars ----------------
async function bookingTitle(b) {
  if (b.event_type_id) { const et = await db.prepare('SELECT name FROM event_types WHERE id=?').get(b.event_type_id); if (et) return et.name; }
  if (b.poll_id) { const p = await db.prepare('SELECT title FROM polls WHERE id=?').get(b.poll_id); if (p) return p.title; }
  return 'Meeting';
}

/**
 * Create calendar events for every host that has an "add to calendar" target.
 * Returns the booking with updated location (auto video links) and external_events.
 */
export async function createExternalEvents(b) {
  const title = await bookingTitle(b);
  const hostIds = b.host_ids?.length ? b.host_ids : [b.owner_id];
  const created = [];
  let location = { ...(b.location || {}) };
  const answers = (b.answers || []).map((a) => `${a.label}: ${Array.isArray(a.value) ? a.value.join(', ') : a.value}`).join('\n');
  for (let i = 0; i < hostIds.length; i++) {
    try {
      const user = await db.prepare('SELECT id, name, email, write_calendar_id FROM users WHERE id=?').get(hostIds[i]);
      if (!user?.write_calendar_id) continue;
      const cal = await db.prepare('SELECT * FROM calendars WHERE id=? AND can_write=1').get(user.write_calendar_id);
      if (!cal || cal.provider === 'ics') continue;
      const acct = await db.prepare('SELECT * FROM calendar_accounts WHERE id=?').get(cal.account_id);
      if (!acct) continue;
      const wantMeet = location.type === 'google_meet' && !location.value && cal.provider === 'google';
      const wantTeams = location.type === 'teams' && !location.value && cal.provider === 'microsoft';
      const where = [location.type === 'in_person' ? location.value : '', location.value].find(Boolean) || '';
      const desc = [`Invitee: ${b.invitee_name} <${b.invitee_email}>`, b.guests?.length ? `Guests: ${b.guests.join(', ')}` : '', where ? `Location: ${where}` : '',
        answers ? `\n${answers}` : '', `\nManage this event in Cadence: ${BASE_URL()}/app/scheduled`, `Invitee can reschedule: ${BASE_URL()}/reschedule/${b.uid}`].filter(Boolean).join('\n');
      const summary = `${title}: ${b.invitee_name}`;
      if (cal.provider === 'google') {
        const body = {
          summary, description: desc, location: where || undefined,
          start: { dateTime: b.start_utc, timeZone: 'UTC' }, end: { dateTime: b.end_utc, timeZone: 'UTC' },
          attendees: [{ email: b.invitee_email, displayName: b.invitee_name }, ...(b.guests || []).map((g) => ({ email: g }))],
          reminders: { useDefault: true }, extendedProperties: { private: { cadence_uid: b.uid } },
          ...(wantMeet ? { conferenceData: { createRequest: { requestId: uid(16), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
        };
        // If Cadence can't send email itself, let Google email the invitation to the invitee.
        const ev = await api(acct, `${GCAL}/calendars/${encodeURIComponent(cal.external_id)}/events?conferenceDataVersion=1&sendUpdates=${providerSends() ? 'all' : 'none'}`, { method: 'POST', body: JSON.stringify(body) });
        created.push({ user_id: user.id, calendar_id: cal.id, provider: 'google', event_id: ev.id });
        const link = ev.hangoutLink || ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
        if (wantMeet && link) location = { ...location, value: link, auto: true };
      } else {
        const body = {
          subject: summary, body: { contentType: 'text', content: desc },
          start: { dateTime: b.start_utc.replace('Z', ''), timeZone: 'UTC' }, end: { dateTime: b.end_utc.replace('Z', ''), timeZone: 'UTC' },
          location: where ? { displayName: where } : undefined, showAs: 'busy', transactionId: `${b.uid}-${user.id}`,
          // Without Cadence email, add attendees so Outlook sends the invitation.
          ...(providerSends() ? { attendees: [{ emailAddress: { address: b.invitee_email, name: b.invitee_name }, type: 'required' }, ...(b.guests || []).map((g) => ({ emailAddress: { address: g }, type: 'optional' }))] } : {}),
          ...(wantTeams ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
        };
        const ev = await api(acct, `${GRAPH}/me/calendars/${encodeURIComponent(cal.external_id)}/events`, { method: 'POST', body: JSON.stringify(body) });
        created.push({ user_id: user.id, calendar_id: cal.id, provider: 'microsoft', event_id: ev.id });
        const link = ev.onlineMeeting?.joinUrl;
        if (wantTeams && link) location = { ...location, value: link, auto: true };
      }
    } catch (e) {
      console.error('calendar write failed', hostIds[i], e.message);
    }
  }
  if (created.length || location.value !== b.location?.value) {
    await db.prepare('UPDATE bookings SET external_events=?, location=? WHERE id=?').run(S([...(b.external_events || []), ...created]), S(location), b.id);
  }
  return { ...b, location, external_events: [...(b.external_events || []), ...created] };
}

export async function deleteExternalEvents(b) {
  for (const x of b.external_events || []) {
    try {
      const cal = await db.prepare('SELECT * FROM calendars WHERE id=?').get(x.calendar_id);
      if (!cal) continue;
      const acct = await db.prepare('SELECT * FROM calendar_accounts WHERE id=?').get(cal.account_id);
      if (!acct) continue;
      if (x.provider === 'google') await api(acct, `${GCAL}/calendars/${encodeURIComponent(cal.external_id)}/events/${encodeURIComponent(x.event_id)}?sendUpdates=${providerSends() ? 'all' : 'none'}`, { method: 'DELETE' });
      else await api(acct, `${GRAPH}/me/events/${encodeURIComponent(x.event_id)}`, { method: 'DELETE' });
    } catch (e) {
      if (![404, 410].includes(e.status)) console.error('calendar delete failed', e.message);
    }
  }
}
