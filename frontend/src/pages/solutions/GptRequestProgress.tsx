import { useEffect, useState } from 'react';
import { Bot, Check, CircleAlert } from 'lucide-react';

/** API returns one complete answer, so this meter shows elapsed time, not model progress. */
export default function GptRequestProgress({active,complete,failed}:{active:boolean;complete:boolean;failed:boolean}) {
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{
    if(!active)return;
    const started=performance.now();
    setElapsed(0);
    const timer=window.setInterval(()=>setElapsed((performance.now()-started)/1000),200);
    return ()=>window.clearInterval(timer);
  },[active]);
  const state=active?'waiting':complete?'complete':failed?'failed':'idle';
  const seconds=Math.floor(elapsed);
  const title=active?(elapsed>=50?'Ожидаем завершения запроса':'Ожидаем ответ GPT'):complete?'Рекомендация готова':failed?'Не удалось получить ответ':'Готов к анализу';
  const caption=active?'Шкала показывает время ожидания':complete?'Объяснение и риски — ниже':failed?'Можно повторить запрос':'Сравнение вариантов и объяснение выбора';
  const Icon=complete&&!active?Check:failed&&!active?CircleAlert:Bot;
  return <div className={`gpt-progress gpt-progress--${state}`}>
    <div className="gpt-progress__orb" aria-hidden="true"><span/><Icon size={22}/></div>
    <div className="gpt-progress__content">
      <div className="gpt-progress__heading"><strong role="status">{title}</strong><span aria-hidden="true">{state==='idle'?'до 50 с':`${seconds} с${active&&elapsed<50?' / 50 с':''}`}</span></div>
      <div className="gpt-progress__track" role="progressbar" aria-label="Время ожидания ответа GPT" aria-valuemin={0} aria-valuemax={50}
        aria-valuenow={active&&elapsed>=50?undefined:complete?50:Math.min(seconds,50)}
        aria-valuetext={active?`Прошло ${seconds} секунд. Ответ ещё не получен.`:title}>
        <span style={{width:`${complete&&!active?100:Math.min(elapsed/50*100,100)}%`}}/>
      </div>
      <small>{caption}</small>
    </div>
  </div>;
}
