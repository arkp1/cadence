import React, { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { api } from '../lib.js';
import { Button, Field, Spinner, TimezoneSelect, Toggle, useToast, Modal, Confirm, Badge, Empty } from '../components/ui.jsx';

const DAYS = [['sun', 'Sunday'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday']];
const TIMES = (() => { const a = []; for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 15) a.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`); a.push('24:00'); return a; })();
const label = (t) => { if (t === '24:00') return '12:00am (next day)'; const [h, m] = t.split(':').map(Number); return DateTime.fromObject({ hour: h, minute: m }).toFormat('h:mma').toLowerCase(); };

function TimeSel({ value, onChange }) { return <select className="time-sel" value={value} onChange={(e) => onChange(e.target.value)}>{TIMES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>; }

function Intervals({ list, onChange }) {
  return (
    <div className="intervals">
      {list.map((iv, i) => (
        <div key={i} className="interval">
          <TimeSel value={iv.start} onChange={(v) => { const a = [...list]; a[i] = { ...iv, start: v }; onChange(a); }} />
          <span>–</span>
          <TimeSel value={iv.end} onChange={(v) => { const a = [...list]; a[i] = { ...iv, end: v }; onChange(a); }} />
          <button className="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
          {iv.start >= iv.end && <span className="field-error">End must be after start</span>}
        </div>
      ))}
    </div>
  );
}

export default function Availability() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ovModal, setOvModal] = useState(null);
  const [offModal, setOffModal] = useState(false);
  const [off, setOff] = useState({ start_date: '', end_date: '', label: 'Vacation' });
  const [del, setDel] = useState(false);

  const load = async (keepId) => {
    const r = await api('/schedules'); setData(r);
    const s = r.schedules.find((x) => x.id === (keepId || sel)) || r.schedules.find((x) => x.id === r.default_schedule_id) || r.schedules[0];
    setSel(s.id); setDraft(structuredClone(s)); setDirty(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  if (!data || !draft) return <Spinner center />;

  const upd = (p) => { setDraft({ ...draft, ...p }); setDirty(true); };
  const setDay = (d, list) => upd({ rules: { ...draft.rules, [d]: list } });
  const save = async () => {
    setSaving(true);
    try { await api(`/schedules/${draft.id}`, { method: 'PATCH', body: { name: draft.name, timezone: draft.timezone, rules: draft.rules, overrides: draft.overrides } }); toast('Availability saved'); await load(draft.id); } catch (e) { toast(e.message, 'err'); }
    setSaving(false);
  };
  const overrides = Object.entries(draft.overrides || {}).sort(([a], [b]) => a.localeCompare(b));
  const today = DateTime.now().toISODate();

  return (
    <div>
      <div className="page-head">
        <div><h1>Availability</h1><p className="muted">Set when you are available for meetings.</p></div>
        <Button variant="secondary" onClick={async () => { const r = await api('/schedules', { method: 'POST', body: { name: 'New schedule', timezone: draft.timezone } }); await load(r.schedule.id); toast('Schedule created'); }}>+ New schedule</Button>
      </div>
      <div className="sched-tabs">
        {data.schedules.map((s) => (
          <button key={s.id} className={`sched-tab ${s.id === sel ? 'active' : ''}`} onClick={() => { if (dirty && !window.confirm('Discard unsaved changes?')) return; setSel(s.id); setDraft(structuredClone(s)); setDirty(false); }}>
            {s.name}{s.id === data.default_schedule_id && <Badge color="blue">Default</Badge>}
          </button>
        ))}
      </div>
      <div className="card pad">
        <div className="row between wrap gap mb">
          <div className="row gap wrap">
            <Field label="Schedule name"><input value={draft.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
            <Field label="Time zone"><TimezoneSelect value={draft.timezone} onChange={(z) => upd({ timezone: z })} /></Field>
          </div>
          <div className="row gap-sm">
            {draft.id !== data.default_schedule_id && <Button variant="ghost" size="sm" onClick={async () => { await api(`/schedules/${draft.id}`, { method: 'PATCH', body: { make_default: true } }); load(draft.id); toast('Set as default'); }}>Set as default</Button>}
            {draft.id !== data.default_schedule_id && <Button variant="danger-outline" size="sm" onClick={() => setDel(true)}>Delete</Button>}
            <Button onClick={save} loading={saving} disabled={!dirty}>{dirty ? 'Save' : 'Saved'}</Button>
          </div>
        </div>
        <div className="avail-cols">
          <div>
            <h3>Weekly hours</h3>
            <div className="week">
              {DAYS.map(([d, name]) => {
                const list = draft.rules[d] || [];
                return (
                  <div key={d} className="week-row">
                    <div className="week-day"><Toggle checked={list.length > 0} onChange={(v) => setDay(d, v ? [{ start: '09:00', end: '17:00' }] : [])} /><span className="strong">{name.slice(0, 3).toUpperCase()}</span></div>
                    <div className="week-ints">
                      {list.length ? <Intervals list={list} onChange={(l) => setDay(d, l)} /> : <span className="muted">Unavailable</span>}
                    </div>
                    <div className="week-acts">
                      <button className="icon-btn" title="Add interval" onClick={() => { const last = list[list.length - 1]; setDay(d, [...list, last ? { start: last.end < '23:00' ? last.end : '17:00', end: last.end < '23:00' ? `${String(Math.min(24, Number(last.end.slice(0, 2)) + 1)).padStart(2, '0')}:${last.end.slice(3)}` : '18:00' } : { start: '09:00', end: '17:00' }]); }}>＋</button>
                      <button className="icon-btn" title="Copy to all days" onClick={() => { const r = {}; for (const [k] of DAYS) r[k] = structuredClone(list); upd({ rules: r }); toast(`Copied ${name} hours to all days`); }}>⧉</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <h3>Date-specific hours</h3>
            <p className="small muted">Override your availability for specific dates when your hours differ from your regular weekly hours.</p>
            <Button variant="outline" size="sm" onClick={() => setOvModal({ date: today, unavailable: false, intervals: [{ start: '09:00', end: '17:00' }] })}>+ Add date-specific hours</Button>
            <div className="ov-list">
              {overrides.map(([date, ints]) => (
                <div key={date} className={`ov-row ${date < today ? 'past' : ''}`}>
                  <div><div className="strong">{DateTime.fromISO(date).toFormat('ccc, LLL d, yyyy')}</div><div className="small muted">{ints.length ? ints.map((i) => `${label(i.start)} – ${label(i.end)}`).join(', ') : 'Unavailable'}</div></div>
                  <div className="row gap-sm">
                    <button className="icon-btn" onClick={() => setOvModal({ date, unavailable: !ints.length, intervals: ints.length ? ints : [{ start: '09:00', end: '17:00' }], editing: true })}>✏️</button>
                    <button className="icon-btn" onClick={() => { const o = { ...draft.overrides }; delete o[date]; upd({ overrides: o }); }}>✕</button>
                  </div>
                </div>
              ))}
              {!overrides.length && <p className="small muted">No date overrides.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="card pad mt">
        <div className="row between wrap"><div><h3>Time off</h3><p className="small muted">Block whole days across all your schedules (vacations, holidays, conferences).</p></div>
          <Button variant="outline" size="sm" onClick={() => { setOff({ start_date: today, end_date: today, label: 'Vacation' }); setOffModal(true); }}>+ Add time off</Button></div>
        {!data.time_off.length ? <Empty icon="🏖️" title="No time off scheduled" /> : (
          <div className="ov-list">{data.time_off.map((t) => (
            <div key={t.id} className={`ov-row ${t.end_date < today ? 'past' : ''}`}>
              <div><div className="strong">{t.label}</div><div className="small muted">{DateTime.fromISO(t.start_date).toFormat('LLL d, yyyy')}{t.end_date !== t.start_date ? ` → ${DateTime.fromISO(t.end_date).toFormat('LLL d, yyyy')}` : ''}</div></div>
              <button className="icon-btn" onClick={async () => { await api(`/time-off/${t.id}`, { method: 'DELETE' }); load(sel); }}>✕</button>
            </div>
          ))}</div>
        )}
      </div>

      <Modal open={!!ovModal} onClose={() => setOvModal(null)} title="Select the date(s) you want to assign specific hours" width={480}
        footer={<><Button variant="ghost" onClick={() => setOvModal(null)}>Cancel</Button><Button onClick={() => {
          const o = { ...draft.overrides, [ovModal.date]: ovModal.unavailable ? [] : ovModal.intervals.filter((i) => i.start < i.end) };
          upd({ overrides: o }); setOvModal(null);
        }}>Apply</Button></>}>
        {ovModal && <div className="stack">
          <Field label="Date"><input type="date" value={ovModal.date} min={today} onChange={(e) => setOvModal({ ...ovModal, date: e.target.value })} disabled={ovModal.editing} /></Field>
          <Toggle checked={ovModal.unavailable} onChange={(v) => setOvModal({ ...ovModal, unavailable: v })} label="Mark unavailable (all day)" />
          {!ovModal.unavailable && <><div className="small strong">What hours are you available?</div><Intervals list={ovModal.intervals} onChange={(l) => setOvModal({ ...ovModal, intervals: l })} />
            <Button size="sm" variant="ghost" onClick={() => setOvModal({ ...ovModal, intervals: [...ovModal.intervals, { start: '18:00', end: '19:00' }] })}>+ Add interval</Button></>}
          <p className="small muted">Remember to click Save on the schedule after applying.</p>
        </div>}
      </Modal>
      <Modal open={offModal} onClose={() => setOffModal(false)} title="Add time off" width={440}
        footer={<><Button variant="ghost" onClick={() => setOffModal(false)}>Cancel</Button><Button onClick={async () => { try { await api('/time-off', { method: 'POST', body: off }); setOffModal(false); load(sel); toast('Time off added'); } catch (e) { toast(e.message, 'err'); } }}>Add</Button></>}>
        <div className="stack">
          <Field label="Label"><input value={off.label} onChange={(e) => setOff({ ...off, label: e.target.value })} /></Field>
          <div className="grid-2"><Field label="From"><input type="date" value={off.start_date} onChange={(e) => setOff({ ...off, start_date: e.target.value, end_date: off.end_date < e.target.value ? e.target.value : off.end_date })} /></Field>
            <Field label="To"><input type="date" value={off.end_date} min={off.start_date} onChange={(e) => setOff({ ...off, end_date: e.target.value })} /></Field></div>
        </div>
      </Modal>
      <Confirm open={del} danger title="Delete schedule?" confirmLabel="Delete" onClose={() => setDel(false)} message="Event types using this schedule will fall back to your default schedule."
        onConfirm={async () => { await api(`/schedules/${draft.id}`, { method: 'DELETE' }); setDel(false); setSel(null); load(data.default_schedule_id); toast('Schedule deleted'); }} />
    </div>
  );
}
