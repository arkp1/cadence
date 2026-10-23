import React, { useState } from 'react';
import { api } from '../lib.js';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { Avatar, CopyButton, Button, useToast } from '../components/ui.jsx';
import { absUrl } from '../lib.js';

const NAV = [
  ['/app', '🗂', 'Event types', true],
  ['/app/scheduled', '📅', 'Scheduled events'],
  ['/app/availability', '⏰', 'Availability'],
  ['/app/polls', '🗳', 'Meeting polls'],
  ['/app/routing', '🧭', 'Routing forms'],
  ['/app/workflows', '⚡', 'Workflows'],
  ['/app/contacts', '👥', 'Contacts'],
  ['/app/analytics', '📊', 'Analytics'],
  ['/app/integrations', '🔌', 'Integrations & apps'],
  ['/app/team', '🏢', 'Team'],
  ['/app/outbox', '✉️', 'Email log'],
  ['/app/settings', '⚙️', 'Settings'],
];

export default function AppLayout() {
  const { me, logout, refresh } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const u = me.user;
  return (
    <div className="app" style={{ '--brand': u.brand_color }}>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link to="/app" className="logo"><span className="logo-mark">≡</span> Cadence</Link>
        <nav onClick={() => setOpen(false)}>
          {NAV.map(([to, icon, label, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><span className="nav-icon">{icon}</span>{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me-card">
            <Avatar name={u.name} color={u.avatar_color} src={u.avatar_url} size={34} />
            <div className="me-info"><div className="strong ellipsis">{u.name}</div><div className="small muted ellipsis">{me.org?.name}</div></div>
          </div>
          <button className="btn btn-ghost btn-sm full" onClick={logout}>Log out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          <div className="topbar-link">
            <span className="muted small">Your booking page:</span>
            <a className="link small" href={`/${u.slug}`} target="_blank" rel="noreferrer">{absUrl(`/${u.slug}`).replace(/^https?:\/\//, '')}</a>
            <CopyButton text={absUrl(`/${u.slug}`)} label="Copy" />
          </div>
        </header>
        <div className="content">
          {(me.pending_invites || []).map((inv) => (
            <div key={inv.id} className="banner banner-info">
              <div className="grow">👋 <b>{inv.invited_by || 'Someone'}</b> invited you to join <b>{inv.org_name}</b> as {inv.role === 'admin' ? 'an admin' : 'a member'}.</div>
              <Button size="sm" onClick={async () => { try { await api(`/invites/${inv.id}/accept`, { method: 'POST' }); await refresh(); toast(`You joined ${inv.org_name}`); } catch (e) { toast(e.message, 'err'); } }}>Accept</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await api(`/invites/${inv.id}/decline`, { method: 'POST' }); await refresh(); }}>Decline</Button>
            </div>
          ))}
          {me.calendar_accounts === 0 && (me.features?.google_calendar || me.features?.microsoft_calendar) && (
            <div className="banner banner-warn"><div className="grow">📆 Connect your calendar so people can't book over your existing meetings.</div><Link className="btn btn-sm btn-primary" to="/app/integrations">Connect calendar</Link></div>
          )}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
