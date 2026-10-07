import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, CalendarCheck2, CalendarDays, ChevronRight, LayoutDashboard, Link2, ListTodo, LogOut, Menu, RefreshCw, Settings2, X } from 'lucide-react';
import { formatDate } from './lib';
import type { Translate } from './components';
import type { Locale, User, View } from './types';
import './shell.css';

type ShellProps = {
  user: User; locale: Locale; t: Translate; view: View; now: number; unread: number;
  loading: boolean; busy: boolean; menuOpen: boolean;
  setMenuOpen: (open: boolean) => void; navigate: (view: View) => void;
  refresh: () => void; logout: () => void; chooseLocale: (locale: Locale) => void;
  children: ReactNode;
};

export function PageHeader({ title, description, eyebrow, actions }: { title: string; description: string; eyebrow?: string; actions?: ReactNode }) {
  return <div className="app-page-header"><div>{eyebrow && <span className="app-eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div><div className="app-page-actions">{actions}</div></div>;
}

/** A small shared surface, not a second design-system or state layer. */
export function Panel({ title, description, action, className = '', children }: { title?: string; description?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`app-panel ${className}`} aria-label={title}>
    {title && <header className="app-panel-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>}
    {children}
  </section>;
}

export function AppShell(props: ShellProps) {
  const { user, locale, t, view, now, unread, loading, busy, menuOpen, setMenuOpen, navigate, refresh, logout, chooseLocale, children } = props;
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 780px)').matches);
  const sidebar = useRef<HTMLElement>(null);
  const active = view === 'suggestions' ? 'calendar' : view;
  const nav = [
    { id: 'dashboard', label: t('Tổng quan', 'Dashboard'), icon: LayoutDashboard },
    { id: 'calendar', label: t('Lịch của tôi', 'Calendar'), icon: CalendarDays },
    { id: 'tasks', label: t('Công việc', 'Tasks'), icon: ListTodo },
    { id: 'notifications', label: t('Thông báo', 'Notifications'), icon: Bell, count: unread },
    { id: 'integrations', label: t('Kết nối dữ liệu', 'Data connections'), icon: Link2 },
    { id: 'settings', label: t('Cài đặt', 'Settings'), icon: Settings2 },
  ] as const;
  useEffect(() => {
    const query = window.matchMedia('(max-width: 780px)');
    const changed = () => { setMobile(query.matches); if (!query.matches) setMenuOpen(false); };
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, [setMenuOpen]);
  useEffect(() => {
    if (!mobile || !menuOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(sidebar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [mobile, menuOpen, setMenuOpen]);

  return <div className="app-frame">
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault();
      const main = document.getElementById('main-content');
      main?.focus(); main?.scrollIntoView({ block: 'start' });
    }}>{t('Đến nội dung chính', 'Skip to content')}</a>
    {mobile && menuOpen && <button className="app-nav-scrim" tabIndex={-1} aria-label={t('Đóng menu', 'Close menu')} onClick={() => setMenuOpen(false)} />}
    <aside id="app-navigation" ref={sidebar} className={`app-sidebar ${menuOpen ? 'is-open' : ''}`} inert={mobile && !menuOpen} aria-hidden={mobile && !menuOpen ? true : undefined} aria-label={t('Menu ứng dụng', 'Application menu')}>
      <div className="app-brand"><span><CalendarCheck2 size={21} /></span>unirhythm</div>
      <button className="icon-button app-sidebar-close" onClick={() => setMenuOpen(false)} aria-label={t('Đóng menu', 'Close menu')}><X size={20} /></button>
      <span className="app-nav-label">{t('QUẢN LÝ LỊCH', 'SCHEDULE MANAGEMENT')}</span>
      <nav aria-label={t('Điều hướng chính', 'Main navigation')}>
        {nav.map(item => <button key={item.id} className={`app-nav-item ${active === item.id ? 'active' : ''}`} aria-current={active === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.label}</span>{'count' in item && item.count > 0 && <span className="app-nav-count">{item.count > 99 ? '99+' : item.count}</span>}</button>)}
      </nav>
      <div className="app-profile"><span className="app-avatar" aria-hidden="true">{user.name.trim().slice(0, 1).toUpperCase() || 'S'}</span><div><strong>{user.name}</strong><small>{user.isDemo ? t('Tài khoản demo', 'Demo account') : t('Sinh viên UED', 'UED student')}</small></div><button className="icon-button" onClick={logout} disabled={busy} aria-label={t('Đăng xuất', 'Sign out')}><LogOut size={17} /></button></div>
    </aside>
    <div className="app-main" inert={mobile && menuOpen}>
      <header className="app-topbar"><div className="app-breadcrumb">
        <button className="icon-button app-menu-button" onClick={() => setMenuOpen(true)} aria-label={t('Mở menu', 'Open menu')} aria-expanded={menuOpen} aria-controls="app-navigation"><Menu size={20} /></button>
        <span className="app-breadcrumb-root">UED <ChevronRight size={13} /></span><strong>{nav.find(item => item.id === active)?.label}</strong>{view === 'suggestions' && <><ChevronRight size={13} /><span>{t('Đề xuất', 'Suggestions')}</span></>}
      </div><div className="app-top-actions">
        <time className="app-date" dateTime={new Date(now).toISOString()}>{formatDate(new Date(now), user.timezone, 'EEE, dd/MM/yyyy', locale)}</time>
        <button className="language-switch" onClick={() => chooseLocale(locale === 'vi' ? 'en' : 'vi')}>{locale === 'vi' ? 'VI' : 'EN'}</button>
        <button className="icon-button app-notification-button" onClick={() => navigate('notifications')} aria-label={t(`${unread} thông báo chưa đọc trong danh sách`, `${unread} unread notifications in the loaded list`)}><Bell size={18} />{unread > 0 && <i />}</button>
        <button className="icon-button" onClick={refresh} disabled={loading || busy} aria-label={t('Tải lại dữ liệu', 'Refresh data')}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
      </div></header>
      <main id="main-content" className="app-content" tabIndex={-1}>
        {user.isDemo && <div className="app-demo-note"><span>DEMO</span>{t('Dữ liệu minh họa — chưa kết nối tài khoản trường.', 'Sample data — not connected to a school account.')}</div>}
        {children}
        <footer className="app-footer">unirhythm <span>·</span> {t('Lịch học và công việc sinh viên', 'Student schedule and tasks')}</footer>
      </main>
    </div>
  </div>;
}
