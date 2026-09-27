import { useState } from "react";
import { ArrowRight, Bot, Calculator, ClipboardList, FileText, FolderOpen, Hospital, Plane, Plus, Warehouse } from "lucide-react";
import { Link } from "react-router";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState, Spinner } from "../../ui/Controls";
import "./Projects.css";

export type Project = { id: string; name: string; description: string | null; facility_type_id: number; is_demo: boolean;
  parameters: Record<string, string | number | boolean>; parameter_origins: Record<string, string>;
  missing_required: string[]; scenarios: {id: string; name: string; kind: string; quantity?: number; product_names?: string[]; has_calculation?: boolean; stale?: boolean;
    latest_result?: {capex: number; annual_opex: number; tco: number; net_effect: number; roi_percent: number | null; simple_payback_years: number | null} | null}[]; updated_at: string;
  status?: string; required_total?: number; required_filled?: number; calculated_scenarios?: number; calculation_count?: number };
export type Facility = { id: number; name: string; code: string };

export function FacilityIcon({ code, size = 24 }: { code?: string; size?: number }) {
  const Icon = code === "airport" ? Plane : code === "medical" ? Hospital : Warehouse;
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
}

export function ProjectWorkflow({ current = 0 }: { current?: number }) {
  const steps = [
    { icon: ClipboardList, title: "Объект", description: "Параметры и нагрузка" },
    { icon: Bot, title: "Роботы", description: "Подбор и количество" },
    { icon: Calculator, title: "Экономика", description: "Покупка и RaaS" },
    { icon: FileText, title: "Отчёт", description: "Excel и PDF" },
  ];
  return <ol className="project-workflow" aria-label="Этапы работы с проектом">{steps.map((step, index) =>
    <li key={step.title} className={current === index + 1 ? "is-current" : undefined} aria-current={current === index + 1 ? "step" : undefined}>
      <span className="project-workflow__icon"><step.icon size={21} strokeWidth={1.7} aria-hidden="true" /></span>
      <div><strong><span>{String(index + 1).padStart(2, "0")}</span> {step.title}</strong><p>{step.description}</p></div>
    </li>
  )}</ol>;
}

export default function ProjectsPage() {
  const { user } = useAuth();
  const [demo, setDemo] = useState(false);
  const showDemo = demo || !user;
  const [offset, setOffset] = useState(0);
  const data = useApi<Project[]>(`/projects?demo=${showDemo}&limit=20&offset=${offset}`);
  const facilities = useApi<Facility[]>("/reference/facility-types");
  return <div className="page projects-page">
    <header className="page-header projects-hero">
      <div className="projects-hero__copy"><p className="page-header__eyebrow">Планирование роботизации</p><h1>Проекты</h1>
        <p className="projects-hero__lead">От параметров объекта — к обоснованному выбору роботов.</p>
        <p className="projects-hero__description">Сравните сценарии внедрения, рассчитайте затраты и сохраните результаты в одном проекте.</p>
      </div>
      <div className="projects-hero__action">
        {user ? <Link className="btn btn--primary" to="/projects/new"><Plus size={18} aria-hidden="true" />Создать проект</Link>
          : <Link className="btn btn--primary" to="/login" state={{from:"/projects"}}><Plus size={18} aria-hidden="true" />Войти и создать проект</Link>}
        <span>Склад · Аэропорт · Медицинский объект</span>
      </div>
    </header>
    <ProjectWorkflow />
    <section className="projects-collection" aria-label="Список проектов">
      <div className="projects-collection__head">
        {user ? <div className="projects-tabs" role="group" aria-label="Категория проектов">
          <button type="button" aria-pressed={!demo} className={!demo ? "is-active" : undefined} onClick={()=>{setDemo(false);setOffset(0);}}>Мои проекты</button>
          <button type="button" aria-pressed={demo} className={demo ? "is-active" : undefined} onClick={()=>{setDemo(true);setOffset(0);}}>Демо-примеры</button>
        </div> : <h2>Демонстрационные проекты</h2>}
        <p>{showDemo ? "Готовые исходные данные для знакомства с платформой" : "Ваши объекты и сохранённые расчёты"}</p>
      </div>
      {data.error ? <ErrorState message={data.error.message} onRetry={data.reload}/> : data.loading ? <Spinner label="Загружаем проекты…"/> : <>
        {!data.data?.length && <div className="projects-empty">
          <span className="projects-empty__icon"><FolderOpen size={34} strokeWidth={1.5} aria-hidden="true" /></span>
          <h2>{offset ? "На этой странице пока нет проектов" : showDemo ? "Демо-проекты пока не добавлены" : "Начните с вашего объекта"}</h2>
          <p>{offset ? "Вернитесь на предыдущую страницу списка." : showDemo ? "Создайте свой проект и заполните параметры объекта." : "Задайте параметры склада, аэропорта или медицинского объекта. Можно начать с копии демонстрационного проекта."}</p>
          <div className="projects-actions">
            {!offset && user && <Link className="btn btn--primary" to="/projects/new"><Plus size={17} aria-hidden="true" />Создать проект</Link>}
            {!offset && !showDemo && <button className="btn btn--ghost" type="button" onClick={()=>{setDemo(true);setOffset(0);}}>Посмотреть демо<ArrowRight size={17} aria-hidden="true" /></button>}
          </div>
        </div>}
        <div className="projects-grid">{data.data?.map(project=>{
          const facility = facilities.data?.find(f=>f.id===project.facility_type_id);
          const total = project.required_total ?? 0;
          const filled = Math.min(total, project.required_filled ?? 0);
          const calculated = project.calculation_count ?? 0;
          const status = calculated > 0 ? "Есть расчёты" : total > 0 && filled === total ? "Параметры заполнены" : "Черновик";
          return <article className="card project-card project-tile" key={project.id}>
            <div className="project-tile__top"><span className={`project-facility-icon project-facility-icon--${facility?.code ?? "warehouse"}`}><FacilityIcon code={facility?.code} /></span>
              <span className={`project-status ${project.is_demo ? "project-status--demo" : calculated ? "project-status--calculated" : ""}`}>{project.is_demo ? "Демо-проект" : status}</span>
            </div>
            <div className="project-tile__heading"><p className="project-tile__facility">{facility?.name ?? "Объект роботизации"}</p>
              <h2><Link to={`/projects/${project.id}`}>{project.name}</Link></h2>
            </div>
            <p className="project-tile__description">{project.description || "Добавьте описание объекта и задачи роботизации в параметрах проекта."}</p>
            <div className="project-tile__progress">
              <div><span>Обязательные параметры</span><strong>{total > 0 ? `${filled} / ${total}` : "Не определены"}</strong></div>
              {total > 0 && <progress value={filled} max={total} aria-label={`Заполнено обязательных параметров: ${filled} из ${total}`} />}
            </div>
            <dl className="project-tile__metrics"><div><dt>Рассчитанные сценарии</dt><dd>{project.calculated_scenarios ?? 0}</dd></div><div><dt>Сохранённые расчёты</dt><dd>{calculated}</dd></div></dl>
            <div className="project-tile__footer"><span>Обновлён {new Date(project.updated_at).toLocaleDateString("ru-RU",{day:"numeric",month:"short",year:"numeric"})}</span>
              <div className="project-tile__actions"><Link className="btn btn--ghost" to={`/projects/${project.id}`}>Параметры</Link>
                <Link className="btn btn--primary" to={`/projects/${project.id}/selection`}>Подбор роботов<ArrowRight size={16} aria-hidden="true" /></Link></div>
            </div>
          </article>;
        })}</div>
        {(offset > 0 || (data.data?.length ?? 0) >= 20) && <nav className="projects-pagination" aria-label="Страницы проектов">
          <button type="button" className="btn btn--ghost" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-20))}>Назад</button>
          <span>Страница {offset / 20 + 1}</span><button type="button" className="btn btn--ghost" disabled={(data.data?.length??0)<20} onClick={()=>setOffset(offset+20)}>Далее</button>
        </nav>}
      </>}
    </section>
  </div>;
}
