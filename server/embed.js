// Served at /embed.js — lets any website embed Cadence booking pages.
export const EMBED_JS = String.raw`(function(){
  if (window.Cadence && window.Cadence.__loaded) return;
  var css = '.cadence-overlay{position:fixed;inset:0;background:rgba(17,24,39,.55);z-index:2147483000;display:flex;align-items:center;justify-content:center;animation:cadfade .15s ease}'+
    '.cadence-popup{position:relative;width:min(1000px,94vw);height:min(720px,90vh);background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 25px 60px rgba(0,0,0,.3)}'+
    '.cadence-popup iframe{width:100%;height:100%;border:0}'+
    '.cadence-close{position:absolute;top:-14px;right:-14px;width:32px;height:32px;border-radius:50%;border:0;background:#111827;color:#fff;font-size:18px;cursor:pointer;z-index:2}'+
    '.cadence-badge{position:fixed;right:20px;bottom:20px;z-index:2147482000;padding:12px 20px;border-radius:999px;border:0;font:600 15px system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2)}'+
    '@keyframes cadfade{from{opacity:0}to{opacity:1}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  function withEmbed(url, extra){ var u = new URL(url, location.href); u.searchParams.set('embed','1'); u.searchParams.set('embed_domain', location.hostname); if (extra) for (var k in extra) if (extra[k]!=null) u.searchParams.set(k, extra[k]); return u.toString(); }
  function prefillParams(o){ var p = {}; if (!o || !o.prefill) return p; if (o.prefill.name) p.name = o.prefill.name; if (o.prefill.email) p.email = o.prefill.email; return p; }
  function initInlineWidget(o){
    var el = typeof o.parentElement === 'string' ? document.querySelector(o.parentElement) : o.parentElement;
    if (!el) return; var f = document.createElement('iframe');
    f.src = withEmbed(o.url, prefillParams(o)); f.style.cssText = 'width:100%;min-width:320px;height:'+(o.height||700)+'px;border:0'; f.setAttribute('title','Schedule a meeting');
    el.innerHTML = ''; el.appendChild(f); return f;
  }
  function initPopupWidget(o){
    var ov = document.createElement('div'); ov.className = 'cadence-overlay';
    var box = document.createElement('div'); box.className = 'cadence-popup';
    var x = document.createElement('button'); x.className = 'cadence-close'; x.innerHTML = '&times;'; x.setAttribute('aria-label','Close');
    var f = document.createElement('iframe'); f.src = withEmbed(o.url, prefillParams(o)); f.setAttribute('title','Schedule a meeting');
    function close(){ ov.remove(); document.removeEventListener('keydown', esc); }
    function esc(e){ if (e.key === 'Escape') close(); }
    x.onclick = close; ov.onclick = function(e){ if (e.target === ov) close(); }; document.addEventListener('keydown', esc);
    box.appendChild(x); box.appendChild(f); ov.appendChild(box); document.body.appendChild(ov);
    return { close: close };
  }
  function initBadgeWidget(o){
    var b = document.createElement('button'); b.className = 'cadence-badge'; b.textContent = o.text || 'Schedule time with me';
    b.style.background = o.color || '#4f46e5'; b.style.color = o.textColor || '#fff';
    b.onclick = function(){ initPopupWidget(o); }; document.body.appendChild(b); return b;
  }
  window.addEventListener('message', function(e){
    var d = e.data; if (!d || typeof d !== 'object' || typeof d.event !== 'string' || d.event.indexOf('cadence.') !== 0) return;
    try { window.dispatchEvent(new CustomEvent(d.event, { detail: d.payload })); } catch(_){}
  });
  function auto(){
    var els = document.querySelectorAll('.cadence-inline-widget[data-url]');
    for (var i=0;i<els.length;i++){ if (els[i].__cad) continue; els[i].__cad = 1; initInlineWidget({ url: els[i].getAttribute('data-url'), parentElement: els[i], height: els[i].getAttribute('data-height') }); }
  }
  window.Cadence = { __loaded: true, initInlineWidget: initInlineWidget, initPopupWidget: initPopupWidget, initBadgeWidget: initBadgeWidget, closePopupWidget: function(){ var o=document.querySelector('.cadence-overlay'); if(o) o.remove(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();`;
