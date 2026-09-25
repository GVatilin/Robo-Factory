import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

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

/** Если WebGL недоступен или сцена упала, лендинг остаётся с градиентным фоном. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function LogoMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 28 9.5v13L16 29 4 22.5v-13Z" fill="#dbe8fb" />
      <path d="M16 3 28 9.5 16 16 4 9.5Z" fill="#9fc0ee" />
      <path d="M16 16v13L4 22.5v-13Z" fill="#5d8fdb" />
      <path d="M16 16v13l12-6.5v-13Z" fill="#2463d8" />
    </svg>
  );
}

export default function Landing() {
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
          <a href="/api/docs">API</a>
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
            <a className="button button--ghost" href="/api/docs">
              Документация API
            </a>
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
