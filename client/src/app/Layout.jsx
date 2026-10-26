import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Check, ChevronsUpDown, Copy as CopyIcon, ExternalLink,
  Link2, LogOut, Menu, Search, Settings2, Sparkles,
} from 'lucide-react';

import { api, absUrl, copy, isDemo, exitDemo } from '../lib.js';
import { useAuth } from '../auth.js';
import { Avatar, Button, useToast } from '../components/ui.jsx';
import { Icon, LogoMark } from '../components/icons.jsx';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { cn } from '@/lib/utils';

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
  { label: 'Insights', items: [{ to: '/app/analytics', icon: 'chart', label: 'Analytics' }] },
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

function NavItem({ item, onNavigate }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => cn(
        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/25',
        isActive ? 'bg-white/[0.09] text-white' : 'text-stone-400 hover:bg-white/[0.05] hover:text-stone-100',
      )}
    >
      {({ isActive }) => (
        <>
          <span className={cn('absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity', isActive ? 'bg-primary opacity-100' : 'opacity-0')} />
          <span className={cn('grid size-5 place-items-center transition-colors', isActive ? 'text-primary' : 'text-stone-500 group-hover:text-stone-300')}>
            <Icon name={item.icon} size={16} />
          </span>
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ me, u, toast, onNavigate, className = '', inSheet = false }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [copied, setCopied] = useState(false);
  const url = absUrl(`/${u.slug}`);

  const copyLink = () => {
    copy(url);
    setCopied(true);
    toast('Booking link copied');
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={cn('flex h-full flex-col bg-[#17151b] px-3.5 pb-4 pt-5 text-stone-300', className)}>
      <div className="flex items-center justify-between px-2 pb-5">
        <Link to="/app" className="flex items-center gap-2.5 text-white" aria-label="Cadence home" onClick={onNavigate}>
          <LogoMark size={30} />
          <span className="text-[17px] font-semibold tracking-[-0.03em]">Cadence</span>
        </Link>
        {!inSheet && <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stone-500">Beta</span>}
      </div>
      <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.035] p-2.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-[11px] font-semibold text-primary">
            {(me.org?.name || 'C').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-stone-100">{me.org?.name || 'Workspace'}</div>
            <div className="text-[10px] text-stone-500">Personal workspace</div>
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3">
            <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">{group.label}</div>
            {group.items.map((item) => <NavItem key={item.to} item={item} onNavigate={onNavigate} />)}
          </div>
        ))}
      </nav>

      <div className="mt-auto space-y-2 border-t border-white/10 pt-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stone-500">
            <Link2 className="size-3" /> Your booking link
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <a href={`/${u.slug}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[12px] font-medium text-stone-200 transition-colors hover:text-white">
              {window.location.host}/{u.slug}
            </a>
            <button type="button" onClick={copyLink} className="grid size-7 place-items-center rounded-md text-stone-500 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/25" aria-label="Copy booking link">
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <CopyIcon className="size-3.5" />}
            </button>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/25">
              <Avatar name={u.name} color={u.avatar_color} src={u.avatar_url} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-stone-100">{u.name}</span>
                <span className="block truncate text-[10.5px] text-stone-500">{u.email}</span>
              </span>
              <ChevronsUpDown className="size-3.5 text-stone-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-60">
            <DropdownMenuLabel className="truncate">{u.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/app/settings')}><Settings2 /> Settings</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/app/integrations')}><Icon name="plug" size={16} /> Integrations</DropdownMenuItem>
            <DropdownMenuItem onSelect={copyLink}><CopyIcon /> Copy booking link</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={logout}><LogOut /> Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const u = me.user;
  const demo = isDemo();

  useEffect(() => { setSheetOpen(false); }, [location.pathname]);

  // Radix portals render outside this subtree, so publish the workspace brand
  // colour on the document root as well.
  useEffect(() => {
    const root = document.documentElement;
    const brand = u.brand_color || '#5b57d1';
    const previous = { brand: root.style.getPropertyValue('--brand'), primary: root.style.getPropertyValue('--primary'), ring: root.style.getPropertyValue('--ring') };
    root.style.setProperty('--brand', brand);
    root.style.setProperty('--primary', brand);
    root.style.setProperty('--ring', brand);
    return () => {
      Object.entries(previous).forEach(([key, value]) => {
        if (value) root.style.setProperty(`--${key}`, value);
        else root.style.removeProperty(`--${key}`);
      });
    };
  }, [u.brand_color]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commandNavigate = (to) => { setCommandOpen(false); navigate(to); };
  const commandAction = (fn) => { setCommandOpen(false); fn(); };

  return (
    <div className="app flex min-h-screen bg-background" style={{ '--brand': u.brand_color, '--primary': u.brand_color }}>
      <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 border-r border-black/40 lg:block">
        <SidebarContent me={me} u={u} toast={toast} />
      </aside>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-[300px] border-0 bg-[#17151b] p-0 text-stone-300 sm:max-w-[300px]">
          <SheetTitle className="sr-only">Main navigation</SheetTitle>
          <SheetDescription className="sr-only">Navigate around Cadence</SheetDescription>
          <SidebarContent me={me} u={u} toast={toast} onNavigate={() => setSheetOpen(false)} inSheet />
        </SheetContent>
      </Sheet>

      <div className="main flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-xl sm:px-7">
          <button type="button" className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden" onClick={() => setSheetOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>

          <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <span className="hidden text-muted-foreground sm:inline">Workspace</span>
            <span className="hidden text-border sm:inline">/</span>
            <span className="truncate font-medium text-foreground">{pageTitle(location.pathname)}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="hidden h-9 w-[240px] items-center gap-2 rounded-xl border border-border/80 bg-card/70 px-3 text-[12.5px] text-muted-foreground shadow-xs transition-colors hover:border-foreground/15 hover:text-foreground md:flex"
            >
              <Search className="size-3.5" />
              <span className="flex-1 text-left">Search or jump to…</span>
              <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">⌘K</kbd>
            </button>
            <button type="button" onClick={() => setCommandOpen(true)} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground md:hidden" aria-label="Search">
              <Search className="size-[18px]" />
            </button>

            {demo && (
              <button type="button" onClick={() => exitDemo('/')} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-100" title="Exit preview mode">
                <span className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.15)]" />
                Demo
                <span className="border-l border-amber-200 pl-1.5 text-amber-800/80">Exit</span>
              </button>
            )}

            <Button variant="secondary" size="sm" className="hidden h-8 gap-1.5 rounded-lg border-border/80 bg-card sm:inline-flex" onClick={() => window.open(`/${u.slug}`, '_blank', 'noopener')}>
              <ExternalLink className="size-3.5" /> Booking page
            </Button>
            <button type="button" onClick={() => window.open(`/${u.slug}`, '_blank', 'noopener')} className="grid size-8 place-items-center rounded-lg border border-border/80 bg-card text-muted-foreground sm:hidden" aria-label="Open booking page">
              <ArrowUpRight className="size-4" />
            </button>
          </div>
        </header>

        <div className="content mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-7 sm:py-9">
          {(me.pending_invites || []).map((inv) => (
            <div key={inv.id} className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200/70 bg-sky-50/70 px-4 py-3 text-[13px] text-sky-950">
              <Sparkles className="size-4 shrink-0 text-sky-600" />
              <div className="flex-1"><b>{inv.invited_by || 'Someone'}</b> invited you to join <b>{inv.org_name}</b> as {inv.role === 'admin' ? 'an admin' : 'a member'}.</div>
              <Button size="sm" onClick={async () => { try { await api(`/invites/${inv.id}/accept`, { method: 'POST' }); await refresh(); toast(`You joined ${inv.org_name}`); } catch (e) { toast(e.message, 'err'); } }}>Accept</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await api(`/invites/${inv.id}/decline`, { method: 'POST' }); await refresh(); }}>Decline</Button>
            </div>
          ))}
          {me.calendar_accounts === 0 && (me.features?.google_calendar || me.features?.microsoft_calendar) && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-950">
              <Icon name="calendar" size={16} />
              <div className="flex-1">Connect your calendar so people can't book over your existing meetings.</div>
              <Link className="btn btn-primary btn-sm" to="/app/integrations">Connect calendar</Link>
            </div>
          )}
          <Outlet />
        </div>
      </div>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title="Quick search" description="Navigate Cadence or run an action">
        <CommandInput placeholder="Search pages and actions…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {NAV_GROUPS.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem key={item.to} value={`${group.label} ${item.label}`} onSelect={() => commandNavigate(item.to)}>
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem value="Copy booking link" onSelect={() => commandAction(() => { copy(absUrl(`/${u.slug}`)); toast('Booking link copied'); })}>
              <CopyIcon /> Copy booking link
            </CommandItem>
            <CommandItem value="Open booking page" onSelect={() => commandAction(() => window.open(`/${u.slug}`, '_blank', 'noopener'))}>
              <ExternalLink /> Open my booking page
            </CommandItem>
            {demo && (
              <CommandItem value="Exit demo preview" onSelect={() => commandAction(() => exitDemo('/'))}>
                <LogOut /> Exit preview mode
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
