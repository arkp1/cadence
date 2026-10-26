import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { toast as sonnerToast } from 'sonner';
import { Check, ChevronsUpDown, Copy as CopyIcon, Globe2, Loader2 } from 'lucide-react';
import { timezones, copy as copyText, initials } from '../lib.js';

import { Button as UiButton } from '@/components/ui/button';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Avatar as UiAvatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs as UiTabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Icon, hasIcon } from './icons.jsx';

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const push = useCallback((msg, type = 'ok') => {
    if (type === 'err') sonnerToast.error(msg);
    else sonnerToast.success(msg);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <Toaster />
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Buttons & fields ----------
const BUTTON_VARIANTS = {
  primary: 'default',
  secondary: 'outline',
  outline: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
  'danger-outline': 'outline',
  google: 'outline',
};

export function Button({ variant = 'primary', size, type = 'button', className = '', loading, children, disabled, ...p }) {
  return (
    <UiButton
      type={type}
      variant={BUTTON_VARIANTS[variant] || 'default'}
      size={size === 'pill' ? 'lg' : size}
      className={cn(
        size === 'pill' && 'h-11 rounded-full px-6',
        variant === 'danger-outline' && 'border-destructive/25 text-destructive hover:bg-destructive/5 hover:text-destructive',
        variant === 'google' && 'bg-card font-medium text-foreground',
        className,
      )}
      disabled={loading || disabled}
      aria-busy={loading || undefined}
      {...p}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </UiButton>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-2', className)}>
      {label && <span className="text-[12.5px] font-medium text-foreground">{label}</span>}
      {children}
      {hint && <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>}
      {error && <span className="text-xs font-medium text-destructive">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', disabled && 'opacity-50')}>
      <Switch checked={!!checked} onCheckedChange={onChange} disabled={disabled} aria-label={label || 'Toggle'} />
      {label && (
        <span
          className="cursor-pointer text-[13px] text-foreground/80"
          onClick={() => { if (!disabled) onChange(!checked); }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

// ---------- Avatars ----------
export function Avatar({ name, color = '#5b57d1', size = 40, src }) {
  return (
    <UiAvatar className="shrink-0" style={{ width: size, height: size }}>
      {src && <AvatarImage src={src} alt={name || ''} referrerPolicy="no-referrer" />}
      <AvatarFallback
        className="font-semibold tracking-wide text-white"
        style={{ background: color, fontSize: size * 0.36 }}
      >
        {initials(name)}
      </AvatarFallback>
    </UiAvatar>
  );
}

// ---------- Dialogs ----------
export function Modal({ open, onClose, title, children, footer, width = 560 }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose?.(); }}>
      <DialogContent style={{ maxWidth: width }} className="max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogDescription>
        </DialogHeader>
        <div className="text-sm">{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => {
            setBusy(true);
            try { await onConfirm(); } finally { setBusy(false); }
          }}>{confirmLabel}</Button>
        </>
      }
    >
      {message && <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>}
      {children}
    </Modal>
  );
}

export function CopyButton({ text, label = 'Copy', variant = 'secondary', size = 'sm' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      onClick={(e) => { e.stopPropagation(); copyText(text); setDone(true); setTimeout(() => setDone(false), 1600); }}
      aria-label={done ? 'Copied' : label}
    >
      {done ? <Check className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {done ? 'Copied' : label}
    </Button>
  );
}

export function Empty({ icon = 'calendar', title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-5 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border border-border/70 bg-secondary text-primary" aria-hidden="true">
        {hasIcon(icon) ? <Icon name={icon} size={22} /> : icon}
      </div>
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      {children && <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{children}</p>}
      {action}
    </div>
  );
}

// ---------- Tabs ----------
export function Tabs({ tabs, value, onChange }) {
  return (
    <UiTabs value={value} onValueChange={onChange} className="mb-5">
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto p-1 sm:w-fit">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="h-8 shrink-0 px-3">
            {t.label}
            {t.count != null && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {t.count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </UiTabs>
  );
}

export function Spinner({ center }) {
  if (center) return <div className="flex flex-col items-center justify-center gap-3 px-5 py-24"><Loader2 className="size-6 animate-spin text-primary" /><span className="text-xs text-muted-foreground">Loading…</span></div>;
  return <Loader2 className="size-4 animate-spin text-primary" />;
}

const BADGE_VARIANTS = {
  green: 'success',
  red: 'destructive',
  blue: 'info',
  yellow: 'warning',
  purple: 'violet',
  gray: 'secondary',
  default: 'secondary',
};

export function Badge({ children, color = 'gray' }) {
  return <UiBadge variant={BADGE_VARIANTS[color] || 'secondary'}>{children}</UiBadge>;
}

// ---------- Time zone picker ----------
export function TimezoneSelect({ value, onChange, compact }) {
  const [open, setOpen] = useState(false);
  const all = useMemo(() => timezones(), []);
  const current = all.find((t) => t.zone === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="timezone-trigger"
          aria-label="Choose time zone"
          className={cn(
            'flex min-w-0 items-center gap-2 text-left text-[13px] font-medium text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-50',
            compact
              ? 'w-auto rounded-lg px-0 py-1 hover:text-primary'
              : 'h-10 w-full rounded-xl border border-input bg-card px-3 shadow-xs hover:border-foreground/20',
          )}
        >
          <Globe2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{current ? `${current.label} (UTC${current.short})` : value}</span>
          <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground/70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[330px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search time zones…" autoFocus />
          <CommandList>
            <CommandEmpty>No time zone found.</CommandEmpty>
            <CommandGroup>
              {all.map((t) => (
                <CommandItem
                  key={t.zone}
                  value={`${t.label} ${t.short} ${t.zone}`}
                  onSelect={() => { onChange(t.zone); setOpen(false); }}
                >
                  <Check className={cn('size-3.5', t.zone === value ? 'opacity-100 text-primary' : 'opacity-0')} />
                  <span className="truncate">{t.label}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">UTC{t.short}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try { const data = await fn(); setState({ loading: false, data, error: null }); return data; } catch (error) { setState({ loading: false, data: null, error }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}
