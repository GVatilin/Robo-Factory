import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { SceneBoundary, supportsWebGL, usePrefersReducedMotion } from "../scene/support";
import "./AnimatedBackdrop.css";

const RoboticsHubScene=lazy(()=>import('../scene/RoboticsHubScene'));

export default function AnimatedBackdrop() {
  const {pathname}=useLocation();
  const reduced=usePrefersReducedMotion();
  const [paused,setPaused]=useState(false);
  const [visible,setVisible]=useState(()=>!document.hidden);
  const [webgl]=useState(supportsWebGL);
  useEffect(()=>{
    const update=()=>setVisible(!document.hidden);
    document.addEventListener('visibilitychange',update);
    return ()=>document.removeEventListener('visibilitychange',update);
  },[]);
  if(pathname==='/')return null;
  return <>
    <div className="animated-backdrop" aria-hidden="true">
      {webgl&&<SceneBoundary><Suspense fallback={null}><RoboticsHubScene animate={!reduced&&!paused&&visible}/></Suspense></SceneBoundary>}
      <div className="animated-backdrop__veil"/>
    </div>
    {webgl&&!reduced&&<button type="button" className="backdrop-toggle" aria-pressed={paused} onClick={()=>setPaused(v=>!v)} aria-label={paused?'Включить анимацию фона':'Приостановить анимацию фона'} title={paused?'Включить анимацию фона':'Приостановить анимацию фона'}>{paused?'▷':'Ⅱ'}<span>Фон</span></button>}
  </>;
}
