// ---------------------------------------------------------------------------
// Frontend-only preview mode.
//
// This module intercepts API calls *in the browser* and answers them with
// realistic sample data. It never runs on the server and it only activates
// when the URL has ?demo=1 or the visitor clicked "Explore the preview".
// Nothing here can reach production data.
// ---------------------------------------------------------------------------
import { DateTime } from 'luxon';

const DEMO_KEY = 'cadence_demo';

export function isDemo() {
  if (typeof window === 'undefined') return false;
  try {
    const flag = new URLSearchParams(window.location.search).get('demo');
    if (flag === '0') { localStorage.removeItem(DEMO_KEY); return false; }
    if (flag === '1') { localStorage.setItem(DEMO_KEY, '1'); return true; }
    return localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function startDemo(next = '/app') {
  try { localStorage.setItem(DEMO_KEY, '1'); } catch { /* storage may be blocked */ }
  window.location.href = next;
}

export function exitDemo(next = '/') {
  try { localStorage.removeItem(DEMO_KEY); } catch { /* storage may be blocked */ }
  window.location.href = next;
}

// ---------- helpers ----------
const at = (days, hour = 10, minute = 0) => DateTime.now().startOf('day').plus({ days }).set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toISO();
const isoDate = (days) => DateTime.now().startOf('day').plus({ days }).toISODate();
const ago = (minutes) => DateTime.now().minus({ minutes }).toUTC().toISO();

const baseSettings = (extra = {}) => ({
  price_cents: 0,
  currency: 'USD',
  min_notice_minutes: 120,
  increment: 15,
  buffer_before: 0,
  buffer_after: 0,
  daily_limit: null,
  weekly_limit: null,
  monthly_limit: null,
  rr_strategy: 'availability',
  max_invitees: 10,
  show_spots_left: true,
  date_range: { type: 'rolling', days: 60 },
  lock_timezone: false,
  allow_guests: true,
  max_guests: 5,
  confirmation: { type: 'default' },
  allow_invitee_cancel: true,
  allow_invitee_reschedule: true,
  ...extra,
});

const question = (id, label, type = 'text', extra = {}) => ({ id, label, type, required: false, options: [], ...extra });

// ---------- seed data ----------
const state = {
  user: {
    id: 1, name: 'Ada Lovelace', email: 'ada@lovelace.dev', slug: 'ada',
    timezone: 'Asia/Calcutta', time_format: '12h',
    avatar_url: null, avatar_color: '#5b57d1', brand_color: '#5b57d1',
    welcome: 'Pick a time below and let’s find a moment to talk. I usually reply within a day.',
    phone: '+91 98765 43210', max_meetings_per_day: null,
    default_schedule_id: 1, onboarded: true, role: 'owner',
    feed_path: '/feed/demo-feed-token',
    hide_branding: false,
  },
  org: { id: 1, name: 'Analytical Engines' },
  members: [
    { id: 1, name: 'Ada Lovelace', email: 'ada@lovelace.dev', role: 'owner', timezone: 'Asia/Calcutta', slug: 'ada', avatar_color: '#4f46e5', avatar_url: null },
    { id: 2, name: 'Grace Hopper', email: 'grace@lovelace.dev', role: 'admin', timezone: 'America/New_York', slug: 'grace', avatar_color: '#0891b2', avatar_url: null },
    { id: 3, name: 'Alan Turing', email: 'alan@lovelace.dev', role: 'member', timezone: 'Europe/London', slug: 'alan', avatar_color: '#16a34a', avatar_url: null },
  ],
  invites: [
    { id: 1, email: 'katherine@lovelace.dev', role: 'member', created_at: ago(60 * 24 * 2) },
  ],
  eventTypes: [
    {
      id: 1, name: '30 Minute Meeting', slug: '30min',
      description: 'A focused half hour to talk through what you’re working on. Bring questions — I’ll bring a whiteboard.',
      color: '#4f46e5', kind: 'one_on_one', duration: 30, durations: [30],
      locations: [{ type: 'google_meet', label: '', value: '' }],
      questions: [question('q-about', 'What would you like to talk about?', 'textarea')],
      hosts: [1], schedule_id: null, active: true, secret: false, upcoming: 3,
      url_path: '/ada/30min', settings: baseSettings(),
    },
    {
      id: 2, name: 'Product Demo', slug: 'demo',
      description: 'A guided tour of Cadence: booking pages, team routing, reminders and the API.',
      color: '#0891b2', kind: 'group', duration: 45, durations: [30, 45, 60],
      locations: [{ type: 'google_meet', label: '', value: '' }, { type: 'in_person', label: 'Bangalore office', value: '12 Residency Road' }],
      questions: [
        question('q-team', 'How large is your team?', 'select', { options: ['Just me', '2–10', '11–50', '51+'], required: true }),
        question('q-needs', 'What would you like to see?', 'textarea'),
      ],
      hosts: [1], schedule_id: null, active: true, secret: false, upcoming: 2,
      url_path: '/ada/demo', settings: baseSettings({ price_cents: 4900, currency: 'USD', max_invitees: 6 }),
    },
    {
      id: 3, name: 'Team Office Hours', slug: 'office-hours',
      description: 'Rotating office hours with the engineering team. One of us will pick this up.',
      color: '#db2777', kind: 'round_robin', duration: 20, durations: [20],
      locations: [{ type: 'jitsi', label: '', value: '' }],
      questions: [],
      hosts: [1, 2, 3], schedule_id: null, active: true, secret: false, upcoming: 1,
      url_path: '/ada/office-hours', settings: baseSettings({ min_notice_minutes: 60 }),
    },
    {
      id: 4, name: 'Intro Call (secret)', slug: 'intro',
      description: 'A short intro call. This event type is hidden from my profile page.',
      color: '#16a34a', kind: 'one_on_one', duration: 15, durations: [15],
      locations: [{ type: 'phone_outbound', label: 'Phone call', value: '' }],
      questions: [],
      hosts: [1], schedule_id: null, active: false, secret: true, upcoming: 0,
      url_path: '/ada/intro', settings: baseSettings({ min_notice_minutes: 2880 }),
    },
    {
      id: 5, name: 'Coffee Chat', slug: 'coffee',
      description: 'An informal 20 minutes over coffee. Currently paused while I’m travelling.',
      color: '#ca8a04', kind: 'one_on_one', duration: 20, durations: [20],
      locations: [{ type: 'in_person', label: 'Blue Tokai, Indiranagar', value: '' }],
      questions: [],
      hosts: [1], schedule_id: null, active: false, secret: false, upcoming: 0,
      url_path: '/ada/coffee', settings: baseSettings(),
    },
  ],
  schedules: [
    {
      id: 1, name: 'Working hours', timezone: 'Asia/Calcutta', is_default: true,
      rules: {
        mon: [{ start: '09:30', end: '13:00' }, { start: '14:30', end: '18:00' }],
        tue: [{ start: '09:30', end: '13:00' }, { start: '14:30', end: '18:00' }],
        wed: [{ start: '09:30', end: '13:00' }, { start: '14:30', end: '18:00' }],
        thu: [{ start: '09:30', end: '18:00' }],
        fri: [{ start: '09:30', end: '16:00' }],
        sat: [], sun: [],
      },
      overrides: { [isoDate(9)]: [], [isoDate(12)]: [{ start: '11:00', end: '15:00' }] },
    },
    {
      id: 2, name: 'Early calls', timezone: 'Europe/London', is_default: false,
      rules: { mon: [{ start: '07:00', end: '10:00' }], tue: [{ start: '07:00', end: '10:00' }], wed: [{ start: '07:00', end: '10:00' }], thu: [], fri: [], sat: [], sun: [] },
      overrides: {},
    },
  ],
  timeOff: [{ id: 1, label: 'Diwali break', start_date: isoDate(16), end_date: isoDate(18) }],
  bookings: [
    {
      uid: 'demo-bk-1', start_utc: at(1, 10, 30), end_utc: at(1, 11, 0), duration: 30,
      invitee_name: 'Priya Sharma', invitee_email: 'priya@acme.co', invitee_tz: 'Asia/Calcutta',
      guests: ['dev@acme.co'], host_names: ['Ada Lovelace'], host_ids: [1],
      hosts: [{ id: 1, name: 'Ada Lovelace' }], status: 'active', no_show: false, rescheduled_from: null,
      event_type: { id: 1, name: '30 Minute Meeting', color: '#4f46e5', slug: '30min', allow_invitee_cancel: true, allow_invitee_reschedule: true },
      source: 'booking_page', created_at: ago(1500), location: { type: 'google_meet', value: 'https://meet.google.com/demo-abc-def' },
      answers: [{ id: 'q-about', label: 'What would you like to talk about?', value: 'Reviewing the new scheduling flow for our support team.' }],
      routing: null, payment_status: null, price_cents: 0, currency: 'USD',
      cancel_reason: '', canceled_by: '', host_notes: 'Wants a follow-up with the success team.',
      emails: [{ kind: 'invitee_confirmation:1' }, { kind: 'host_confirmation:1' }],
    },
    {
      uid: 'demo-bk-2', start_utc: at(2, 15, 0), end_utc: at(2, 16, 0), duration: 60,
      invitee_name: 'Marcus Chen', invitee_email: 'marcus@northwind.io', invitee_tz: 'America/New_York',
      guests: [], host_names: ['Ada Lovelace'], host_ids: [1],
      hosts: [{ id: 1, name: 'Ada Lovelace' }], status: 'active', no_show: false, rescheduled_from: null,
      event_type: { id: 2, name: 'Product Demo', color: '#0891b2', slug: 'demo', allow_invitee_cancel: true, allow_invitee_reschedule: true },
      source: 'embed', created_at: ago(4000), location: { type: 'google_meet', value: '' },
      answers: [
        { id: 'q-team', label: 'How large is your team?', value: '11–50' },
        { id: 'q-needs', label: 'What would you like to see?', value: 'Team routing and Stripe payments.' },
      ],
      routing: null, payment_status: 'paid', price_cents: 4900, currency: 'USD',
      cancel_reason: '', canceled_by: '', host_notes: '', emails: [{ kind: 'invitee_confirmation:2' }],
    },
    {
      uid: 'demo-bk-3', start_utc: at(3, 11, 0), end_utc: at(3, 11, 20), duration: 20,
      invitee_name: 'Sofia Rossi', invitee_email: 'sofia@studio-rosso.it', invitee_tz: 'Europe/Rome',
      guests: [], host_names: ['Grace Hopper'], host_ids: [2],
      hosts: [{ id: 2, name: 'Grace Hopper' }], status: 'active', no_show: false, rescheduled_from: null,
      event_type: { id: 3, name: 'Team Office Hours', color: '#db2777', slug: 'office-hours', allow_invitee_cancel: true, allow_invitee_reschedule: true },
      source: 'booking_page', created_at: ago(500), location: { type: 'jitsi', value: 'https://meet.jit.si/cadence-demo' },
      answers: [], routing: null, payment_status: null, price_cents: 0, currency: 'USD',
      cancel_reason: '', canceled_by: '', host_notes: '', emails: [],
    },
    {
      uid: 'demo-bk-4', start_utc: at(-3, 9, 0), end_utc: at(-3, 9, 30), duration: 30,
      invitee_name: 'Daniel Okafor', invitee_email: 'daniel@brightlabs.ng', invitee_tz: 'Africa/Lagos',
      guests: [], host_names: ['Ada Lovelace'], host_ids: [1],
      hosts: [{ id: 1, name: 'Ada Lovelace' }], status: 'active', no_show: false, rescheduled_from: null,
      event_type: { id: 1, name: '30 Minute Meeting', color: '#4f46e5', slug: '30min', allow_invitee_cancel: true, allow_invitee_reschedule: true },
      source: 'direct_link', created_at: ago(60 * 24 * 5), location: { type: 'google_meet', value: '' },
      answers: [], routing: null, payment_status: null, price_cents: 0, currency: 'USD',
      cancel_reason: '', canceled_by: '', host_notes: 'Great call — sending the follow-up deck.', emails: [{ kind: 'invitee_confirmation:4' }],
    },
    {
      uid: 'demo-bk-5', start_utc: at(4, 13, 30), end_utc: at(4, 14, 0), duration: 30,
      invitee_name: 'Hannah Lee', invitee_email: 'hannah@orbit.dev', invitee_tz: 'America/Los_Angeles',
      guests: [], host_names: ['Ada Lovelace'], host_ids: [1],
      hosts: [{ id: 1, name: 'Ada Lovelace' }], status: 'canceled', no_show: false, rescheduled_from: null,
      event_type: { id: 1, name: '30 Minute Meeting', color: '#4f46e5', slug: '30min', allow_invitee_cancel: true, allow_invitee_reschedule: true },
      source: 'booking_page', created_at: ago(2000), location: { type: 'google_meet', value: '' },
      answers: [], routing: null, payment_status: null, price_cents: 0, currency: 'USD',
      cancel_reason: 'Something came up on my side.', canceled_by: 'invitee', host_notes: '', emails: [],
    },
    {
      uid: 'demo-bk-6', start_utc: at(6, 16, 0), end_utc: at(6, 16, 30), duration: 30,
      invitee_name: 'Priya Sharma', invitee_email: 'priya@acme.co', invitee_tz: 'Asia/Calcutta',
      guests: [], host_names: ['Ada Lovelace'], host_ids: [1],
      hosts: [{ id: 1, name: 'Ada Lovelace' }], status: 'rescheduled', no_show: false, rescheduled_from: 'demo-bk-0', rescheduled_to: null,
      event_type: { id: 1, name: '30 Minute Meeting', color: '#4f46e5', slug: '30min', allow_invitee_cancel: true, allow_invitee_reschedule: true },
      source: 'booking_page', created_at: ago(3000), location: { type: 'google_meet', value: '' },
      answers: [], routing: null, payment_status: null, price_cents: 0, currency: 'USD',
      cancel_reason: '', canceled_by: '', host_notes: '', emails: [],
    },
  ],
  calendars: {
    accounts: [
      { id: 1, provider: 'google', email: 'ada@lovelace.dev', last_error: null },
    ],
    calendars: [
      { id: 1, account_id: 1, provider: 'google', name: 'ada@lovelace.dev', color: '#4f46e5', is_primary: true, can_write: true, check_conflicts: true, busy_count: 6, last_synced_at: ago(6), last_error: null },
      { id: 2, account_id: 1, provider: 'google', name: 'Analytical Engines — Product', color: '#0891b2', is_primary: false, can_write: true, check_conflicts: true, busy_count: 2, last_synced_at: ago(6), last_error: null },
      { id: 3, account_id: null, provider: 'ics', name: 'iCloud — personal', url: 'webcal://p56-caldav.icloud.example/team.ics', color: '#16a34a', is_primary: false, can_write: false, check_conflicts: true, busy_count: 1, last_synced_at: ago(20), last_error: null },
    ],
    write_calendar_id: 1,
    features: { email: true },
  },
  webhooks: [
    { id: 1, url: 'https://hooks.example.com/cadence', events: ['invitee.created', 'invitee.canceled'], active: true },
  ],
  tokens: [
    { id: 1, name: 'Zapier', prefix: 'cad_a1b2', last_used_at: ago(90), created_at: ago(60 * 24 * 12) },
  ],
  workflows: [
    { id: 1, name: 'Email reminder 1 hour before', trigger: 'before_start', offset_minutes: 60, action: 'email_invitee', event_type_ids: [], active: true, subject: 'Starting soon: {{event_name}}', body: 'Hi {{invitee_first_name}},\n\nJust a reminder that {{event_name}} starts at {{event_time}}.\n\nSee you soon!' },
    { id: 2, name: 'Host summary on booking', trigger: 'booked', offset_minutes: 0, action: 'email_host', event_type_ids: [1, 2], active: true, subject: 'Prep notes: {{invitee_name}}', body: '{{invitee_name}} booked {{event_name}} for {{event_time_host}}.' },
  ],
  routing: [
    {
      id: 1, name: 'Sales qualification', active: true, submissions: 3, path: '/form/demo-sales-form',
      description: 'A couple of quick questions so we can route you to the right person.',
      questions: [
        question('q-size', 'How large is your team?', 'select', { options: ['Just me', '2–10', '11–50', '51+'], required: true }),
        question('q-help', 'What do you need help with?', 'textarea', { required: true }),
      ],
      rules: [
        { name: 'Larger teams', match: 'all', conditions: [{ question_id: 'q-size', op: 'equals', value: '51+' }], action: { type: 'event_type', event_type_id: 2 } },
        { name: 'Everyone else', match: 'any', conditions: [{ question_id: 'q-size', op: 'is_empty', value: '' }], action: { type: 'message', message: 'Thanks! We’ll email you a booking link.' } },
      ],
      fallback: { type: 'message', message: 'Thanks — we’ll be in touch shortly.' },
    },
  ],
  polls: [
    {
      id: 1, title: 'Quarterly planning', description: 'Pick every time that works — we’ll book the slot with the most votes.',
      duration: 60, location: { type: 'jitsi' }, status: 'open', reserve_times: false, path: '/poll/demo-poll-token',
      options: [
        { id: 1, start: at(3, 10, 0) },
        { id: 2, start: at(4, 14, 0) },
        { id: 3, start: at(5, 11, 30) },
      ],
      votes: [
        { id: 1, name: 'Grace Hopper', email: 'grace@lovelace.dev', choices: [1, 2] },
        { id: 2, name: 'Alan Turing', email: 'alan@lovelace.dev', choices: [2] },
      ],
    },
  ],
  outbox: [
    { id: 1, created_at: ago(30), to_email: 'priya@acme.co', subject: 'Confirmed: 30 Minute Meeting with Ada Lovelace', kind: 'invitee_confirmation', delivered: true, error: null, html: '<h2 style="font-family:Inter,sans-serif">You are scheduled</h2><p style="font-family:Inter,sans-serif;color:#475467">A calendar invitation is attached. See you soon!</p>' },
    { id: 2, created_at: ago(90), to_email: 'ada@lovelace.dev', subject: 'New booking: Priya Sharma', kind: 'host_confirmation', delivered: true, error: null, html: '<h2 style="font-family:Inter,sans-serif">New booking</h2><p style="font-family:Inter,sans-serif;color:#475467">Priya Sharma booked a 30 minute meeting.</p>' },
    { id: 3, created_at: ago(1500), to_email: 'daniel@brightlabs.ng', subject: 'Reminder: 30 Minute Meeting in 1 hour', kind: 'workflow_reminder', delivered: true, error: null, html: '<h2 style="font-family:Inter,sans-serif">Starting soon</h2>' },
    { id: 4, created_at: ago(2000), to_email: 'hannah@orbit.dev', subject: 'Canceled: 30 Minute Meeting', kind: 'invitee_cancellation', delivered: true, error: null, html: '<h2 style="font-family:Inter,sans-serif">Event canceled</h2>' },
  ],
};

// ---------- derived views ----------
const me = () => ({
  user: state.user,
  org: state.org,
  members: state.members,
  invites: state.invites,
  pending_invites: [],
  calendar_accounts: state.calendars.accounts.length,
  features: { google_calendar: true, microsoft_calendar: true },
});

const bookingSummary = (b) => ({ ...b });

const publicBooking = (b) => ({
  ...b,
  owner: {
    slug: 'ada', name: state.user.name, avatar_color: state.user.avatar_color, avatar_url: state.user.avatar_url,
    brand_color: state.user.brand_color, hide_branding: state.user.hide_branding, time_format: state.user.time_format,
    timezone: state.user.timezone,
  },
});

const eventTypeForEditor = (et) => ({ ...et, settings: { ...baseSettings(), ...et.settings } });

const publicEvent = (et) => ({
  id: et.id, name: et.name, description: et.description, kind: et.kind,
  duration: et.duration, durations: et.durations, settings: et.settings,
  locations: et.locations, questions: et.questions, active: et.active, secret: et.secret,
  hosts: et.hosts.map((id) => state.members.find((m) => m.id === id)).filter(Boolean).map((m) => ({ id: m.id, name: m.name, avatar_color: m.avatar_color })),
  owner: {
    name: state.user.name, slug: state.user.slug, avatar_color: state.user.avatar_color, avatar_url: state.user.avatar_url,
    brand_color: state.user.brand_color, hide_branding: state.user.hide_branding, timezone: state.user.timezone, time_format: state.user.time_format,
  },
});

const analytics = () => {
  const series = Array.from({ length: 30 }, (_, i) => {
    const d = DateTime.now().startOf('day').minus({ days: 29 - i });
    const created = Math.max(0, Math.round(2 + 2 * Math.sin(i / 2.6) + (i % 6 === 0 ? 2 : 0)));
    return { date: d.toISODate(), created, canceled: i % 8 === 0 ? 1 : 0 };
  });
  const created = series.reduce((a, s) => a + s.created, 0);
  return {
    timezone: state.user.timezone,
    totals: { created, active: Math.max(0, created - 7), canceled: 4, rescheduled: 3, no_shows: 1 },
    series,
    by_event_type: { '30 Minute Meeting': 18, 'Product Demo': 9, 'Team Office Hours': 6, 'Intro Call': 2 },
    by_host: { 'Ada Lovelace': 21, 'Grace Hopper': 9, 'Alan Turing': 5 },
    by_weekday: [
      { day: 'Mon', count: 7 }, { day: 'Tue', count: 9 }, { day: 'Wed', count: 11 },
      { day: 'Thu', count: 8 }, { day: 'Fri', count: 5 }, { day: 'Sat', count: 1 }, { day: 'Sun', count: 0 },
    ],
    by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour >= 9 && hour <= 18 ? Math.round(6 * Math.exp(-((hour - 13) ** 2) / 14)) : 0 })),
    by_source: { booking_page: 20, direct_link: 8, embed: 5, api: 2 },
  };
};

const contacts = () => {
  const seen = new Map();
  for (const b of state.bookings) {
    const c = seen.get(b.invitee_email) || { email: b.invitee_email, name: b.invitee_name, active: 0, canceled: 0, no_shows: 0, timezone: b.invitee_tz, last_meeting: b.start_utc };
    if (b.status === 'active') c.active += 1;
    if (b.status === 'canceled') c.canceled += 1;
    if (b.no_show) c.no_shows += 1;
    if (b.start_utc > c.last_meeting) c.last_meeting = b.start_utc;
    seen.set(b.invitee_email, c);
  }
  return [...seen.values()];
};

function slotsFor(startDate, endDate, tz, duration) {
  const days = {};
  let d = DateTime.fromISO(startDate, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(endDate, { zone: tz }).endOf('day');
  const today = DateTime.now().setZone(tz).startOf('day');
  let guard = 0;
  while (d <= end && guard < 62) {
    guard += 1;
    if (d.weekday <= 5 && d >= today) {
      const list = [];
      for (let hour = 10; hour <= 16; hour += 1) {
        for (const minute of [0, 30]) {
          if (hour === 16 && minute === 30) continue;
          const start = d.set({ hour, minute, second: 0, millisecond: 0 });
          if (start < DateTime.now()) continue;
          const spots = (hour + minute) % 3 === 0 ? 3 : null;
          list.push({ start: start.toUTC().toISO(), end: start.plus({ minutes: duration }).toUTC().toISO(), spots_left: spots });
        }
      }
      if (list.length) days[d.toISODate()] = list;
    }
    d = d.plus({ days: 1 });
  }
  return days;
}

function troubleshoot(date) {
  const diagnostics = [];
  for (let hour = 10; hour <= 16; hour += 1) {
    for (const minute of [0, 30]) {
      if (hour === 16 && minute === 30) continue;
      const start = DateTime.fromISO(date).set({ hour, minute }).toUTC().toISO();
      const blocked = hour === 12 || (hour === 15 && minute === 30);
      diagnostics.push({
        start,
        available: !blocked,
        spots_left: null,
        reasons: blocked
          ? hour === 12
            ? [{ code: 'OUTSIDE_HOURS', message: 'Outside your working hours (lunch break)', detail: 'lunch' }]
            : [{ code: 'CALENDAR', message: 'Busy on Google Calendar', detail: 'Design sync', host: state.user.name }]
          : [],
      });
    }
  }
  return { owner_timezone: state.user.timezone, diagnostics, day_notes: {} };
}

export function demoCsv() {
  const head = 'invitee,email,event,start,duration,status\n';
  return head + state.bookings.map((b) => [b.invitee_name, b.invitee_email, b.event_type.name, b.start_utc, b.duration, b.status].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ---------- request handling ----------
export async function demoApi(path, { method = 'GET', body } = {}) {
  const clean = String(path).replace(/^\/api/, '').split('?')[0];
  const m = method.toUpperCase();
  const id = (re) => { const r = clean.match(re); return r ? Number(r[1]) : null; };

  // auth / profile
  if (clean === '/me' && m === 'GET') return me();
  if (clean === '/me' && m === 'PATCH') { state.user = { ...state.user, ...body }; return { user: state.user }; }
  if (clean === '/me/slug-available') {
    const slug = new URLSearchParams(String(path).split('?')[1] || '').get('slug') || '';
    return { available: !!slug && !['ada', 'admin', 'app', 'api', 'login'].includes(slug) };
  }
  if (clean === '/me/sessions') return { sessions: [{ created_at: ago(120), expires_at: at(28, 12), user_agent: 'Chrome 141 · macOS' }] };
  if (clean === '/me/sessions/revoke-others') return { ok: true };
  if (clean === '/me/feed-token') return { ok: true };
  if (clean === '/auth/logout') return { ok: true };

  // event types
  if (clean === '/event-types' && m === 'GET') {
    return {
      event_types: state.eventTypes.filter((e) => !e.secret || e.active).map((e) => ({ ...e, settings: eventTypeForEditor(e).settings })),
      team_event_types: state.eventTypes.filter((e) => e.kind === 'round_robin' || e.kind === 'collective'),
    };
  }
  if (clean === '/event-types' && m === 'POST') {
    const et = {
      id: 100 + state.eventTypes.length, name: body?.name || 'New event type', slug: 'new-event', description: '',
      color: '#4f46e5', kind: body?.kind || 'one_on_one', duration: 30, durations: [30],
      locations: [{ type: 'google_meet', label: '', value: '' }], questions: [], hosts: [1],
      schedule_id: null, active: true, secret: false, upcoming: 0, url_path: '/ada/new-event',
      settings: baseSettings(),
    };
    state.eventTypes.push(et);
    return { event_type: et };
  }
  if (clean === '/event-types/reorder') return { ok: true };
  if (/^\/event-types\/\d+\/duplicate$/.test(clean)) return { ok: true };
  if (/^\/event-types\/\d+\/links$/.test(clean)) return { link: { path: '/d/demo-single-use' } };
  if (/^\/event-types\/\d+\/troubleshoot$/.test(clean)) {
    const q = new URLSearchParams(String(path).split('?')[1] || '');
    return troubleshoot(q.get('start') || isoDate(0));
  }
  if (/^\/event-types\/\d+$/.test(clean)) {
    const n = id(/^\/event-types\/(\d+)$/);
    const et = state.eventTypes.find((e) => e.id === n);
    if (m === 'GET') return et ? { event_type: eventTypeForEditor(et), payments: true } : Promise.reject(Object.assign(new Error('Event type not found'), { status: 404 }));
    if (m === 'PATCH') {
      if (et) Object.assign(et, body, { settings: { ...et.settings, ...(body?.settings || {}) } });
      return { event_type: et ? eventTypeForEditor(et) : body };
    }
    if (m === 'DELETE') { state.eventTypes = state.eventTypes.filter((e) => e.id !== n); return { ok: true }; }
  }

  // schedules + time off
  if (clean === '/schedules' && m === 'GET') {
    return { schedules: state.schedules, default_schedule_id: 1, time_off: state.timeOff };
  }
  if (clean === '/schedules' && m === 'POST') {
    const s = { id: state.schedules.length + 1, name: body?.name || 'New schedule', timezone: body?.timezone || state.user.timezone, is_default: false, rules: {}, overrides: {} };
    state.schedules.push(s);
    return { schedule: s };
  }
  if (/^\/schedules\/\d+$/.test(clean)) {
    const n = id(/^\/schedules\/(\d+)$/);
    const s = state.schedules.find((x) => x.id === n);
    if (m === 'PATCH') { if (s) Object.assign(s, body); return { ok: true, schedule: s }; }
    if (m === 'DELETE') { state.schedules = state.schedules.filter((x) => x.id !== n); return { ok: true }; }
  }
  if (clean === '/time-off' && m === 'POST') {
    const t = { id: state.timeOff.length + 1, ...body };
    state.timeOff.push(t);
    return { time_off: t };
  }
  if (/^\/time-off\/\d+$/.test(clean) && m === 'DELETE') {
    const n = id(/^\/time-off\/(\d+)$/);
    state.timeOff = state.timeOff.filter((t) => t.id !== n);
    return { ok: true };
  }

  // bookings
  if (clean === '/bookings' && m === 'GET') {
    const q = new URLSearchParams(String(path).split('?')[1] || '');
    const status = q.get('status') || 'upcoming';
    const search = (q.get('q') || '').toLowerCase();
    const nowIso = new Date().toISOString();
    let list = [...state.bookings];
    if (status === 'upcoming') list = list.filter((b) => b.status === 'active' && b.start_utc >= nowIso);
    if (status === 'past') list = list.filter((b) => b.status === 'active' && b.start_utc < nowIso);
    if (status === 'canceled') list = list.filter((b) => b.status === 'canceled' || b.status === 'rescheduled');
    if (search) list = list.filter((b) => `${b.invitee_name} ${b.invitee_email}`.toLowerCase().includes(search));
    return { bookings: list.map(bookingSummary).sort((a, b) => a.start_utc.localeCompare(b.start_utc)) };
  }
  if (/^\/bookings\/[^/]+$/.test(clean) && m === 'GET') {
    const uid = clean.split('/')[2];
    const b = state.bookings.find((x) => x.uid === uid);
    if (!b) return Promise.reject(Object.assign(new Error('Booking not found'), { status: 404 }));
    return { booking: { ...b, hosts: b.hosts.map((h) => ({ ...h, email: state.members.find((mm) => mm.id === h.id)?.email })) } };
  }
  if (/^\/bookings\/[^/]+$/.test(clean) && m === 'PATCH') {
    const uid = clean.split('/')[2];
    const b = state.bookings.find((x) => x.uid === uid);
    if (b) Object.assign(b, body);
    return { booking: b };
  }
  if (/^\/bookings\/[^/]+\/cancel$/.test(clean)) {
    const uid = clean.split('/')[2];
    const b = state.bookings.find((x) => x.uid === uid);
    if (b) { b.status = 'canceled'; b.cancel_reason = body?.reason || ''; b.canceled_by = 'host'; }
    return { booking: b };
  }

  // contacts / analytics / outbox
  if (clean === '/contacts') return { contacts: contacts() };
  if (clean === '/analytics') return analytics();
  if (clean === '/outbox') return { emails: state.outbox.map(({ html, ...e }) => e), email_enabled: true };
  if (/^\/outbox\/\d+$/.test(clean)) {
    const n = id(/^\/outbox\/(\d+)$/);
    return { email: state.outbox.find((e) => e.id === n) || state.outbox[0] };
  }

  // calendars
  if (clean === '/calendars' && m === 'GET') return state.calendars;
  if (clean === '/calendars' && m === 'POST') {
    state.calendars.calendars.push({ id: 90, account_id: null, provider: 'ics', name: body?.name || 'Imported calendar', url: body?.url || '', color: '#f59e0b', can_write: false, check_conflicts: true, busy_count: 2, last_synced_at: ago(1), last_error: null });
    return { sync: { ok: true, count: 2 } };
  }
  if (clean === '/calendars/write-target') { state.calendars.write_calendar_id = body?.calendar_id || null; return { ok: true }; }
  if (/^\/calendars\/\d+$/.test(clean)) {
    const n = id(/^\/calendars\/(\d+)$/);
    const c = state.calendars.calendars.find((x) => x.id === n);
    if (m === 'PATCH') { if (c) Object.assign(c, body); return { ok: true }; }
    if (m === 'DELETE') { state.calendars.calendars = state.calendars.calendars.filter((x) => x.id !== n); return { ok: true }; }
  }
  if (/^\/calendars\/\d+\/sync$/.test(clean)) return { ok: true, count: 4 };
  if (/^\/calendar-accounts\/\d+\/refresh$/.test(clean)) return { ok: true };
  if (/^\/calendar-accounts\/\d+$/.test(clean) && m === 'DELETE') { state.calendars.accounts = []; return { ok: true }; }

  // webhooks
  if (clean === '/webhooks' && m === 'GET') {
    return { webhooks: state.webhooks, events: ['invitee.created', 'invitee.canceled', 'invitee.rescheduled', 'invitee.no_show_marked', 'routing_form_submission.created', 'poll.vote_created'] };
  }
  if (clean === '/webhooks' && m === 'POST') {
    const w = { id: state.webhooks.length + 1, url: body?.url, events: body?.events || [], active: true };
    state.webhooks.push(w);
    return { webhook: { ...w, secret: 'whsec_demo_7f3a9c1e5b2d4a6f' } };
  }
  if (/^\/webhooks\/\d+$/.test(clean)) {
    const n = id(/^\/webhooks\/(\d+)$/);
    if (m === 'DELETE') { state.webhooks = state.webhooks.filter((w) => w.id !== n); return { ok: true }; }
    return { ok: true };
  }
  if (/^\/webhooks\/\d+\/test$/.test(clean)) return { status: 200 };
  if (/^\/webhooks\/\d+\/deliveries$/.test(clean)) {
    return { deliveries: [{ id: 1, created_at: ago(12), event: 'invitee.created', status: 200, response: 'OK' }, { id: 2, created_at: ago(180), event: 'invitee.canceled', status: 500, response: 'Internal Server Error' }] };
  }

  // tokens
  if (clean === '/tokens' && m === 'GET') return { tokens: state.tokens };
  if (clean === '/tokens' && m === 'POST') {
    const t = { id: state.tokens.length + 1, name: body?.name || 'New token', prefix: 'cad_d3m0', last_used_at: null, created_at: ago(0) };
    state.tokens.push(t);
    return { token: 'cad_demo_3f9a2b7c1e8d4f6a' };
  }
  if (/^\/tokens\/\d+$/.test(clean) && m === 'DELETE') { const n = id(/^\/tokens\/(\d+)$/); state.tokens = state.tokens.filter((t) => t.id !== n); return { ok: true }; }

  // workflows
  if (clean === '/workflows' && m === 'GET') return { workflows: state.workflows };
  if (clean === '/workflows' && m === 'POST') {
    const w = { id: state.workflows.length + 1, ...body };
    state.workflows.push(w);
    return { workflow: w };
  }
  if (/^\/workflows\/\d+$/.test(clean)) {
    const n = id(/^\/workflows\/(\d+)$/);
    const w = state.workflows.find((x) => x.id === n);
    if (m === 'PATCH') { if (w) Object.assign(w, body); return { workflow: w }; }
    if (m === 'DELETE') { state.workflows = state.workflows.filter((x) => x.id !== n); return { ok: true }; }
  }

  // polls
  if (clean === '/polls' && m === 'GET') return { polls: state.polls };
  if (clean === '/polls' && m === 'POST') {
    const p = {
      id: state.polls.length + 1, title: body?.title || 'New poll', description: body?.description || '',
      duration: body?.duration || 60, location: body?.location || { type: 'jitsi' }, status: 'open',
      reserve_times: !!body?.reserve_times, path: '/poll/demo-poll-token',
      options: (body?.options || []).map((o, i) => ({ id: i + 1, start: o.start })), votes: [],
    };
    state.polls.push(p);
    return { poll: p };
  }
  if (/^\/polls\/\d+\/close$/.test(clean)) {
    const n = id(/^\/polls\/(\d+)\/close$/);
    const p = state.polls.find((x) => x.id === n);
    if (p) p.status = 'closed';
    return { poll: p };
  }
  if (/^\/polls\/\d+\/book$/.test(clean)) {
    const n = id(/^\/polls\/(\d+)\/book$/);
    const p = state.polls.find((x) => x.id === n);
    if (p) p.status = 'booked';
    return { poll: p, booking: state.bookings[0] };
  }
  if (/^\/polls\/\d+$/.test(clean) && m === 'DELETE') { const n = id(/^\/polls\/(\d+)$/); state.polls = state.polls.filter((p) => p.id !== n); return { ok: true }; }

  // routing forms
  if (clean === '/routing-forms' && m === 'GET') return { forms: state.routing };
  if (clean === '/routing-forms' && m === 'POST') {
    const f = { id: state.routing.length + 1, name: body?.name || 'New routing form', active: true, submissions: 0, path: '/form/demo-form', description: '', questions: [], rules: [], fallback: { type: 'message' } };
    state.routing.push(f);
    return { form: f };
  }
  if (/^\/routing-forms\/\d+\/submissions$/.test(clean)) return { submissions: [] };
  if (/^\/routing-forms\/\d+$/.test(clean)) {
    const n = id(/^\/routing-forms\/(\d+)$/);
    const f = state.routing.find((x) => x.id === n);
    if (m === 'PATCH') { if (f) Object.assign(f, body); return { form: f }; }
    if (m === 'DELETE') { state.routing = state.routing.filter((x) => x.id !== n); return { ok: true }; }
  }

  // team
  if (clean === '/team' && m === 'PATCH') { state.org.name = body?.name || state.org.name; return { org: state.org }; }
  if (clean === '/team/invites' && m === 'POST') {
    state.invites.push({ id: state.invites.length + 1, email: body?.email, role: body?.role || 'member', created_at: ago(0) });
    return { email_sent: false, invite: state.invites[state.invites.length - 1] };
  }
  if (/^\/team\/invites\/\d+$/.test(clean) && m === 'DELETE') { const n = id(/^\/team\/invites\/(\d+)$/); state.invites = state.invites.filter((i) => i.id !== n); return { ok: true }; }
  if (/^\/team\/members\/\d+$/.test(clean)) return { ok: true };
  if (/^\/invites\/\d+\/(accept|decline)$/.test(clean)) return { ok: true };

  // ---------- public (invitee-facing) ----------
  if (/^\/public\/profile\/[^/]+$/.test(clean)) {
    return {
      profile: {
        name: state.user.name, welcome: state.user.welcome, avatar_color: state.user.avatar_color,
        avatar_url: state.user.avatar_url, brand_color: state.user.brand_color, hide_branding: state.user.hide_branding,
      },
      event_types: state.eventTypes.filter((e) => e.active && !e.secret).map((e) => ({
        id: e.id, name: e.name, slug: e.slug, color: e.color, kind: e.kind, duration: e.duration, durations: e.durations,
      })),
    };
  }
  if (/^\/public\/event\/[^/]+\/[^/]+$/.test(clean)) {
    const parts = clean.split('/');
    const eslug = parts[4];
    const et = state.eventTypes.find((e) => e.slug === eslug && e.active);
    if (!et) return Promise.reject(Object.assign(new Error('Not found'), { status: 404 }));
    return { event: publicEvent(et) };
  }
  if (/^\/public\/link\/[^/]+$/.test(clean)) return { event: publicEvent(state.eventTypes[0]) };
  if (/^\/public\/slots\/\d+$/.test(clean)) {
    const q = new URLSearchParams(String(path).split('?')[1] || '');
    return { days: slotsFor(q.get('start') || isoDate(0), q.get('end') || isoDate(30), q.get('tz') || state.user.timezone, Number(q.get('duration') || 30)) };
  }
  if (clean === '/public/bookings' && m === 'POST') {
    const et = state.eventTypes.find((e) => e.id === Number(body?.event_type_id)) || state.eventTypes[0];
    const start = body?.start || at(2, 10);
    const duration = Number(body?.duration) || et.duration;
    const b = {
      uid: `demo-new-${state.bookings.length + 1}`,
      start_utc: start,
      end_utc: DateTime.fromISO(start).plus({ minutes: duration }).toUTC().toISO(),
      duration,
      invitee_name: body?.name || 'Guest',
      invitee_email: body?.email || 'guest@example.com',
      invitee_tz: body?.timezone || state.user.timezone,
      guests: body?.guests || [],
      host_names: [state.user.name],
      host_ids: [1],
      hosts: [{ id: 1, name: state.user.name }],
      status: 'active',
      no_show: false,
      rescheduled_from: null,
      event_type: { id: et.id, name: et.name, color: et.color, slug: et.slug, allow_invitee_cancel: true, allow_invitee_reschedule: true },
      source: 'booking_page',
      created_at: ago(0),
      location: et.locations?.[0] ? { type: et.locations[0].type, value: '' } : null,
      answers: (body?.answers || []).map((a) => ({ id: a.id, label: (et.questions.find((q) => q.id === a.id) || {}).label || a.id, value: a.value })),
      routing: null, payment_status: null, price_cents: et.settings?.price_cents || 0, currency: et.settings?.currency || 'USD',
      cancel_reason: '', canceled_by: '', host_notes: '', emails: [],
    };
    state.bookings.push(b);
    return { booking: b };
  }
  if (/^\/public\/bookings\/[^/]+$/.test(clean) && m === 'GET') {
    const uid = clean.split('/')[3];
    const b = state.bookings.find((x) => x.uid === uid);
    if (!b) return Promise.reject(Object.assign(new Error('Booking not found'), { status: 404 }));
    return { booking: publicBooking(b) };
  }
  if (/^\/public\/bookings\/[^/]+\/cancel$/.test(clean)) {
    const uid = clean.split('/')[3];
    const b = state.bookings.find((x) => x.uid === uid);
    if (b) { b.status = 'canceled'; b.cancel_reason = body?.reason || ''; b.canceled_by = 'invitee'; }
    return { booking: publicBooking(b) };
  }
  if (/^\/public\/polls\/[^/]+$/.test(clean) && m === 'GET') {
    return {
      poll: {
        ...state.polls[0],
        owner: { name: state.user.name, avatar_color: state.user.avatar_color, avatar_url: state.user.avatar_url, time_format: state.user.time_format },
      },
    };
  }
  if (/^\/public\/polls\/[^/]+\/vote$/.test(clean) && m === 'POST') {
    const p = state.polls[0];
    const existing = p.votes.find((v) => v.email === body?.email);
    if (existing) existing.choices = body?.choices || [];
    else p.votes.push({ id: p.votes.length + 1, name: body?.name, email: body?.email, choices: body?.choices || [] });
    return {
      poll: {
        ...p,
        owner: { name: state.user.name, avatar_color: state.user.avatar_color, avatar_url: state.user.avatar_url, time_format: state.user.time_format },
      },
    };
  }
  if (/^\/public\/forms\/[^/]+$/.test(clean) && m === 'GET') {
    const f = state.routing[0];
    return {
      form: {
        name: f.name, description: f.description,
        owner: { name: state.user.name, avatar_color: state.user.avatar_color, avatar_url: state.user.avatar_url, brand_color: state.user.brand_color, hide_branding: state.user.hide_branding },
        questions: f.questions,
      },
    };
  }
  if (/^\/public\/forms\/[^/]+\/submit$/.test(clean) && m === 'POST') {
    return { submission_id: 'demo-submission', result: { type: 'message', message: 'Thanks! Your answers are in — we’ll email you a booking link shortly.' }, prefill: {} };
  }

  // Unknown endpoint: fail loudly in the console so gaps are easy to spot.
  if (m === 'GET') {
    console.warn(`[demo] No sample data for GET ${clean}`);
    return {};
  }
  return { ok: true };
}
