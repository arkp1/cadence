import React, { useState } from 'react';
import { api, absUrl } from '../lib.js';
import { useAuth } from '../auth.js';
import { Button, Field, Toggle, useToast, TimezoneSelect, Avatar, Badge, Modal, CopyButton, Confirm } from '../components/ui.jsx';

export function Team() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [del, setDel] = useState(null);
  const owner = me.user.role === 'owner';
  return (
    <div>
      <div className="page-head"><div><h1>Team</h1><p className="muted">{me.org?.name} · Members can host round robin and collective events.</p></div>
        {owner && <Button onClick={() => { setF({ name: '', email: '', password: '' }); setErr(''); setOpen(true); }}>+ Add member</Button>}</div>
      <div className="card">
        <table className="table">
          <thead><tr><th>Member</th><th>Role</th><th>Time zone</th><th>Booking page</th><th></th></tr></thead>
          <tbody>{me.members.map((m) => (
            <tr key={m.id}>
              <td><div className="row gap-sm"><Avatar name={m.name} color={m.avatar_color} size={32} /><div><div className="strong">{m.name}{m.id === me.user.id ? ' (you)' : ''}</div><div className="small muted">{m.email}</div></div></div></td>
              <td><Badge color={m.role === 'owner' ? 'purple' : 'gray'}>{m.role}</Badge></td><td className="small">{m.timezone}</td>
              <td><div className="row gap-sm"><a className="link small" href={`/${m.slug}`} target="_blank" rel="noreferrer">/{m.slug}</a><CopyButton text={absUrl(`/${m.slug}`)} label="Copy" /></div></td>
              <td className="right">{owner && m.id !== me.user.id && <Button size="sm" variant="danger-outline" onClick={() => setDel(m)}>Remove</Button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a team member"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={async () => { setErr(''); try { await api('/team/members', { method: 'POST', body: f }); await refresh(); setOpen(false); toast('Member added — share their login details'); } catch (e) { setErr(e.message); } }}>Add member</Button></>}>
        <div className="stack">
          <Field label="Full name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Temporary password" hint="They can change it under Settings."><input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          {err && <div className="alert alert-error">{err}</div>}
        </div>
      </Modal>
      <Confirm open={!!del} danger title={`Remove ${del?.name}?`} confirmLabel="Remove" message="Their event types and bookings will be deleted." onClose={() => setDel(null)}
        onConfirm={async () => { await api(`/team/members/${del.id}`, { method: 'DELETE' }); await refresh(); setDel(null); }} />
    </div>
  );
}

export function Settings() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const u = me.user;
  const [f, setF] = useState({ name: u.name, slug: u.slug, email: u.email, timezone: u.timezone, time_format: u.time_format, welcome: u.welcome || '', phone: u.phone || '',
    max_meetings_per_day: u.max_meetings_per_day || '', brand_color: u.brand_color, avatar_color: u.avatar_color, hide_branding: u.hide_branding });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api('/me', { method: 'PATCH', body: f }); await refresh(); toast('Settings saved'); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  return (
    <div>
      <div className="page-head"><div><h1>Settings</h1></div><Button onClick={save} loading={busy}>Save changes</Button></div>
      <div className="card pad stack">
        <h3>Profile</h3>
        <div className="row gap"><Avatar name={f.name} color={f.avatar_color} size={56} /><Field label="Avatar color"><input type="color" value={f.avatar_color} onChange={(e) => setF({ ...f, avatar_color: e.target.value })} /></Field></div>
        <div className="grid-2">
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Your Cadence URL" hint={absUrl(`/${f.slug}`)}><div className="prefix-input"><span>{window.location.host}/</span><input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></div></Field>
          <Field label="Phone (for inbound phone-call events)"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
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
        <h3>Change password</h3>
        <div className="grid-2">
          <Field label="Current password"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password"><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        </div>
        <div><Button variant="secondary" onClick={async () => { try { await api('/me/password', { method: 'POST', body: pw }); setPw({ current: '', next: '' }); toast('Password updated'); } catch (e) { toast(e.message, 'err'); } }}>Update password</Button></div>
      </div>
    </div>
  );
}
