import React, { useEffect, useState } from 'react';
import { api, absUrl, isDemo, exitDemo } from '../lib.js';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { Avatar, CopyButton, Button, useToast } from '../components/ui.jsx';
import { Icon, Logo } from '../components/icons.jsx';

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/app', end: true, icon: 'grid', label: 'Event types' },
      { to: '/app/scheduled', icon: 'calendar', label: 'Scheduled' },
      { to: '/app/availability', icon: 'clock', label: 'Availability' },
    ],
  },
  {
    label: 'Engage',
    items: [
      { to: '/app/polls', icon: 'poll', label: 'Meeting polls' },
      { to: '/app/routing', icon: 'route', label: 'Routing forms' },
      { to: '/app/workflows', icon: 'bolt', label: 'Workflows' },
      { to: '/app/contacts', icon: 'users', label: 'Contacts' },
    ],
  },
  {
    label: 'Insights',
    items: [{ to: '/app/analytics', icon: 'chart', label: 'Analytics' }],
  },
  {
    label: 'Account',
    items: [
      { to: '/app/integrations', icon: 'plug', label: 'Integrations' },
      { to: '/app/team', icon: 'building', label: 'Team' },
      { to: '/app/outbox', icon: 'mail', label: 'Email log' },
      { to: '/app/settings', icon: 'settings', label: 'Settings' },
    ],
  },
];

const PAGE_TITLES = {
  '/app': 'Event types',
  '/app/scheduled': 'Scheduled events',
  '/app/availability': 'Availability',
  '/app/polls': 'Meeting polls',
  '/app/routing': 'Routing forms',
  '/app/workflows': 'Workflows',
  '/app/contacts': 'Contacts',
  '/app/analytics': 'Analytics',
  '/app/integrations': 'Integrations & apps',
  '/app/team': 'Team',
  '/app/outbox': 'Email log',
  '/app/settings': 'Settings',
};

function pageTitle(pathname) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/app/event-types/')) return 'Event type';
  return 'Workspace';
}

export default function AppLayout() {
  const { me, logout, refresh } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const u = me.user;
  const demo = isDemo();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" style={{ '--brand': u.brand_color }}>
      {open && <div className="drawer-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Sidebar">
        <div className="sidebar-brand">
          <Link to="/app" className="logo" aria-label="Cadence home"><Logo /></Link>
          <button type="button" className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <Icon name="x" size={18} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon"><Icon name={item.icon} size={17} /></span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="link-card">
            <div className="link-card-label"><Icon name="link" size={12} /> Your booking link</div>
            <div className="link-card-row">
              <a className="link-card-url" href={`/${u.slug}`} target="_blank" rel="noreferrer" title={absUrl(`/${u.slug}`)}>
                {window.location.host}/{u.slug}
              </a>
              <CopyButton text={absUrl(`/${u.slug}`)} label="Copy" variant="ghost" />
            </div>
          </div>
          <div className="me-card">
            <Avatar name={u.name} color={u.avatar_color} src={u.avatar_url} size={34} />
            <div className="me-info">
              <div className="strong small ellipsis">{u.name}</div>
              <div className="xsmall muted ellipsis">{me.org?.name || u.email}</div>
            </div>
            <div className="me-actions">
              <Link className="icon-btn" to="/app/settings" title="Settings" aria-label="Settings"><Icon name="settings" size={16} /></Link>
              <button type="button" className="icon-btn" onClick={logout} title="Log out" aria-label="Log out"><Icon name="logout" size={16} /></button>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn mobile-only" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" size={20} />
          </button>
          <div className="topbar-crumb">
            <span className="muted">Workspace</span>
            <Icon name="chevron-right" size={13} className="crumb-sep" />
            <b>{pageTitle(location.pathname)}</b>
          </div>
          <div className="topbar-actions">
            {demo && (
              <button type="button" className="demo-badge" onClick={() => exitDemo('/')} title="Exit preview mode">
                <span className="demo-dot" aria-hidden="true" /> Demo<span className="demo-exit">Exit</span>
              </button>
            )}
            <a className="btn btn-secondary btn-sm" href={`/${u.slug}`} target="_blank" rel="noreferrer" aria-label="Open my booking page"><Icon name="external" size={14} /><span className="btn-label">Booking page</span></a>
          </div>
        </header>
        <div className="content">
          {(me.pending_invites || []).map((inv) => (
            <div key={inv.id} className="banner banner-info">
              <Icon name="mail" size={17} />
              <div className="grow"><b>{inv.invited_by || 'Someone'}</b> invited you to join <b>{inv.org_name}</b> as {inv.role === 'admin' ? 'an admin' : 'a member'}.</div>
              <Button size="sm" onClick={async () => { try { await api(`/invites/${inv.id}/accept`, { method: 'POST' }); await refresh(); toast(`You joined ${inv.org_name}`); } catch (e) { toast(e.message, 'err'); } }}>Accept</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await api(`/invites/${inv.id}/decline`, { method: 'POST' }); await refresh(); }}>Decline</Button>
            </div>
          ))}
          {me.calendar_accounts === 0 && (me.features?.google_calendar || me.features?.microsoft_calendar) && (
            <div className="banner banner-warn">
              <Icon name="calendar" size={17} />
              <div className="grow">Connect your calendar so people can't book over your existing meetings.</div>
              <Link className="btn btn-sm btn-primary" to="/app/integrations">Connect calendar</Link>
            </div>
          )}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
