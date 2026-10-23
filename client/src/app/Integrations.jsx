import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { api, absUrl } from '../lib.js';
import { useAuth } from '../auth.js';
import { Button, Field, Spinner, useAsync, useToast, Tabs, Toggle, CopyButton, Badge, Empty, Modal, Confirm } from '../components/ui.jsx';
import { embedCode } from './ShareModal.jsx';

export default function Integrations() {
  const [tab, setTab] = useState('calendars');
  return (
    <div>
      <div className="page-head"><div><h1>Integrations &amp; apps</h1><p className="muted">Connect calendars, automate with webhooks and the API, and embed Cadence on your website.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'calendars', label: '📆 Calendars' }, { value: 'webhooks', label: '🪝 Webhooks' }, { value: 'api', label: '🔑 API' }, { value: 'embed', label: '🧩 Embed' }]} />
      {tab === 'calendars' && <Calendars />}
      {tab === 'webhooks' && <Webhooks />}
      {tab === 'api' && <ApiTokens />}
      {tab === 'embed' && <EmbedBuilder />}
    </div>
  );
}

function Calendars() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api('/calendars'), []);
  const [f, setF] = useState({ name: '', url: '' }); const [busy, setBusy] = useState(false);
  if (loading) return <Spinner center />;
  const feed = absUrl(me.user.feed_path);
  return (
    <div className="stack">
      <div className="card pad">
        <h3>Check for conflicts</h3>
        <p className="small muted">Add the secret iCal (ICS) address of any calendar — Google Calendar (Settings → <i>Secret address in iCal format</i>), Outlook (Publish calendar → ICS), Apple iCloud, Fastmail… Busy events block your Cadence availability. Calendars resync every 10 minutes.</p>
        <div className="row gap wrap">
          <input placeholder="Name (e.g. Work Google)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className="grow" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try { const r = await api('/calendars', { method: 'POST', body: f }); toast(r.sync.ok ? `Connected — ${r.sync.count} busy events imported` : `Added, but sync failed: ${r.sync.error}`, r.sync.ok ? 'ok' : 'err'); setF({ name: '', url: '' }); reload(); } catch (e) { toast(e.message, 'err'); }
            setBusy(false);
          }}>Connect</Button>
        </div>
        <div className="cal-list">
          {data.calendars.map((c) => (
            <div key={c.id} className="cal-item">
              <div><div className="strong">{c.name}</div><div className="small muted ellipsis">{c.url}</div>
                <div className="small">{c.last_error ? <span className="red">⚠ {c.last_error}</span> : <span className="muted">{c.busy_count} busy events · synced {c.last_synced_at ? DateTime.fromSQL(c.last_synced_at, { zone: 'utc' }).toRelative() : 'never'}</span>}</div></div>
              <div className="row gap-sm">
                <Toggle checked={!!c.check_conflicts} onChange={async (v) => { await api(`/calendars/${c.id}`, { method: 'PATCH', body: { check_conflicts: v } }); reload(); }} label="Check conflicts" />
                <Button size="sm" variant="ghost" onClick={async () => { const r = await api(`/calendars/${c.id}/sync`, { method: 'POST' }); toast(r.ok ? `Synced ${r.count} events` : r.error, r.ok ? 'ok' : 'err'); reload(); }}>Sync now</Button>
                <Button size="sm" variant="danger-outline" onClick={async () => { await api(`/calendars/${c.id}`, { method: 'DELETE' }); reload(); }}>Remove</Button>
              </div>
            </div>
          ))}
          {!data.calendars.length && <p className="small muted">No calendars connected.</p>}
        </div>
      </div>
      <div className="card pad">
        <h3>Add Cadence events to your calendar</h3>
        <p className="small muted">Subscribe to this private feed in Google Calendar (<i>Other calendars → From URL</i>), Outlook or Apple Calendar to see every booking automatically.</p>
        <div className="copy-row"><input readOnly value={feed} onFocus={(e) => e.target.select()} /><CopyButton text={feed} size={undefined} /></div>
        <Button size="sm" variant="ghost" className="mt-sm" onClick={async () => { await api('/me/feed-token', { method: 'POST' }); await refresh(); toast('Feed URL rotated — old URL no longer works'); }}>Rotate secret URL</Button>
      </div>
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
        {!data.webhooks.length ? <Empty icon="🪝" title="No webhooks" /> : (
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
          <tbody>{logs.map((d) => <tr key={d.id}><td className="small">{DateTime.fromSQL(d.created_at, { zone: 'utc' }).toLocal().toFormat('LLL d, HH:mm:ss')}</td><td><code>{d.event}</code></td><td>{d.status ? <Badge color={d.status < 300 ? 'green' : 'red'}>{d.status}</Badge> : <Badge color="red">ERR</Badge>}</td><td className="small ellipsis" style={{ maxWidth: 260 }}>{d.response}</td></tr>)}</tbody></table>}
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
          <tbody>{data.tokens.map((t) => <tr key={t.id}><td>{t.name}</td><td><code>{t.prefix}…</code></td><td className="small">{t.last_used_at || 'Never'}</td><td className="small">{t.created_at}</td><td className="right"><Button size="sm" variant="danger-outline" onClick={async () => { await api(`/tokens/${t.id}`, { method: 'DELETE' }); reload(); }}>Revoke</Button></td></tr>)}</tbody></table>
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
