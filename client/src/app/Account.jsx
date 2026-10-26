import React, { useState } from 'react';
import { api, absUrl, ts } from '../lib.js';
import { useAuth } from '../auth.js';
import { Button, Field, Toggle, useToast, TimezoneSelect, Avatar, Badge, Modal, CopyButton, Confirm, useAsync } from '../components/ui.jsx';

export function Team() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', role: 'member' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const [teamName, setTeamName] = useState(me.org?.name || '');
  const canManage = me.user.role === 'owner' || me.user.role === 'admin';
  const isOwner = me.user.role === 'owner';
  const invite = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api('/team/invites', { method: 'POST', body: f });
      await refresh(); setOpen(false);
      toast(r.email_sent ? `Invitation emailed to ${f.email}` : `Invite created. Ask ${f.email} to sign in at ${window.location.host} with Google.`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div>
      <div className="page-head"><div><h1>Team</h1><p className="muted">Members can host round robin and collective events and share one workspace.</p></div>
        {canManage && <Button onClick={() => { setF({ email: '', role: 'member' }); setErr(''); setOpen(true); }}>+ Invite member</Button>}</div>
      {canManage && (
        <div className="card pad row gap wrap mb">
          <Field label="Team name" className="grow"><input value={teamName} onChange={(e) => setTeamName(e.target.value)} /></Field>
          <Button variant="secondary" disabled={teamName === me.org?.name} onClick={async () => { try { await api('/team', { method: 'PATCH', body: { name: teamName } }); await refresh(); toast('Team renamed'); } catch (e) { toast(e.message, 'err'); } }}>Save</Button>
        </div>
      )}
      <div className="card">
        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Time zone</th><th>Booking page</th><th></th></tr></thead>
          <tbody>{me.members.map((m) => (
            <tr key={m.id}>
              <td><div className="row gap-sm"><Avatar name={m.name} color={m.avatar_color} src={m.avatar_url} size={32} /><div><div className="strong">{m.name}{m.id === me.user.id ? ' (you)' : ''}</div><div className="small muted">{m.email}</div></div></div></td>
              <td>{isOwner && m.role !== 'owner'
                ? <select value={m.role} onChange={async (e) => { try { await api(`/team/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }); await refresh(); } catch (ex) { toast(ex.message, 'err'); } }}><option value="member">member</option><option value="admin">admin</option></select>
                : <Badge color={m.role === 'owner' ? 'purple' : m.role === 'admin' ? 'blue' : 'gray'}>{m.role}</Badge>}</td>
              <td className="small">{m.timezone}</td>
              <td><div className="row gap-sm"><a className="link small" href={`/${m.slug}`} target="_blank" rel="noreferrer">/{m.slug}</a><CopyButton text={absUrl(`/${m.slug}`)} label="Copy" /></div></td>
              <td className="right">{canManage && m.id !== me.user.id && m.role !== 'owner' && <Button size="sm" variant="danger-outline" onClick={() => setDel(m)}>Remove</Button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {me.invites?.length > 0 && (
        <div className="card mt">
          <div className="pad"><h3>Pending invitations</h3><p className="small muted">They join automatically the first time they sign in with Google using this email.</p></div>
          <table className="table"><thead><tr><th>Email</th><th>Role</th><th>Invited</th><th></th></tr></thead>
            <tbody>{me.invites.map((i) => (
              <tr key={i.id}><td>{i.email}</td><td><Badge color="gray">{i.role}</Badge></td><td className="small muted">{ts(i.created_at).toRelative()}</td>
                <td className="right">{canManage && <Button size="sm" variant="ghost" onClick={async () => { await api(`/team/invites/${i.id}`, { method: 'DELETE' }); await refresh(); }}>Revoke</Button>}</td></tr>
            ))}</tbody></table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Invite a team member"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={invite}>Send invite</Button></>}>
        <div className="stack">
          <Field label="Email" hint="Must be the Google account they'll sign in with."><input type="email" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && invite()} /></Field>
          <Field label="Role"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">Member: manages their own events</option><option value="admin">Admin: can also invite and remove members</option></select></Field>
          {!me.email && <div className="alert">Email delivery isn't configured, so no invitation email will be sent. Let them know to sign in at <b>{window.location.host}</b>.</div>}
          {err && <div className="alert alert-error">{err}</div>}
        </div>
      </Modal>
      <Confirm open={!!del} danger title={`Remove ${del?.name}?`} confirmLabel="Remove" message="They lose access to this team. Their account, event types and bookings move to a workspace of their own." onClose={() => setDel(null)}
        onConfirm={async () => { try { await api(`/team/members/${del.id}`, { method: 'DELETE' }); await refresh(); } catch (e) { toast(e.message, 'err'); } setDel(null); }} />
    </div>
  );
}

export function Settings() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const u = me.user;
  const [f, setF] = useState({ name: u.name, slug: u.slug, timezone: u.timezone, time_format: u.time_format, welcome: u.welcome || '', phone: u.phone || '',
    max_meetings_per_day: u.max_meetings_per_day || '', brand_color: u.brand_color, avatar_color: u.avatar_color, hide_branding: u.hide_branding });
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const sessions = useAsync(() => api('/me/sessions'), []);
  const save = async () => { setBusy(true); try { await api('/me', { method: 'PATCH', body: f }); await refresh(); toast('Settings saved'); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  return (
    <div>
      <div className="page-head"><div><h1>Settings</h1><p>Profile, locale, branding and active sessions.</p></div><Button onClick={save} loading={busy}>Save changes</Button></div>
      <div className="card pad stack">
        <h3>Profile</h3>
        <div className="row gap"><Avatar name={f.name} color={f.avatar_color} src={u.avatar_url} size={56} />
          <div className="small muted">Signed in with Google as <b>{u.email}</b>.<br />Your photo comes from your Google account.</div></div>
        <div className="grid-2">
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Your Cadence URL" hint={absUrl(`/${f.slug}`)}><div className="prefix-input"><span>{window.location.host}/</span><input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></div></Field>
          <Field label="Phone (for inbound phone-call events)"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Avatar color (when no photo)"><input type="color" value={f.avatar_color} onChange={(e) => setF({ ...f, avatar_color: e.target.value })} /></Field>
        </div>
        <Field label="Welcome message (shown on your booking page)"><textarea rows={3} value={f.welcome} onChange={(e) => setF({ ...f, welcome: e.target.value })} /></Field>
        <h3>Locale &amp; limits</h3>
        <div className="grid-2">
          <Field label="Time zone"><TimezoneSelect value={f.timezone} onChange={(z) => setF({ ...f, timezone: z })} /></Field>
          <Field label="Time format"><select value={f.time_format} onChange={(e) => setF({ ...f, time_format: e.target.value })}><option value="12h">12h (am/pm)</option><option value="24h">24h</option></select></Field>
          <Field label="Max meetings per day (all event types)" hint="Blank = no limit"><input type="number" min="0" value={f.max_meetings_per_day} onChange={(e) => setF({ ...f, max_meetings_per_day: e.target.value })} /></Field>
        </div>
        <h3>Branding</h3>
        <div className="row gap-lg wrap">
          <Field label="Brand color"><input type="color" value={f.brand_color} onChange={(e) => setF({ ...f, brand_color: e.target.value })} /></Field>
          <Toggle checked={f.hide_branding} onChange={(v) => setF({ ...f, hide_branding: v })} label='Hide "powered by Cadence" on booking pages' />
        </div>
      </div>

      <div className="card pad stack mt">
        <h3>Active sessions</h3>
        {sessions.loading ? <p className="muted small">Loading…</p> : (
          <table className="table"><thead><tr><th>Device</th><th>Signed in</th><th>Expires</th></tr></thead>
            <tbody>{(sessions.data?.sessions || []).map((s, i) => <tr key={i}><td className="small ellipsis" style={{ maxWidth: 360 }}>{s.user_agent || 'Unknown device'}</td><td className="small">{ts(s.created_at).toRelative()}</td><td className="small">{ts(s.expires_at).toRelative()}</td></tr>)}</tbody></table>
        )}
        <div><Button variant="secondary" onClick={async () => { await api('/me/sessions/revoke-others', { method: 'POST' }); sessions.reload(); toast('Signed out of all other devices'); }}>Sign out other devices</Button></div>
      </div>

      <div className="card pad stack mt danger-zone">
        <h3>Delete account</h3>
        <p className="small muted">Permanently deletes your account, event types, schedules, workflows and connected calendars. Upcoming bookings are canceled. This can't be undone.</p>
        <div><Button variant="danger-outline" onClick={() => { setConfirmEmail(''); setDelOpen(true); }}>Delete my account…</Button></div>
      </div>
      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete your account?"
        footer={<><Button variant="ghost" onClick={() => setDelOpen(false)}>Cancel</Button><Button variant="danger" disabled={confirmEmail.toLowerCase() !== u.email.toLowerCase()}
          onClick={async () => { try { await api('/me', { method: 'DELETE', body: { confirm: confirmEmail } }); window.location.href = '/'; } catch (e) { toast(e.message, 'err'); } }}>Delete permanently</Button></>}>
        <p>Type <b>{u.email}</b> to confirm.</p>
        <input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={u.email} />
      </Modal>
    </div>
  );
}
