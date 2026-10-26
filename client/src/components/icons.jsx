import React from 'react';

/**
 * A small, hand-rolled icon set (24×24, 1.8px stroke) so the interface has a
 * consistent visual language without pulling in an icon package.
 */
const geometry = {
  menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  'calendar-check': (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 1.9" />
    </>
  ),
  poll: (
    <>
      <path d="M4 6.5h9M4 12h13M4 17.5h6" />
      <circle cx="18" cy="17.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  route: (
    <>
      <circle cx="5" cy="19" r="2.2" />
      <circle cx="19" cy="5" r="2.2" />
      <path d="M7.5 19H13a4 4 0 0 0 4-4V7.5" />
    </>
  ),
  bolt: <path d="M13.2 2.5 4.8 13.4a.6.6 0 0 0 .5.9h5.1l-1 7.2a.6.6 0 0 0 1.1.4l8.4-10.9a.6.6 0 0 0-.5-.9h-5.1l1-7.2a.6.6 0 0 0-1.1-.4Z" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.4" />
      <path d="M3.4 20c.3-3.2 2.7-5.3 5.6-5.3s5.3 2.1 5.6 5.3" />
      <path d="M16 5.4a3.3 3.3 0 0 1 0 6.3" />
      <path d="M17.3 14.9c2.1.5 3.4 2.3 3.6 4.6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10.5" />
      <path d="M10 20V4.5" />
      <path d="M16 20v-6.5" />
      <path d="M21 20H3" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v3.5M15 3v3.5" />
      <path d="M7 6.5h10v3.8a5 5 0 0 1-10 0V6.5Z" />
      <path d="M12 15.3V21" />
    </>
  ),
  building: (
    <>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2.5" />
      <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3.8 7.2 12 13l8.2-5.8" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h6M14 7h6M4 17h3M11 17h9" />
      <circle cx="12" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  'chevron-left': <path d="M14.5 6l-6 6 6 6" />,
  'chevron-up': <path d="M6 14.5l6-6 6 6" />,
  'arrow-left': <><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></>,
  'arrow-up': <><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>,
  'arrow-down': <><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></>,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5.5 15V6.5A2 2 0 0 1 7.5 4.5H16" />
    </>
  ),
  external: (
    <>
      <path d="M14.5 4H20v5.5" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.3 7l.8 12.1A1.9 1.9 0 0 0 9 21h6a1.9 1.9 0 0 0 1.9-1.9L17.7 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  pencil: <path d="M4 20l1.1-4.2L16.7 4.2a2.1 2.1 0 0 1 3 3L8.2 18.9 4 20Z" />,
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V5.5A2 2 0 0 0 14 3.5H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H8" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10.5" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 20h15" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5l3-3" />
      <path d="M8.6 17.4l-1.3 1.3a3.6 3.6 0 0 1-5.1-5.1l3.2-3.2a3.6 3.6 0 0 1 5.1 0" />
      <path d="M15.4 6.6l1.3-1.3a3.6 3.6 0 0 1 5.1 5.1l-3.2 3.2a3.6 3.6 0 0 1-5.1 0" />
    </>
  ),
  logout: (
    <>
      <path d="M15 12H4" />
      <path d="M8 8l-4 4 4 4" />
      <path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.6 1.2c0 1.8-2.4 2-2.4 3.4" />
      <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11 3.5l1.7 4.4 4.4 1.7-4.4 1.7L11 15.7 9.3 11.3 4.9 9.6l4.4-1.7L11 3.5Z" />
      <path d="M18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
    </>
  ),
  video: (
    <>
      <rect x="2.8" y="6" width="13" height="12" rx="3" />
      <path d="M15.8 11l5-2.8v7.6l-5-2.8" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M12 21s6.8-5.6 6.8-11a6.8 6.8 0 1 0-13.6 0C5.2 15.4 12 21 12 21Z" />
      <circle cx="12" cy="9.8" r="2.5" />
    </>
  ),
  phone: (
    <path d="M6.4 3.5h2.9l1.4 3.9-2 1.4a11.3 11.3 0 0 0 5.5 5.5l1.4-2 3.9 1.4v2.9a2 2 0 0 1-2.1 2A16.4 16.4 0 0 1 4.4 5.6a2 2 0 0 1 2-2.1Z" />
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M3.5 12h17" />
      <path d="M12 3.3c2.9 3.3 4.3 6.2 4.3 8.7S14.9 17.4 12 20.7c-2.9-3.3-4.3-6.2-4.3-8.7S9.1 6.6 12 3.3Z" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 19.2 6v6c0 4.6-3 7.6-7.2 9.1C7.8 19.6 4.8 16.6 4.8 12V6L12 3.2Z" />
      <path d="M9.3 12.2l2 2 3.6-3.8" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-13.7-5L4 8.2" />
      <path d="M4 4.2v4h4" />
      <path d="M4 13a8 8 0 0 0 13.7 5l2.3-2.2" />
      <path d="M20 19.8v-4h-4" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M12 3.6 21 19.5a1 1 0 0 1-.9 1.5H3.9a1 1 0 0 1-.9-1.5L12 3.6Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.7" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  'credit-card': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18" />
      <path d="M6.5 15h4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6.4 5.6 12 5.6 21.2 12 21.2 12 17.6 18.4 12 18.4 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  lock: (
    <>
      <rect x="4.8" y="10" width="14.4" height="10.5" rx="2.5" />
      <path d="M8.2 10V7.4a3.8 3.8 0 0 1 7.6 0V10" />
    </>
  ),
  play: <path d="M8.5 5.5v13l10-6.5-10-6.5Z" />,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
};

export function hasIcon(name) { return Object.prototype.hasOwnProperty.call(geometry, name); }

export function Icon({ name, size = 18, strokeWidth = 1.8, className = '', title }) {
  const shape = geometry[name] || geometry.dot;
  return (
    <svg
      className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable="false"
    >
      {title && <title>{title}</title>}
      {shape}
    </svg>
  );
}

export function LogoMark({ size = 30 }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M4 8h16" /><path d="M4 12h10" /><path d="M4 16h13" />
      </svg>
    </span>
  );
}

export function Logo({ className = '', children = 'Cadence' }) {
  return (
    <span className={`logo ${className}`}>
      <LogoMark />
      <span className="logo-word">{children}</span>
    </span>
  );
}
