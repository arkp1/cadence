import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, absUrl, durLabel, KIND_LABELS, KIND_DESCRIPTIONS } from '../lib.js';
import { useAuth } from '../auth.js';
import { Button, CopyButton, Toggle, Modal, Spinner, useAsync, useToast, Avatar, Confirm, Badge } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import ShareModal from './ShareModal.jsx';

export default function EventTypes() {
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, reload, setData } = useAsync(() => api('/event-types'), []);
  const [creating, setCreating] = useState(false);
  const [share, setShare] = useState(null);
  const [del, setDel] = useState(null);
  const [menu, setMenu] = useState(null);
  const [q, setQ] = useState('');
  if (loading) return <Spinner center />;
  const list = data.event_types.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));

  const toggle = async (et, active) => {
    setData((d) => ({ ...d, event_types: d.event_types.map((x) => (x.id === et.id ? { ...x, active } : x)) }));
    await api(`/event-types/${et.id}`, { method: 'PATCH', body: { active } });
    toast(active ? 'Event type turned on' : 'Event type turned off');
  };
  const create = async (kind) => {
    const r = await api('/event-types', { method: 'POST', body: { name: `New ${KIND_LABELS[kind]} Meeting`, kind } });
    nav(`/app/event-types/${r.event_type.id}`);
  };
  const move = async (idx, dir) => {
    const arr = [...data.event_types]; const j = idx + dir; if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]]; setData((d) => ({ ...d, event_types: arr }));
    await api('/event-types/reorder', { method: 'POST', body: { ids: arr.map((e) => e.id) } });
  };

  return (
    <div onClick={() => setMenu(null)}>
      <div className="page-head">
        <div><h1>Event types</h1><p>Create events to share for people to book on your calendar.</p></div>
        <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} /> New event type</Button>
      </div>
      <div className="row between wrap gap mb">
        <div className="row gap">
          <Avatar name={me.user.name} color={me.user.avatar_color} src={me.user.avatar_url} size={36} />
          <div>
            <div className="strong small">{me.user.name}</div>
            <a className="link xsmall" href={`/${me.user.slug}`} target="_blank" rel="noreferrer">{absUrl(`/${me.user.slug}`)}</a>
          </div>
        </div>
        <input className="search" placeholder="Search event types…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search event types" />
      </div>
      <div className="et-grid">
        {list.map((et, idx) => (
          <div key={et.id} className={`et-card ${et.active ? '' : 'off'}`} style={{ '--c': et.color }}>
            <div className="et-top">
              <Toggle checked={et.active} onChange={(v) => toggle(et, v)} />
              <div className="et-menu-wrap">
                <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setMenu(menu === et.id ? null : et.id); }} aria-label="More actions" aria-haspopup="menu"><Icon name="more" size={17} /></button>
                {menu === et.id && (
                  <div className="menu" role="menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => nav(`/app/event-types/${et.id}`)}><Icon name="pencil" size={15} /> Edit</button>
                    <button onClick={() => { setShare(et); setMenu(null); }}><Icon name="link" size={15} /> Share / embed</button>
                    <button onClick={() => nav(`/app/event-types/${et.id}/troubleshoot`)}><Icon name="search" size={15} /> Troubleshoot availability</button>
                    <button onClick={async () => { await api(`/event-types/${et.id}/duplicate`, { method: 'POST' }); reload(); toast('Duplicated'); setMenu(null); }}><Icon name="duplicate" size={15} /> Duplicate</button>
                    <button onClick={() => { move(idx, -1); setMenu(null); }} disabled={idx === 0}><Icon name="arrow-up" size={15} /> Move up</button>
                    <button onClick={() => { move(idx, 1); setMenu(null); }} disabled={idx === list.length - 1}><Icon name="arrow-down" size={15} /> Move down</button>
                    <button className="danger" onClick={() => { setDel(et); setMenu(null); }}><Icon name="trash" size={15} /> Delete</button>
                  </div>
                )}
              </div>
            </div>
            <Link to={`/app/event-types/${et.id}`} className="et-body">
              <h3>{et.name}</h3>
              <div className="small muted">{et.durations.map(durLabel).join(' / ')} · {KIND_LABELS[et.kind]}</div>
              <div className="row gap-sm mt-sm wrap">
                {et.secret && <Badge color="purple">Secret</Badge>}
                {et.settings?.price_cents > 0 && <Badge color="green">Paid</Badge>}
                {et.upcoming > 0 && <Badge color="blue">{et.upcoming} upcoming</Badge>}
              </div>
            </Link>
            <div className="et-foot">
              <a className="link small" href={et.url_path} target="_blank" rel="noreferrer">View booking page</a>
              <div className="row gap-sm">
                <CopyButton text={absUrl(et.url_path)} />
                <Button size="sm" variant="ghost" onClick={() => setShare(et)}>Share</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {data.team_event_types.length > 0 && (
        <>
          <h2 className="section-title">Team events you host</h2>
          <div className="et-grid">
            {data.team_event_types.map((et) => (
              <div key={et.id} className="et-card" style={{ '--c': et.color }}>
                <div className="et-body"><h3>{et.name}</h3><div className="small muted">{durLabel(et.duration)} · {KIND_LABELS[et.kind]}</div></div>
                <div className="et-foot"><a className="link small" href={et.url_path} target="_blank" rel="noreferrer">View booking page</a><Link className="link small" to={`/app/event-types/${et.id}/troubleshoot`}>Troubleshoot</Link></div>
              </div>
            ))}
          </div>
        </>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Create a new event type" width={620}>
        <div className="kind-list">
          {Object.keys(KIND_LABELS).map((k) => (
            <button key={k} className="kind-option" onClick={() => create(k)}>
              <div className="strong">{KIND_LABELS[k]}</div>
              <div className="small muted">{KIND_DESCRIPTIONS[k]}</div>
              <span className="arrow"><Icon name="chevron-right" size={18} /></span>
            </button>
          ))}
        </div>
      </Modal>
      {share && <ShareModal et={share} onClose={() => setShare(null)} />}
      <Confirm open={!!del} danger title="Delete event type?" confirmLabel="Delete" onClose={() => setDel(null)}
        message={`"${del?.name}" will be removed. Existing scheduled events stay on your calendar.`}
        onConfirm={async () => { await api(`/event-types/${del.id}`, { method: 'DELETE' }); setDel(null); reload(); toast('Event type deleted'); }} />
    </div>
  );
}
