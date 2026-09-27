import { ArrowRight, Building2, Eye, EyeOff, ShieldCheck, User as UserIcon } from "lucide-react";
import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { resolveSize } from "../scene/robots/kinds";
import { SceneBoundary, supportsWebGL, usePrefersReducedMotion } from "../scene/support";
import { Notice } from "../ui/Controls";
import { Field, Input } from "../ui/Field";
import { LogoMark } from "../ui/LogoMark";
import "./AuthPages.css";

const RobotPreview = lazy(() => import("../scene/robots/RobotPreview"));

const DEMO_ACCOUNTS = [
  { role: "Администратор", email: "admin@example.com", password: "admin12345", icon: ShieldCheck, text: "Каталог, публикация, роли" },
  { role: "Вендор", email: "vendor@example.com", password: "vendor12345", icon: Building2, text: "Товары своей компании" },
  { role: "Пользователь", email: "user@example.com", password: "user12345", icon: UserIcon, text: "Каталог и проекты" },
];

function Showcase() {
  const reduced = usePrefersReducedMotion();
  const [webgl] = useState(supportsWebGL);
  const { size } = resolveSize("forklift", null);
  return (
    <aside className="auth__showcase" aria-hidden="true">
      <div className="auth__scene">
        {webgl && (
          <SceneBoundary>
            <Suspense fallback={null}>
              <RobotPreview kind="forklift" size={size} animate={!reduced} />
            </Suspense>
          </SceneBoundary>
        )}
      </div>
      <div className="auth__caption">
        <p className="auth__eyebrow">Каталог роботизированных решений</p>
        <p className="auth__quote">Производители ведут карточки своих роботов, платформа подбирает их под объект.</p>
      </div>
    </aside>
  );
}

function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth__password">
      <Input
        id={props.id}
        type={visible ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        invalid={props.invalid}
        autoComplete={props.autoComplete}
        required
      />
      <button
        type="button"
        className="auth__eye"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

function useRedirectTarget(): string {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return from && from !== "/login" && from !== "/register" ? from : "/solutions";
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (credentials: { email: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      await login(credentials.email, credentials.password);
      navigate(target, { replace: true });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Не удалось войти. Повторите попытку.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit({ email, password });
  };

  return (
    <div className="auth">
      <section className="auth__panel">
        <Link className="auth__brand" to="/">
          <LogoMark />
          Robo-Factory
        </Link>
        <div className="auth__form-wrap">
          <h1>Вход</h1>
          <p className="auth__lead">Войдите, чтобы добавлять товары, вести карточку компании или сохранять проекты.</p>
          <form className="auth__form" onSubmit={onSubmit} noValidate>
            {error && <Notice tone="danger">{error}</Notice>}
            <Field label="E-mail" htmlFor="login-email">
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.ru"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Пароль" htmlFor="login-password">
              <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <button className="btn btn--primary auth__submit" type="submit" disabled={busy || !email || !password}>
              {busy ? "Входим…" : "Войти"}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>

          <div className="auth__demo">
            <p className="auth__demo-title">Демо-учётки для проверки ролей</p>
            <div className="auth__demo-list">
              {DEMO_ACCOUNTS.map(({ role, email: demoEmail, password: demoPassword, icon: Icon, text }) => (
                <button
                  key={demoEmail}
                  type="button"
                  className="auth__demo-item"
                  disabled={busy}
                  onClick={() => {
                    setEmail(demoEmail);
                    setPassword(demoPassword);
                    void submit({ email: demoEmail, password: demoPassword });
                  }}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{role}</strong>
                    <small>{text}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="auth__switch">
            Нет учётной записи? <Link to="/register">Зарегистрируйтесь</Link> или{" "}
            <Link to="/solutions">продолжите как гость</Link>.
          </p>
        </div>
      </section>
      <Showcase />
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const target = useRedirectTarget();
  const [form, setForm] = useState({ email: "", password: "", full_name: "", organization: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(form.email)) local.email = "Введите корректный e-mail, например name@company.ru";
    if (form.password.length < 8) local.password = "Минимум 8 символов";
    else if (!/\d/.test(form.password) || !/\p{L}/u.test(form.password)) local.password = "Пароль должен содержать и буквы, и цифры";
    setErrors(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    setError(null);
    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim() || null,
        organization: form.organization.trim() || null,
      });
      navigate(target, { replace: true });
    } catch (reason) {
      if (reason instanceof ApiError) {
        setErrors(reason.fields);
        if (!Object.keys(reason.fields).length) setError(reason.message);
      } else {
        setError("Не удалось зарегистрироваться. Повторите попытку.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth__panel">
        <Link className="auth__brand" to="/">
          <LogoMark />
          Robo-Factory
        </Link>
        <div className="auth__form-wrap">
          <h1>Регистрация</h1>
          <p className="auth__lead">
            Учётная запись пользователя: каталог и собственные проекты. Если вы представляете производителя, после
            регистрации администратор подключит роль вендора и привяжет вас к компании.
          </p>
          <form className="auth__form" onSubmit={onSubmit} noValidate>
            {error && <Notice tone="danger">{error}</Notice>}
            <Field label="E-mail" htmlFor="reg-email" required error={errors.email}>
              <Input
                id="reg-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email")(e.target.value)}
                placeholder="name@company.ru"
                autoComplete="email"
                invalid={Boolean(errors.email)}
              />
            </Field>
            <Field label="Пароль" htmlFor="reg-password" required error={errors.password} hint="Не короче 8 символов, буквы и цифры">
              <PasswordInput
                id="reg-password"
                value={form.password}
                onChange={set("password")}
                invalid={Boolean(errors.password)}
                autoComplete="new-password"
              />
            </Field>
            <div className="auth__row">
              <Field label="Имя" htmlFor="reg-name" error={errors.full_name}>
                <Input id="reg-name" value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} placeholder="Иван Петров" autoComplete="name" />
              </Field>
              <Field label="Организация" htmlFor="reg-org" error={errors.organization}>
                <Input
                  id="reg-org"
                  value={form.organization}
                  onChange={(e) => set("organization")(e.target.value)}
                  placeholder="ООО «Логистика»"
                  autoComplete="organization"
                />
              </Field>
            </div>
            <button className="btn btn--primary auth__submit" type="submit" disabled={busy}>
              {busy ? "Создаём учётную запись…" : "Зарегистрироваться"}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </form>
          <p className="auth__switch">
            Уже есть учётная запись? <Link to="/login">Войдите</Link>.
          </p>
        </div>
      </section>
      <Showcase />
    </div>
  );
}
