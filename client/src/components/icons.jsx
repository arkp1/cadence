import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleHelp,
  Clock3,
  Copy,
  CopyPlus,
  CreditCard,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  Globe2,
  Info,
  LayoutGrid,
  Link2,
  ListChecks,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Pencil,
  Phone,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Video,
  X,
  Zap,
} from 'lucide-react';

const ICONS = {
  'alert-triangle': AlertTriangle,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-up': ArrowUp,
  chart: BarChart3,
  building: Building2,
  'calendar-check': CalendarCheck2,
  calendar: CalendarDays,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  dot: Circle,
  help: CircleHelp,
  clock: Clock3,
  copy: Copy,
  duplicate: CopyPlus,
  'credit-card': CreditCard,
  download: Download,
  more: Ellipsis,
  external: ExternalLink,
  eye: Eye,
  globe: Globe2,
  grid: LayoutGrid,
  info: Info,
  link: Link2,
  lock: LockKeyhole,
  logout: LogOut,
  mail: Mail,
  'map-pin': MapPin,
  menu: Menu,
  pencil: Pencil,
  phone: Phone,
  play: Play,
  plug: Plug,
  plus: Plus,
  poll: ListChecks,
  refresh: RefreshCw,
  route: Route,
  search: Search,
  settings: Settings2,
  shield: ShieldCheck,
  sparkles: Sparkles,
  trash: Trash2,
  users: Users,
  video: Video,
  x: X,
  bolt: Zap,
};

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export function Icon({ name, size = 18, strokeWidth = 1.8, className = '', title }) {
  const Cmp = ICONS[name] || Circle;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={`icon ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
    </Cmp>
  );
}

export function LogoMark({ size = 30 }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M4 7.5h16" />
        <path d="M4 12h9.5" />
        <path d="M4 16.5h12.5" />
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
