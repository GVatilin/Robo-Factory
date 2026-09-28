import { lazy, Suspense, useState } from "react";

import { Link } from "react-router";

import { useAuth } from "../auth/AuthContext";
import { SceneBoundary, supportsWebGL, usePrefersReducedMotion } from "../scene/support";
import { LogoMark } from "../ui/LogoMark";

import "./Landing.css";

const WarehouseScene = lazy(() => import("../scene/WarehouseScene"));

const STEPS = [
  {
    title: "Параметры объекта",
    text: "Площадь, режим работы, объёмы операций и персонал — вручную или из Excel. Система проверит заполненность и диапазоны значений.",
  },
  {
    title: "Подбор решений",
    text: "Платформа отсеет роботов, которые не подходят по габаритам, грузоподъёмности или инфраструктуре, и объяснит причины.",
  },
  {
    title: "Экономика сценариев",
    text: "Текущий процесс, покупка и аренда (RaaS) в одной таблице: CAPEX, OPEX, TCO, окупаемость, ROI и чувствительность.",
  },
  {
    title: "Визуализация и отчёт",
    text: "Имитация работы роботов на схеме объекта подтверждает расчёт. Результаты выгружаются в PDF и Excel.",
  },
];

const FACILITIES = ["Склад", "Аэропорт", "Медицинское учреждение"];

export default function Landing() {
  const { user } = useAuth();
  const reducedMotion = usePrefersReducedMotion();
  const [webgl] = useState(supportsWebGL);

  return (
    <div className="landing">
      <div className="landing__scene" aria-hidden="true">
        {webgl && (
          <SceneBoundary>
            <Suspense fallback={null}>
              <WarehouseScene animate={!reducedMotion} />
            </Suspense>
          </SceneBoundary>
        )}
      </div>
      <div className="landing__veil" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="/">
          <LogoMark />
          <span>Robo-Factory</span>
        </a>
        <nav className="topbar__nav" aria-label="Навигация по странице">
          <a href="#how">Как это работает</a>
          <Link to="/robots">Каталог роботов</Link>
          <Link to="/manufacturers">Производители</Link>
          <a href="/api/docs">API</a>
          {user ? (
            <Link to="/robots" className="topbar__cta">
              {user.full_name ?? user.email}
            </Link>
          ) : (
            <Link to="/login" className="topbar__cta">
              Войти
            </Link>
          )}
        </nav>
      </header>

      <main>
        <section className="hero">
          <p className="hero__eyebrow">Экспресс-оценка роботизации</p>
          <h1 className="hero__title">Подберите роботов для объекта и&nbsp;посчитайте эффект до&nbsp;покупки</h1>
          <p className="hero__lead">
            Каталог роботизированных решений, подбор под параметры склада, аэропорта или больницы, сравнение
            покупки и&nbsp;аренды по&nbsp;окупаемости и&nbsp;ROI. Расчёт проверяется имитацией работы роботов
            на&nbsp;схеме объекта.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#how">
              Как это работает
            </a>
            <Link className="button button--ghost" to="/robots">
              Каталог роботов
            </Link>
          </div>
          <ul className="hero__facilities" aria-label="Типы объектов">
            {FACILITIES.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>

        <section className="how" id="how" aria-labelledby="how-title">
          <h2 id="how-title">Как это работает</h2>
          <p className="how__lead">От параметров объекта до отчёта для руководства — в одном сценарии.</p>
          <ol className="how__steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="how__step">
                <span className="how__index" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="footer">© 2026 Robo-Factory</footer>
    </div>
  );
}
