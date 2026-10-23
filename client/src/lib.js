import { DateTime } from 'luxon';

const TOKEN_KEY = 'cadence_token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const tok = getToken();
  const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
    method, credentials: 'include',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json(); else data = await res.text();
  if (!res.ok) { const e = new Error((data && data.error) || `Request failed (${res.status})`); e.status = res.status; e.data = data; throw e; }
  return data;
}

export async function download(path, filename) {
  const tok = getToken();
  const res = await fetch(`/api${path}`, { credentials: 'include', headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
  const blob = await res.blob(); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

let _tzs = null;
export function timezones() {
  if (_tzs) return _tzs;
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { list = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']; }
  if (!list.includes('UTC')) list.unshift('UTC');
  _tzs = list.map((z) => { const dt = DateTime.now().setZone(z); return { zone: z, offset: dt.offset, label: `${z.replace(/_/g, ' ')}`, short: dt.toFormat('ZZ') }; })
    .sort((a, b) => a.offset - b.offset || a.zone.localeCompare(b.zone));
  return _tzs;
}

export function fmtTime(iso, zone, format = '12h') {
  const d = DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
  return format === '24h' ? d.toFormat('HH:mm') : d.toFormat('h:mma').toLowerCase();
}
export function fmtRange(startIso, endIso, zone, format = '12h') {
  return `${fmtTime(startIso, zone, format)} – ${fmtTime(endIso, zone, format)}`;
}
export function fmtDate(iso, zone, f = 'cccc, LLLL d, yyyy') { return DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).toFormat(f); }

export const LOCATION_TYPES = {
  jitsi: { label: 'Jitsi video (auto-generated link)', icon: '🎥', needsValue: false },
  zoom: { label: 'Zoom', icon: '📹', needsValue: true, placeholder: 'Your Zoom personal meeting link' },
  google_meet: { label: 'Google Meet', icon: '🟢', needsValue: true, placeholder: 'https://meet.google.com/…' },
  teams: { label: 'Microsoft Teams', icon: '🟣', needsValue: true, placeholder: 'Teams meeting link' },
  in_person: { label: 'In-person meeting', icon: '📍', needsValue: true, placeholder: 'Address' },
  phone_outbound: { label: 'Phone call (I will call invitee)', icon: '📞', needsValue: false },
  phone_inbound: { label: 'Phone call (invitee calls me)', icon: '☎️', needsValue: true, placeholder: 'Your phone number' },
  custom: { label: 'Custom', icon: '🔗', needsValue: true, placeholder: 'Any location or instructions' },
  ask_invitee: { label: 'Ask invitee', icon: '❓', needsValue: false },
};
export function locationLabel(l) {
  if (!l) return '';
  const t = LOCATION_TYPES[l.type];
  return l.label || t?.label || l.type;
}

export const KIND_LABELS = { one_on_one: 'One-on-One', group: 'Group', round_robin: 'Round Robin', collective: 'Collective' };
export const KIND_DESCRIPTIONS = {
  one_on_one: 'One host with one invitee. Good for coffee chats, 1:1 interviews, etc.',
  group: 'One host with a group of invitees. Good for webinars, online classes, etc.',
  round_robin: 'Rotating hosts with one invitee. Good for distributing meetings across a team.',
  collective: 'Multiple hosts with one invitee. Good for panel interviews, group sales calls, etc.',
};
export const fmtMoney = (cents, cur = 'USD') => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${cur}`; } };
export const durLabel = (m) => (m % 60 === 0 && m >= 60 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`);
export const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const absUrl = (p) => `${window.location.origin}${p}`;
export function copy(text) { try { navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } }
export const isEmbed = () => new URLSearchParams(window.location.search).get('embed') === '1';
export function postToParent(event, payload) { try { if (window.parent !== window) window.parent.postMessage({ event, payload }, '*'); } catch { /* ignore */ } }
export function googleCalUrl(b, title) {
  const f = (iso) => DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(b.start_utc)}/${f(b.end_utc)}`, details: `Reschedule: ${absUrl(`/reschedule/${b.uid}`)}\nCancel: ${absUrl(`/cancel/${b.uid}`)}`, location: b.location?.value || '' });
  return `https://calendar.google.com/calendar/render?${p}`;
}
export function outlookUrl(b, title) {
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: title, startdt: b.start_utc, enddt: b.end_utc, body: `Reschedule: ${absUrl(`/reschedule/${b.uid}`)}`, location: b.location?.value || '' });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}
