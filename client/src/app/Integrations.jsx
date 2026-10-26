import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import { api, absUrl, ts, isDemo } from '../lib.js';
import { useAuth, useConfig } from '../auth.js';
import { Button, Field, Spinner, useAsync, useToast, Tabs, Toggle, CopyButton, Badge, Empty, Modal, Confirm } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { embedCode } from './ShareModal.jsx';

export default function Integrations() {
  const [tab, setTab] = useState('calendars');
  return (
    <div>
      <div className="page-head"><div><h1>Integrations &amp; apps</h1><p className="muted">Connect calendars, automate with webhooks and the API, and embed Cadence on your website.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'calendars', label: <><Icon name="calendar" size={14} /> Calendars</> },
        { value: 'webhooks', label: <><Icon name="plug" size={14} /> Webhooks</> },
        { value: 'api', label: <><Icon name="lock" size={14} /> API</> },
        { value: 'embed', label: <><Icon name="external" size={14} /> Embed</> },
      ]} />
      {tab === 'calendars' && <Calendars />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'api' && <ApiTokens />}
      {tab === 'embed' && <EmbedBuilder />}
    </div>
  );
}

function Calendars() {
  const { me, refresh } = useAuth();
  const cfg = useConfig();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, loading, reload } = useAsync(() => api('/calendars'), []);
  const [f, setF] = useState({ name: '', url: '' }); const [busy, setBusy] = useState(false);
  const [disc, setDisc] = useState(null);
  useEffect(() => {
    const c = params.get('connected'), e = params.get('error');
    if (c) { toast(`${c === 'google' ? 'Google Calendar' : 'Outlook'} connected`); refresh(); }
    if (e) toast(e, 'err');
    if (c || e) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <Spinner center />;
  const feed = absUrl(me.user.feed_path);
  const writable = data.calendars.filter((c) => c.can_write && c.provider !== 'ics');
  const connect = (p) => {
    if (isDemo()) { toast('Calendar connections are simulated in preview mode'); return; }
    window.location.href = `/api/auth/calendar/${p}`;
  };
  const synced = (c) => (c.last_error ? <span className="red">⚠ {c.last_error}</span> : <span className="muted">{c.check_conflicts ? `${c.busy_count} busy blocks · synced ${c.last_synced_at ? ts(c.last_synced_at).toRelative() : 'pending'}` : 'not checked'}</span>);
  const toggle = async (c, v) => { await api(`/calendars/${c.id}`, { method: 'PATCH', body: { check_conflicts: v } }); if (v) await api(`/calendars/${c.id}/sync`, { method: 'POST' }); reload(); };
  return (
    <div className="stack">
      <div className="card pad stack">
        <div><h3>Calendar connections</h3>
          <p className="small muted">Connected calendars are checked for conflicts, so invitees can only book when you're free. Bookings are written to the calendar you pick below. Busy times refresh automatically, and just before every booking.</p></div>
        <div className="row gap wrap">
          {cfg.features.google_calendar && <Button variant="secondary" onClick={() => connect('google')}><Icon name="calendar" size={15} /> Connect Google Calendar</Button>}
          {cfg.features.microsoft_calendar && <Button variant="secondary" onClick={() => connect('microsoft')}><Icon name="mail" size={15} /> Connect Outlook / Microsoft 365</Button>}
          {!cfg.features.google_calendar && !cfg.features.microsoft_calendar && <span className="small muted">No calendar providers are configured on this server.</span>}
        </div>
        {data.accounts.map((a) => (
          <div key={a.id} className="cal-group">
            <div className="cal-group-head">
              <div className="connect-logo"><Icon name={a.provider === 'google' ? 'calendar' : 'mail'} size={18} /></div>
              <div className="grow"><div className="strong">{a.provider === 'google' ? 'Google Calendar' : 'Outlook'}</div><div className="small muted">{a.email}</div>
                {a.last_error && <div className="small red">⚠ {a.last_error} <button className="link" onClick={() => connect(a.provider)}>Reconnect</button></div>}</div>
              <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/calendar-accounts/${a.id}/refresh`, { method: 'POST' }); reload(); toast('Calendar list refreshed'); } catch (e) { toast(e.message, 'err'); } }}>Refresh list</Button>
              <Button size="sm" variant="danger-outline" onClick={() => setDisc(a)}>Disconnect</Button>
            </div>
            {data.calendars.filter((c) => c.account_id === a.id).map((c) => (
              <div key={c.id} className="cal-row">
                <span className="cal-dot" style={{ background: c.color || '#94a3b8' }} />
                <div className="grow"><div>{c.name} {c.is_primary && <Badge color="gray">primary</Badge>} {!c.can_write && <Badge color="gray">read-only</Badge>}</div><div className="small">{synced(c)}</div></div>
                <Toggle checked={c.check_conflicts} onChange={(v) => toggle(c, v)} label="Check for conflicts" />
              </div>
            ))}
          </div>
        ))}
        {data.accounts.length > 0 && (
          <Field label="Add new bookings to" hint={data.features?.email ? 'Cadence emails the invitee a confirmation with a calendar invite.' : 'Email isn\'t configured, so Google/Outlook will send the invitee the calendar invitation.'}>
            <select value={data.write_calendar_id || ''} onChange={async (e) => { try { await api('/calendars/write-target', { method: 'PUT', body: { calendar_id: e.target.value || null } }); reload(); toast('Saved'); } catch (ex) { toast(ex.message, 'err'); } }}>
              <option value="">Don't add bookings to a calendar</option>
              {writable.map((c) => {
                const email = data.accounts.find((a) => a.id === c.account_id)?.email;
                return <option key={c.id} value={c.id}>{c.name}{email && email !== c.name ? ` (${email})` : ''}</option>;
              })}
            </select>
          </Field>
        )}
      </div>

      <div className="card pad">
        <h3>Other calendars (ICS feed)</h3>
        <p className="small muted">Check conflicts against any calendar that publishes an iCal (ICS) address, such as Apple iCloud, Fastmail or a shared team calendar. These are read-only.</p>
        <div className="row gap wrap">
          <input placeholder="Name (e.g. iCloud)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="grow" placeholder="https://… .ics or webcal://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try { const r = await api('/calendars', { method: 'POST', body: f }); toast(r.sync.ok ? `Connected: ${r.sync.count} busy events imported` : `Added, but sync failed: ${r.sync.error}`, r.sync.ok ? 'ok' : 'err'); setF({ name: '', url: '' }); reload(); } catch (e) { toast(e.message, 'err'); }
            setBusy(false);
          }}>Add</Button>
        </div>
        <div className="cal-list">
          {data.calendars.filter((c) => c.provider === 'ics').map((c) => (
            <div key={c.id} className="cal-item">
              <div><div className="strong">{c.name}</div><div className="small muted ellipsis">{c.url}</div><div className="small">{synced(c)}</div></div>
              <div className="row gap-sm">
                <Toggle checked={c.check_conflicts} onChange={(v) => toggle(c, v)} label="Check conflicts" />
                <Button size="sm" variant="ghost" onClick={async () => { const r = await api(`/calendars/${c.id}/sync`, { method: 'POST' }); toast(r.ok ? `Synced ${r.count} events` : r.error, r.ok ? 'ok' : 'err'); reload(); }}>Sync now</Button>
                <Button size="sm" variant="danger-outline" onClick={async () => { await api(`/calendars/${c.id}`, { method: 'DELETE' }); reload(); }}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card pad">
        <h3>Subscribe to your Cadence bookings</h3>
        <p className="small muted">A private, read-only ICS feed of all your bookings for any calendar app. You won't need it if bookings are already written to a connected calendar.</p>
        <div className="copy-row"><input readOnly value={feed} onFocus={(e) => e.target.select()} /><CopyButton text={feed} size={undefined} /></div>
        <Button size="sm" variant="ghost" className="mt-sm" onClick={async () => { await api('/me/feed-token', { method: 'POST' }); await refresh(); toast('Feed URL rotated. The old URL no longer works.'); }}>Rotate secret URL</Button>
      </div>
      <Confirm open={!!disc} danger title={`Disconnect ${disc?.email}?`} confirmLabel="Disconnect" message="Cadence stops checking these calendars for conflicts and stops adding bookings to them. Events already created stay on your calendar."
        onClose={() => setDisc(null)} onConfirm={async () => { await api(`/calendar-accounts/${disc.id}`, { method: 'DELETE' }); setDisc(null); reload(); refresh(); }} />
    </div>
  );
}

function Webhooks() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api('/webhooks'), []);
  const [f, setF] = useState({ url: '', events: ['invitee.created', 'invitee.canceled'] });
  const [created, setCreated] = useState(null);
  const [logs, setLogs] = useState(null);
  const [del, setDel] = useState(null);
  if (loading) return <Spinner center />;
  return (
    <div className="stack">
      <div className="card pad">
        <h3>Create a webhook subscription</h3>
        <p className="small muted">We POST a JSON payload to your URL. Verify the <code>Cadence-Webhook-Signature</code> header: <code>t=timestamp,v1=HMAC_SHA256(secret, "t.body")</code>.</p>
        <Field label="Endpoint URL"><input placeholder="https://example.com/webhooks/cadence" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <div className="host-pick">{data.events.map((ev) => <label key={ev} className="opt"><input type="checkbox" checked={f.events.includes(ev)} onChange={(e) => setF({ ...f, events: e.target.checked ? [...f.events, ev] : f.events.filter((x) => x !== ev) })} /> <code>{ev}</code></label>)}</div>
        <Button className="mt-sm" onClick={async () => { try { const r = await api('/webhooks', { method: 'POST', body: f }); setCreated(r.webhook); setF({ url: '', events: f.events }); reload(); } catch (e) { toast(e.message, 'err'); } }}>Create webhook</Button>
      </div>
      <div className="card">
        {!data.webhooks.length ? <Empty icon="plug" title="No webhooks" /> : (
          <table className="table"><thead><tr><th>URL</th><th>Events</th><th>Active</th><th></th></tr></thead>
            <tbody>{data.webhooks.map((w) => (
              <tr key={w.id}><td className="ellipsis" style={{ maxWidth: 280 }}>{w.url}</td><td className="small">{w.events.join(', ')}</td>
                <td><Toggle checked={w.active} onChange={async (v) => { await api(`/webhooks/${w.id}`, { method: 'PATCH', body: { active: v } }); reload(); }} /></td>
                <td className="row gap-sm right">
                  <Button size="sm" variant="ghost" onClick={async () => { const r = await api(`/webhooks/${w.id}/test`, { method: 'POST' }); toast(r.status ? `Test delivered: HTTP ${r.status}` : `Failed: ${r.response}`, r.status >= 200 && r.status < 300 ? 'ok' : 'err'); }}>Send test</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { const r = await api(`/webhooks/${w.id}/deliveries`); setLogs(r.deliveries); }}>Deliveries</Button>
                  <Button size="sm" variant="danger-outline" onClick={() => setDel(w)}>Delete</Button></td></tr>
            ))}</tbody></table>
        )}
      </div>
      <Modal open={!!created} onClose={() => setCreated(null)} title="Webhook created">
        <p>Your signing secret (shown again in the API only on creation):</p>
        <div className="copy-row"><input readOnly value={created?.secret || ''} /><CopyButton text={created?.secret || ''} label="Copy" size={undefined} /></div>
      </Modal>
      <Modal open={!!logs} onClose={() => setLogs(null)} title="Recent deliveries" width={720}>
        {!logs?.length ? <p className="muted">No deliveries yet.</p> : <table className="table"><thead><tr><th>Time</th><th>Event</th><th>Status</th><th>Response</th></tr></thead>
          <tbody>{logs.map((d) => <tr key={d.id}><td className="small">{ts(d.created_at).toLocal().toFormat('LLL d, HH:mm:ss')}</td><td><code>{d.event}</code></td><td>{d.status ? <Badge color={d.status < 300 ? 'green' : 'red'}>{d.status}</Badge> : <Badge color="red">ERR</Badge>}</td><td className="small ellipsis" style={{ maxWidth: 260 }}>{d.response}</td></tr>)}</tbody></table>}
      </Modal>
      <Confirm open={!!del} danger title="Delete webhook?" confirmLabel="Delete" onClose={() => setDel(null)} onConfirm={async () => { await api(`/webhooks/${del.id}`, { method: 'DELETE' }); setDel(null); reload(); }} />
    </div>
  );
}

function ApiTokens() {
  const { data, loading, reload } = useAsync(() => api('/tokens'), []);
  const [name, setName] = useState(''); const [tok, setTok] = useState(null);
  if (loading) return <Spinner center />;
  const base = absUrl('/api');
  return (
    <div className="stack">
      <div className="card pad">
        <h3>Personal access tokens</h3>
        <p className="small muted">Use tokens to call the Cadence REST API (every endpoint the dashboard uses). Send <code>Authorization: Bearer &lt;token&gt;</code>.</p>
        <div className="row gap"><input placeholder="Token name (e.g. Zapier)" value={name} onChange={(e) => setName(e.target.value)} /><Button onClick={async () => { const r = await api('/tokens', { method: 'POST', body: { name } }); setTok(r.token); setName(''); reload(); }}>Generate token</Button></div>
        {tok && <div className="alert alert-success mt-sm">Copy your token now — it will not be shown again.<div className="copy-row mt-sm"><input readOnly value={tok} /><CopyButton text={tok} label="Copy" size={undefined} /></div></div>}
        <table className="table mt"><thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th>Created</th><th></th></tr></thead>
          <tbody>{data.tokens.map((t) => <tr key={t.id}><td>{t.name}</td><td><code>{t.prefix}…</code></td><td className="small">{t.last_used_at ? ts(t.last_used_at).toRelative() : 'Never'}</td><td className="small">{ts(t.created_at).toLocal().toFormat('LLL d, yyyy')}</td><td className="right"><Button size="sm" variant="danger-outline" onClick={async () => { await api(`/tokens/${t.id}`, { method: 'DELETE' }); reload(); }}>Revoke</Button></td></tr>)}</tbody></table>
      </div>
      <div className="card pad">
        <h3>API quick reference</h3>
        <pre className="code-block">{`# List upcoming scheduled events
curl -H "Authorization: Bearer $TOKEN" ${base}/bookings?status=upcoming

# Event types (CRUD): GET/POST ${base}/event-types, PATCH/DELETE ${base}/event-types/:id
# Cancel an event
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
     -d '{"reason":"Out sick"}' ${base}/bookings/:uid/cancel

# Public (no auth): available times & booking
GET  ${base}/public/slots/:eventTypeId?start=2026-11-01&end=2026-11-07&tz=Asia/Kolkata
POST ${base}/public/bookings  {"event_type_id":1,"start":"2026-11-02T04:30:00Z","name":"Ada","email":"ada@example.com","timezone":"Asia/Kolkata"}
     (send a Booking-Request-ID header for idempotent retries)

# Other resources: /schedules /time-off /polls /routing-forms /workflows /webhooks /contacts /analytics /bookings.csv`}</pre>
      </div>
    </div>
  );
}

function EmbedBuilder() {
  const { me } = useAuth();
  const { data, loading } = useAsync(() => api('/event-types'), []);
  const [target, setTarget] = useState('profile'); const [kind, setKind] = useState('inline'); const [text, setText] = useState('Schedule time with me'); const [color, setColor] = useState(me.user.brand_color);
  if (loading) return <Spinner center />;
  const et = data.event_types.find((e) => String(e.id) === target);
  const url = absUrl(et ? et.url_path : `/${me.user.slug}`);
  const code = embedCode(kind, url, { text, color });
  return (
    <div className="card pad stack">
      <div className="grid-2">
        <Field label="What to embed"><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="profile">My booking page (all event types)</option>{data.event_types.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        <Field label="Embed type"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="inline">Inline embed</option><option value="popup">Popup widget (floating button)</option><option value="text">Popup text link</option><option value="iframe">Plain iframe</option></select></Field>
      </div>
      {kind !== 'inline' && kind !== 'iframe' && <div className="grid-2"><Field label="Button / link text"><input value={text} onChange={(e) => setText(e.target.value)} /></Field>{kind === 'popup' && <Field label="Button color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>}</div>}
      <Field label="Code"><textarea className="code" rows={8} readOnly value={code} /></Field>
      <div className="row gap"><CopyButton text={code} label="Copy code" variant="primary" size={undefined} /><span className="small muted">The embedded page fires <code>cadence.event_scheduled</code> and <code>cadence.page_height</code> events on the host window.</span></div>
      <div className="small strong">Live preview</div>
      <div className="embed-preview"><iframe title="preview" src={`${url}?embed=1`} /></div>
    </div>
  );
}
