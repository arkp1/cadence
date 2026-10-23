import React, { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { Avatar, CopyButton } from '../components/ui.jsx';
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
  ['/app/outbox', '✉️', 'Email outbox'],
  ['/app/settings', '⚙️', 'Settings'],
];

export default function AppLayout() {
  const { me, logout } = useAuth();
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
            <Avatar name={u.name} color={u.avatar_color} size={34} />
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
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
