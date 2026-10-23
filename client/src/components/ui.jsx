import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { timezones, copy as copyText, initials } from '../lib.js';

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, type }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{items.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Basic ----------
export function Button({ variant = 'primary', size, className = '', loading, children, ...p }) {
  return <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`} disabled={loading || p.disabled} {...p}>{loading ? <span className="spinner" /> : null}{children}</button>;
}
export function Field({ label, hint, error, children, className = '' }) {
  return <label className={`field ${className}`}>{label && <span className="field-label">{label}</span>}{children}{hint && <span className="field-hint">{hint}</span>}{error && <span className="field-error">{error}</span>}</label>;
}
export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}
export function Avatar({ name, color = '#4f46e5', size = 40 }) {
  return <div className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</div>;
}
export function Modal({ open, onClose, title, children, footer, width = 560 }) {
  useEffect(() => {
    if (!open) return; const h = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={title} width={460}
      footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</Button></>}>
      {message && <p className="muted">{message}</p>}{children}
    </Modal>
  );
}
export function CopyButton({ text, label = 'Copy link', variant = 'secondary', size = 'sm' }) {
  const [done, setDone] = useState(false);
  return <Button variant={variant} size={size} onClick={(e) => { e.stopPropagation(); copyText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? '✓ Copied' : label}</Button>;
}
export function Empty({ icon = '🗓️', title, children, action }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><h3>{title}</h3>{children && <p className="muted">{children}</p>}{action}</div>;
}
export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs">{tabs.map((t) => <button key={t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>{t.label}{t.count != null && <span className="tab-count">{t.count}</span>}</button>)}</div>;
}
export function Spinner({ center }) { return center ? <div className="center-pad"><span className="spinner spinner-lg" /></div> : <span className="spinner" />; }
export function Badge({ children, color = 'gray' }) { return <span className={`badge badge-${color}`}>{children}</span>; }

// ---------- Time zone picker ----------
export function TimezoneSelect({ value, onChange, compact }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef();
  const all = useMemo(() => timezones(), []);
  const list = all.filter((t) => !q || t.label.toLowerCase().includes(q.toLowerCase()) || t.short.includes(q));
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const cur = all.find((t) => t.zone === value);
  return (
    <div className={`tz-select ${compact ? 'compact' : ''}`} ref={ref}>
      <button type="button" className="tz-btn" onClick={() => setOpen(!open)} aria-label="Timezone dropdown button">
        🌐 <span>{cur ? `${cur.label} (UTC${cur.short})` : value}</span> <span className="caret">▾</span>
      </button>
      {open && (
        <div className="tz-pop">
          <input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="tz-list">
            {list.map((t) => (
              <button type="button" key={t.zone} className={`tz-item ${t.zone === value ? 'active' : ''}`} onClick={() => { onChange(t.zone); setOpen(false); setQ(''); }}>
                <span>{t.label}</span><span className="muted">UTC{t.short}</span>
              </button>
            ))}
            {!list.length && <div className="muted pad">No matches</div>}
          </div>
        </div>
      )}
    </div>
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
