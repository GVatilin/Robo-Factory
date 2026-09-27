import { Boxes, Building2, ChevronDown, LogIn, LogOut, Plus, Scale, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import type { Permission, Role } from "../api/types";
import { ROLE_LABELS, useAuth } from "../auth/AuthContext";
import { compareLink, useCompare } from "../compare/CompareContext";
import { Badge, Spinner } from "../ui/Controls";
import { cx } from "../ui/Field";
import { LogoMark } from "../ui/LogoMark";
import "./AppShell.css";

const ROLE_TONE: Record<Role, "neutral" | "accent" | "violet" | "ink"> = {
  guest: "neutral",
  user: "accent",
  vendor: "violet",
  admin: "ink",
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={ROLE_TONE[role]} icon={role === "admin" ? <ShieldCheck size={13} aria-hidden="true" /> : undefined}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}

function UserMenu() {
  const { user, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!user) {
    return (
      <div className="shell__auth">
        <Link className="btn btn--ghost btn--sm" to="/login" state={{ from: location.pathname }}>
          <LogIn size={16} aria-hidden="true" />
          Войти
        </Link>
        <Link className="btn btn--primary btn--sm shell__register" to="/register">
          Регистрация
        </Link>
      </div>
    );
  }

  const name = user.full_name ?? user.email;
  return (
    <div ref={root} className={cx("usermenu", open && "is-open")}>
      <button type="button" className="usermenu__trigger" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <span className="usermenu__avatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="usermenu__text">
          <span className="usermenu__name">{name}</span>
          <span className="usermenu__role">{ROLE_LABELS[role]}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" className="usermenu__chevron" />
      </button>
      {open && (
        <div className="usermenu__popover" role="menu">
          <div className="usermenu__head">
            <span className="usermenu__email">{user.email}</span>
            <RoleBadge role={role} />
            {user.manufacturer && (
              <span className="usermenu__company">
                <Building2 size={14} aria-hidden="true" />
                {user.manufacturer.name}
              </span>
            )}
          </div>
          {user.manufacturer && (
            <Link role="menuitem" className="usermenu__item" to={`/manufacturers/${user.manufacturer.id}`}>
              <Building2 size={16} aria-hidden="true" />
              Моя компания
            </Link>
          )}
          <button role="menuitem" type="button" className="usermenu__item" onClick={logout}>
            <LogOut size={16} aria-hidden="true" />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

/** Решения, отмеченные для сравнения, — видны на страницах каталога. */
function CompareTray() {
  const compare = useCompare();
  const location = useLocation();
  const path = location.pathname;
  const hidden = path === "/compare" || path.startsWith("/products/new") || path.endsWith("/edit");
  if (hidden || compare.items.length === 0) return null;
  return (
    <div className="ctray" role="region" aria-label="Решения для сравнения">
      <span className="ctray__title">
        <Scale size={17} aria-hidden="true" />
        Сравнение
      </span>
      <ul className="ctray__items">
        {compare.items.map((item) => (
          <li key={item.id}>
            <span className="ctray__thumb">{item.image ? <img src={item.image} alt="" /> : <Boxes size={16} aria-hidden="true" />}</span>
            <span className="ctray__name" title={item.name}>
              {item.name}
            </span>
            <button type="button" onClick={() => compare.remove(item.id)} aria-label={`Убрать «${item.name}» из сравнения`}>
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="link-button ctray__clear" onClick={compare.clear}>
        Очистить
      </button>
      <Link className="btn btn--primary btn--sm" to={compareLink(compare.items.map((i) => i.id))}>
        Сравнить {compare.items.length}
      </Link>
    </div>
  );
}

export default function AppShell() {
  const { can, user } = useAuth();
  const canAddProduct = can("products:manage", "products:manage_own");
  const addProductLink = user?.role === "vendor" && user.manufacturer ? `/products/new?manufacturer=${user.manufacturer.id}` : "/products/new";

  return (
    <div className="shell">
      <div className="shell__backdrop" aria-hidden="true" />
      <header className="shell__topbar">
        <Link className="brand" to="/">
          <LogoMark />
          <span>Robo-Factory</span>
        </Link>
        <nav className="shell__nav" aria-label="Разделы">
          <NavLink to="/projects" className={({ isActive }) => cx("shell__link", isActive && "is-active")}>
            <Building2 size={17} aria-hidden="true" />Проекты
          </NavLink>
          <NavLink to="/solutions" className={({ isActive }) => cx("shell__link", isActive && "is-active")}>
            <Boxes size={17} aria-hidden="true" />
            Решения
          </NavLink>
          <NavLink to="/compare" className={({ isActive }) => cx("shell__link", isActive && "is-active")}>
            <Scale size={17} aria-hidden="true" />
            Сравнение
          </NavLink>
          <NavLink to="/manufacturers" className={({ isActive }) => cx("shell__link", isActive && "is-active")}>
            <Building2 size={17} aria-hidden="true" />
            Производители
          </NavLink>
          {can("users:manage") && (
            <NavLink to="/admin/users" className={({ isActive }) => cx("shell__link", isActive && "is-active")}>
              <Users size={17} aria-hidden="true" />
              Пользователи и роли
            </NavLink>
          )}
        </nav>
        <div className="shell__actions">
          {canAddProduct && (
            <Link className="btn btn--primary btn--sm" to={addProductLink}>
              <Plus size={16} aria-hidden="true" />
              <span className="shell__add-label">Добавить товар</span>
            </Link>
          )}
          <UserMenu />
        </div>
      </header>
      <main className="shell__main">
        <Outlet />
      </main>
      <CompareTray />
    </div>
  );
}

/** Страница только для ролей с одним из прав; гость отправляется на вход. */
export function RequirePermission({ permissions, children }: { permissions: Permission[]; children: ReactNode }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="page page--center">
        <Spinner label="Проверяем доступ…" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="page page--center">
        <div className="gate card">
          <LogIn size={28} aria-hidden="true" className="gate__icon" />
          <h1>Нужно войти</h1>
          <p>Эта страница доступна после входа в систему.</p>
          <Link className="btn btn--primary" to="/login" state={{ from: location.pathname + location.search }}>
            Войти
          </Link>
        </div>
      </div>
    );
  }
  if (!can(...permissions)) {
    return (
      <div className="page page--center">
        <div className="gate card">
          <ShieldCheck size={28} aria-hidden="true" className="gate__icon" />
          <h1>Недостаточно прав</h1>
          <p>
            Ваша роль — «{ROLE_LABELS[user.role]}». Раздел доступен администратору
            {permissions.some((p) => p.endsWith("_own")) ? " и вендору" : ""}.
          </p>
          <Link className="btn btn--ghost" to="/manufacturers">
            К производителям
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
