import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api, ApiError, query } from "../api/client";
import { useApi, useDebounced } from "../api/hooks";
import type { ManufacturerSummary, Page, Permission, Role, RoleInfo, User } from "../api/types";
import { RoleBadge } from "../app/AppShell";
import { ROLE_LABELS, useAuth } from "../auth/AuthContext";
import { companyShortName, formatDate } from "../format";
import { Combobox, type ComboOption } from "../ui/Combobox";
import { ErrorState, Spinner, Switch } from "../ui/Controls";
import { cx, Input } from "../ui/Field";
import "./UsersPage.css";

const PERMISSION_LABELS: Record<Permission, string> = {
  "catalog:read": "Каталог и производители",
  "projects:manage": "Собственные проекты",
  "products:manage_own": "Товары своей компании",
  "manufacturers:manage_own": "Карточка своей компании",
  "products:manage": "Товары всех производителей",
  "products:publish": "Публикация товаров",
  "manufacturers:create": "Добавление производителей",
  "manufacturers:manage": "Изменение и удаление производителей",
  "users:manage": "Роли пользователей",
};

const ASSIGNABLE: Exclude<Role, "guest">[] = ["user", "vendor", "admin"];

function RoleMatrix({ roles }: { roles: RoleInfo[] }) {
  const all = Object.keys(PERMISSION_LABELS) as Permission[];
  return (
    <div className="roles">
      {roles.map((role) => (
        <article key={role.code} className={cx("role card", `role--${role.code}`)}>
          <RoleBadge role={role.code} />
          <p className="role__description">{role.description}</p>
          <ul className="role__permissions">
            {all
              .filter((p) => role.permissions.includes(p))
              .map((p) => (
                <li key={p}>
                  <Check size={13} aria-hidden="true" />
                  {PERMISSION_LABELS[p]}
                </li>
              ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const { user: me, refresh } = useAuth();
  const roles = useApi<RoleInfo[]>("/auth/roles");
  const manufacturers = useApi<Page<ManufacturerSummary>>("/manufacturers?limit=500&sort=name");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const q = useDebounced(search.trim());
  const users = useApi<Page<User>>(`/users${query({ q, role: roleFilter || null, limit: 200 })}`);
  const [updated, setUpdated] = useState<Record<string, User>>({});
  const [awaitingVendor, setAwaitingVendor] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const options = useMemo<ComboOption[]>(
    () => (manufacturers.data?.items ?? []).map((m) => ({ value: m.id, label: companyShortName(m.name), description: m.region ?? undefined })),
    [manufacturers.data],
  );

  const save = async (user: User, changes: { role?: string; manufacturer_id?: number | null; is_active?: boolean }) => {
    setSaving(user.id);
    setRowErrors(({ [user.id]: _, ...rest }) => rest);
    try {
      const result = await api<User>(`/users/${user.id}`, { method: "PATCH", body: changes });
      setUpdated((current) => ({ ...current, [user.id]: result }));
      setAwaitingVendor((current) => {
        const next = new Set(current);
        next.delete(user.id);
        return next;
      });
      if (user.id === me?.id) await refresh();
    } catch (reason) {
      const message = reason instanceof ApiError ? (Object.values(reason.fields)[0] ?? reason.message) : "Не удалось сохранить.";
      setRowErrors((current) => ({ ...current, [user.id]: message }));
    } finally {
      setSaving(null);
    }
  };

  const changeRole = (user: User, role: string) => {
    if (role === "vendor" && !user.manufacturer) {
      // Роль вендора сохраняется вместе с производителем — сначала выбор компании.
      setAwaitingVendor((current) => new Set(current).add(user.id));
      return;
    }
    setAwaitingVendor((current) => {
      const next = new Set(current);
      next.delete(user.id);
      return next;
    });
    void save(user, { role });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">Администрирование</p>
          <h1>Пользователи и роли</h1>
          <p className="page-header__lead">
            Гость видит каталог без входа. Зарегистрированный пользователь получает роль «Пользователь»; роль вендора
            назначается вместе с производителем, от имени которого он ведёт товары.
          </p>
        </div>
      </header>

      {roles.data && <RoleMatrix roles={roles.data} />}

      <section className="users card">
        <div className="users__toolbar">
          <Input
            className="users__search"
            icon={<Search size={17} />}
            type="search"
            placeholder="E-mail, имя или организация"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Поиск пользователей"
          />
          <select className="select select--sm users__filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Фильтр по роли">
            <option value="">Все роли</option>
            {ASSIGNABLE.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          {users.data && <span className="users__total">Всего: {users.data.total}</span>}
        </div>

        {users.error && <ErrorState message={users.error.message} onRetry={users.reload} />}
        {!users.data && users.loading && (
          <div className="users__loading">
            <Spinner />
          </div>
        )}
        {users.data && (
          <div className="users__table-wrap">
            <table className="users__table">
              <thead>
                <tr>
                  <th scope="col">Пользователь</th>
                  <th scope="col">Роль</th>
                  <th scope="col">Производитель</th>
                  <th scope="col">Доступ</th>
                  <th scope="col">Последний вход</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((original) => {
                  const user = updated[original.id] ?? original;
                  const self = user.id === me?.id;
                  const awaiting = awaitingVendor.has(user.id);
                  const busy = saving === user.id;
                  const roleValue = awaiting ? "vendor" : user.role;
                  return (
                    <tr key={user.id} className={cx(!user.is_active && "is-blocked", busy && "is-busy")}>
                      <td>
                        <div className="users__person">
                          <span className="users__avatar" aria-hidden="true">
                            {(user.full_name ?? user.email).slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <strong>{user.full_name ?? "Без имени"}</strong>
                            <small>{user.email}</small>
                            {user.organization && <small>{user.organization}</small>}
                          </span>
                        </div>
                        {rowErrors[user.id] && <p className="users__error">{rowErrors[user.id]}</p>}
                      </td>
                      <td>
                        <select
                          className="select select--sm"
                          value={roleValue}
                          disabled={self || busy}
                          title={self ? "Собственную роль меняет другой администратор" : undefined}
                          onChange={(e) => changeRole(user, e.target.value)}
                          aria-label={`Роль: ${user.email}`}
                        >
                          {ASSIGNABLE.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="users__maker">
                        {roleValue === "vendor" ? (
                          <>
                            <Combobox
                              options={options}
                              value={user.manufacturer?.id ?? null}
                              onChange={(manufacturerId) => save(user, { role: "vendor", manufacturer_id: manufacturerId })}
                              placeholder="Выберите производителя"
                              disabled={busy || !manufacturers.data}
                              invalid={awaiting}
                            />
                            {awaiting && <small className="users__hint">Роль сохранится после выбора компании</small>}
                          </>
                        ) : (
                          <span className="users__none">—</span>
                        )}
                      </td>
                      <td>
                        <Switch
                          checked={user.is_active}
                          disabled={self || busy}
                          onChange={(is_active) => save(user, { is_active })}
                          label={user.is_active ? "Активен" : "Заблокирован"}
                        />
                      </td>
                      <td className="users__date">{user.last_login_at ? formatDate(user.last_login_at) : "Не входил"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
