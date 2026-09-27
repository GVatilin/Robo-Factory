import { useState } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthContext";
import { ErrorState, Spinner } from "../../ui/Controls";
import "./Projects.css";

export type Project = { id: string; name: string; description: string | null; facility_type_id: number; is_demo: boolean;
  parameters: Record<string, string | number | boolean>; parameter_origins: Record<string, string>;
  missing_required: string[]; scenarios: {id: string; name: string; kind: string}[]; updated_at: string };
export type Facility = { id: number; name: string; code: string };

export default function ProjectsPage() {
  const { user } = useAuth();
  const [demo, setDemo] = useState(false);
  const showDemo = demo || !user;
  const [offset, setOffset] = useState(0);
  const data = useApi<Project[]>(`/projects?demo=${showDemo}&limit=20&offset=${offset}`);
  const facilities = useApi<Facility[]>("/reference/facility-types");
  return <div className="page">
    <header className="page-header"><div><p className="page-header__eyebrow">Объекты роботизации</p><h1>Проекты</h1>
      <p>Сохраните параметры объекта или начните с демонстрационного примера.</p></div>
      {user ? <Link className="btn btn--primary" to="/projects/new">Создать проект</Link> : <Link className="btn btn--primary" to="/login" state={{from:"/projects"}}>Войти и создать проект</Link>}
    </header>
    {user && <div className="projects-actions"><button type="button" className={`btn ${!demo ? "btn--primary" : "btn--ghost"}`} onClick={()=>{setDemo(false);setOffset(0);}}>Мои проекты</button>
      <button type="button" className={`btn ${demo ? "btn--primary" : "btn--ghost"}`} onClick={()=>{setDemo(true);setOffset(0);}}>Демо-примеры</button></div>}
    {data.error ? <ErrorState message={data.error.message} onRetry={data.reload}/> : data.loading ? <Spinner label="Загружаем проекты…"/> : <>
      {!data.data?.length && <p>Пока нет проектов. Создайте новый или скопируйте демо-пример.</p>}
      <div className="projects-grid">{data.data?.map(p=><article className="card project-card" key={p.id}>
        <p>{facilities.data?.find(f=>f.id===p.facility_type_id)?.name}{p.is_demo && " · Демо"}</p>
        <h2><Link to={`/projects/${p.id}`}>{p.name}</Link></h2><p>{p.description}</p>
        <small>Изменён: {new Date(p.updated_at).toLocaleString("ru-RU")}</small>
        <Link className="btn btn--ghost" to={`/projects/${p.id}`}>Открыть проект</Link>
      </article>)}</div>
      <div className="projects-actions"><button type="button" className="btn btn--ghost" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-20))}>Назад</button>
        <button type="button" className="btn btn--ghost" disabled={(data.data?.length??0)<20} onClick={()=>setOffset(offset+20)}>Далее</button></div>
    </>}
  </div>;
}
