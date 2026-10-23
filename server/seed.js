import { DateTime } from 'luxon';
import { db, S, uid, createUser, DEFAULT_SETTINGS } from './db.js';
import { createBooking } from './bookings.js';

export function seed() {
  const TZ = 'Asia/Kolkata';
  const alex = createUser({ email: 'demo@cadence.app', password: 'demo1234', name: 'Alex Rivera', slug: 'alex', timezone: TZ });
  const org = db.prepare('SELECT org_id FROM users WHERE id=?').get(alex).org_id;
  db.prepare("UPDATE orgs SET name='Rivera Studio' WHERE id=?").run(org);
  db.prepare("UPDATE users SET welcome=?, brand_color='#4f46e5', avatar_color='#4f46e5', phone='+91 98765 43210', max_meetings_per_day=8 WHERE id=?")
    .run('Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.', alex);
  const priya = createUser({ email: 'priya@cadence.app', password: 'demo1234', name: 'Priya Shah', slug: 'priya', timezone: TZ, orgId: org, role: 'member' });
  const sam = createUser({ email: 'sam@cadence.app', password: 'demo1234', name: 'Sam Chen', slug: 'sam', timezone: 'Asia/Singapore', orgId: org, role: 'member' });

  const mk = (o) => {
    const settings = { ...DEFAULT_SETTINGS, min_notice_minutes: 120, ...(o.settings || {}) };
    const info = db.prepare(`INSERT INTO event_types (user_id, kind, name, slug, description, color, durations, duration, locations, settings, questions, hosts, secret, position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(o.user || alex, o.kind || 'one_on_one', o.name, o.slug, o.description || '', o.color, S(o.durations || [o.duration]), o.duration,
      S(o.locations || [{ type: 'jitsi', label: 'Video call' }]), S(settings), S(o.questions || []), S(o.hosts || []), o.secret ? 1 : 0, o.position || 0);
    return info.lastInsertRowid;
  };
  const intro = mk({ name: '30 Minute Meeting', slug: '30min', duration: 30, color: '#4f46e5', position: 1,
    description: 'A quick intro call to get to know each other and see how I can help.',
    locations: [{ type: 'jitsi', label: 'Video call (Jitsi)' }, { type: 'phone_outbound', label: 'I will call you' }],
    questions: [{ id: 'q1', label: 'Please share anything that will help prepare for our meeting.', type: 'textarea', required: false }] });
  const consult = mk({ name: 'Strategy Consultation', slug: 'consultation', duration: 60, durations: [30, 45, 60], color: '#0891b2', position: 2,
    description: 'A deep-dive session on your product roadmap. Choose the length that suits you.',
    locations: [{ type: 'google_meet', label: 'Google Meet', value: 'https://meet.google.com/abc-defg-hij' }, { type: 'in_person', label: 'In person', value: 'WeWork Kondapur, Hyderabad' }],
    settings: { buffer_before: 15, buffer_after: 15, daily_limit: 3, price_cents: 5000, currency: 'USD' },
    questions: [
      { id: 'company', label: 'Company name', type: 'text', required: true },
      { id: 'stage', label: 'What stage is your company at?', type: 'radio', required: true, options: ['Idea', 'Pre-seed / Seed', 'Series A+', 'Enterprise'] },
      { id: 'topics', label: 'Topics you would like to cover', type: 'checkbox', required: false, options: ['Roadmap', 'Pricing', 'Hiring', 'Fundraising'] },
      { id: 'phone', label: 'Phone number', type: 'phone', required: false },
    ] });
  const workshop = mk({ name: 'Product Design Workshop', slug: 'workshop', kind: 'group', duration: 90, color: '#db2777', position: 3,
    description: 'A live group workshop on product design fundamentals. Limited seats!', settings: { max_invitees: 8, increment: 180 } });
  const rr = mk({ name: 'Sales Demo', slug: 'sales-demo', kind: 'round_robin', duration: 45, color: '#ea580c', position: 4, hosts: [alex, priya, sam],
    description: 'Get a personalized demo from the next available member of our team.', settings: { rr_strategy: 'availability' } });
  mk({ name: 'Panel Interview', slug: 'panel-interview', kind: 'collective', duration: 60, color: '#16a34a', position: 5, hosts: [alex, priya],
    description: 'Meet with both Alex and Priya. Only times when everyone is free are shown.' });
  mk({ name: 'VIP Office Hours', slug: 'vip', duration: 20, color: '#7c3aed', position: 6, secret: true,
    description: 'Hidden event — only people with the link can book.', settings: { min_notice_minutes: 0 } });

  // bookings
  const people = [['Maya Patel', 'maya@example.com'], ['Jordan Lee', 'jordan@example.com'], ['Ravi Kumar', 'ravi@example.com'], ['Emma Wilson', 'emma@example.com'],
    ['Liam Brown', 'liam@example.com'], ['Sofia Garcia', 'sofia@example.com'], ['Noah Kim', 'noah@example.com'], ['Aisha Khan', 'aisha@example.com']];
  const at = (dayOffset, hm) => {
    let d = DateTime.now().setZone(TZ).plus({ days: dayOffset }).startOf('day');
    while (d.weekday > 5) d = d.plus({ days: dayOffset >= 0 ? 1 : -1 });
    const [h, m] = hm.split(':').map(Number); return d.set({ hour: h, minute: m }).toUTC().toISO();
  };
  const book = (et, day, hm, i, extra = {}) => {
    const [name, email] = people[i % people.length];
    const { booking } = createBooking({ eventTypeId: et, start: at(day, hm), name, email, tz: i % 3 === 0 ? 'America/New_York' : TZ, skipChecks: true, hostIds: extra.hostIds, duration: extra.duration,
      answers: extra.answers, location: { index: 0 }, source: extra.source });
    const created = DateTime.fromISO(booking.start_utc).minus({ days: 2 + (i % 9) });
    db.prepare('UPDATE bookings SET created_at=? WHERE id=?').run(created.toUTC().toSQL({ includeOffset: false }).slice(0, 19), booking.id);
    return booking;
  };
  book(intro, -9, '10:00', 0); book(intro, -7, '15:00', 1); book(consult, -6, '11:00', 2, { duration: 60, answers: [{ id: 'company', value: 'Acme Labs' }, { id: 'stage', value: 'Series A+' }] });
  book(workshop, -5, '14:00', 3); book(workshop, -5, '14:00', 4); book(intro, -3, '16:30', 5); book(rr, -2, '12:00', 6, { hostIds: [priya] });
  const ns = book(intro, -1, '09:30', 7); db.prepare('UPDATE bookings SET no_show=1 WHERE id=?').run(ns.id);
  book(intro, 1, '11:00', 1, { answers: [{ id: 'q1', value: 'Would love to discuss a partnership.' }] });
  book(consult, 2, '15:00', 2, { duration: 45, answers: [{ id: 'company', value: 'Northwind' }, { id: 'stage', value: 'Pre-seed / Seed' }, { id: 'topics', value: ['Roadmap', 'Pricing'] }] });
  book(workshop, 3, '15:00', 3); book(workshop, 3, '15:00', 5); book(workshop, 3, '15:00', 6);
  book(rr, 2, '10:00', 0, { hostIds: [sam] }); book(rr, 4, '14:00', 4, { hostIds: [alex] });
  const c = book(intro, 5, '12:00', 6);
  db.prepare("UPDATE bookings SET status='canceled', cancel_reason='Conflict came up, will rebook next week.', canceled_by='invitee', canceled_at=datetime('now') WHERE id=?").run(c.id);
  book(intro, 6, '10:30', 4);

  // time off, poll, routing form
  const off = DateTime.now().setZone(TZ).plus({ days: 12 }).toISODate();
  db.prepare("INSERT INTO time_off (user_id, start_date, end_date, label) VALUES (?,?,?, 'Conference')").run(alex, off, off);
  const opt = (d, hm) => ({ id: uid(6), start: at(d, hm) });
  const pollInfo = db.prepare('INSERT INTO polls (token, user_id, title, description, duration, location, options, reserve_times) VALUES (?,?,?,?,?,?,?,1)')
    .run('team-offsite', alex, 'Q4 Planning Offsite Sync', 'Pick every time that works for you.', 60, S({ type: 'jitsi', label: 'Video call' }), S([opt(8, '11:00'), opt(9, '15:00'), opt(10, '10:00')]));
  const opts = JSON.parse(db.prepare('SELECT options FROM polls WHERE id=?').get(pollInfo.lastInsertRowid).options);
  db.prepare('INSERT INTO poll_votes (poll_id, name, email, choices) VALUES (?,?,?,?)').run(pollInfo.lastInsertRowid, 'Priya Shah', 'priya@cadence.app', S([opts[0].id, opts[1].id]));
  db.prepare('INSERT INTO poll_votes (poll_id, name, email, choices) VALUES (?,?,?,?)').run(pollInfo.lastInsertRowid, 'Sam Chen', 'sam@cadence.app', S([opts[1].id]));
  db.prepare('INSERT INTO routing_forms (token, user_id, name, description, questions, rules, fallback) VALUES (?,?,?,?,?,?,?)').run('get-started', alex, 'Get started',
    'Tell us a bit about you and we will route you to the right meeting.',
    S([{ id: 'n', type: 'name', label: 'Full name', required: true }, { id: 'e', type: 'email', label: 'Work email', required: true },
      { id: 'size', type: 'select', label: 'Company size', required: true, options: ['1-10', '11-50', '51-200', '200+'] },
      { id: 'need', type: 'radio', label: 'What do you need?', required: true, options: ['A product demo', 'Strategy advice', 'Just saying hi'] }]),
    S([
      { name: 'Demo for larger teams', match: 'all', conditions: [{ question_id: 'need', op: 'equals', value: 'A product demo' }, { question_id: 'size', op: 'any_of', value: '51-200, 200+' }], action: { type: 'event_type', event_type_id: rr } },
      { name: 'Demo', match: 'all', conditions: [{ question_id: 'need', op: 'equals', value: 'A product demo' }], action: { type: 'event_type', event_type_id: intro } },
      { name: 'Strategy', match: 'all', conditions: [{ question_id: 'need', op: 'equals', value: 'Strategy advice' }], action: { type: 'event_type', event_type_id: consult } },
    ]),
    S({ type: 'message', message: 'Thanks for saying hi! 👋 We will reply by email soon.' }));
  console.log('Seeded demo workspace: demo@cadence.app / demo1234');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) seed();
