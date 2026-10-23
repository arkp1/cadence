import React, { useState } from 'react';
import { api, absUrl } from '../lib.js';
import { Modal, CopyButton, Tabs, Button, Field } from '../components/ui.jsx';

export function embedCode(kind, url, opts = {}) {
  const src = absUrl('/embed.js');
  if (kind === 'inline') return `<!-- Cadence inline widget -->\n<div class="cadence-inline-widget" data-url="${url}" style="min-width:320px;height:700px;"></div>\n<script src="${src}" async></script>`;
  if (kind === 'popup') return `<!-- Cadence popup widget -->\n<script src="${src}"></script>\n<script>\n  window.addEventListener('load', function () {\n    Cadence.initBadgeWidget({ url: '${url}', text: '${opts.text || 'Schedule time with me'}', color: '${opts.color || '#4f46e5'}', textColor: '#ffffff' });\n  });\n</script>`;
  if (kind === 'text') return `<!-- Cadence popup text link -->\n<script src="${src}"></script>\n<a href="#" onclick="Cadence.initPopupWidget({ url: '${url}' }); return false;">${opts.text || 'Schedule time with me'}</a>`;
  return `<iframe src="${url}?embed=1" width="100%" height="700" frameborder="0"></iframe>`;
}

export default function ShareModal({ et, onClose }) {
  const [tab, setTab] = useState('link');
  const [kind, setKind] = useState('inline');
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const url = absUrl(et.url_path);
  return (
    <Modal open onClose={onClose} title={`Share "${et.name}"`} width={640}>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'link', label: 'Share link' }, { value: 'single', label: 'Single-use link' }, { value: 'embed', label: 'Add to website' }, { value: 'email', label: 'Email text' }]} />
      {tab === 'link' && (
        <div className="stack">
          <p className="muted">Anyone with this link can book this event{et.secret ? ' (it is hidden from your profile page)' : ''}.</p>
          <div className="copy-row"><input readOnly value={url} onFocus={(e) => e.target.select()} /><CopyButton text={url} size={undefined} /></div>
          <p className="small muted">Tip: add <code>?name=…&amp;email=…</code> to prefill the booking form.</p>
        </div>
      )}
      {tab === 'single' && (
        <div className="stack">
          <p className="muted">Generate a link that expires after one booking — handy for sending to a specific person. If they cancel, the link becomes valid again.</p>
          <Button loading={busy} onClick={async () => { setBusy(true); const r = await api(`/event-types/${et.id}/links`, { method: 'POST' }); setLink(absUrl(r.link.path)); setBusy(false); }}>Generate single-use link</Button>
          {link && <div className="copy-row"><input readOnly value={link} onFocus={(e) => e.target.select()} /><CopyButton text={link} size={undefined} /></div>}
        </div>
      )}
      {tab === 'embed' && (
        <div className="stack">
          <div className="embed-kinds">
            {[['inline', 'Inline embed', 'Booking page directly on your site'], ['popup', 'Popup widget', 'Floating button that opens a popup'], ['text', 'Popup text', 'Text link that opens a popup']].map(([k, t, d]) => (
              <button key={k} className={`embed-kind ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}><div className="strong">{t}</div><div className="small muted">{d}</div></button>
            ))}
          </div>
          <Field label="Embed code"><textarea className="code" rows={8} readOnly value={embedCode(kind, url, { color: et.color })} /></Field>
          <div className="row gap"><CopyButton text={embedCode(kind, url, { color: et.color })} label="Copy code" variant="primary" size={undefined} />
            <span className="small muted">Listen for <code>cadence.event_scheduled</code> on <code>window</code> to track conversions.</span></div>
        </div>
      )}
      {tab === 'email' && (
        <div className="stack">
          <textarea rows={5} readOnly value={`Hi there,\n\nPlease pick a time that works for you for a ${et.name} (${et.duration} min):\n${url}\n\nLooking forward to it!`} />
          <CopyButton text={`Hi there,\n\nPlease pick a time that works for you for a ${et.name} (${et.duration} min):\n${url}\n\nLooking forward to it!`} label="Copy text" size={undefined} />
        </div>
      )}
    </Modal>
  );
}
