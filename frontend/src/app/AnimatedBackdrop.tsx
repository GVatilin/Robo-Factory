import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { usePrefersReducedMotion } from "../scene/support";
import "./AnimatedBackdrop.css";

type Point = [number, number];
const ROUTES: Point[][] = [
  [[-12,-7],[12,-7],[12,7],[-12,7]],
  [[-8,-3],[8,-3],[8,3],[-8,3]],
  [[-15,-10],[-3,-10],[-3,10],[-15,10]],
];

/** Декоративная изометрическая логистика; не симуляция расчётов проекта. */
export default function AnimatedBackdrop() {
  const {pathname} = useLocation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  const reduced = usePrefersReducedMotion();
  const [paused,setPaused] = useState(false);
  const active = pathname !== '/';
  const theme = pathname.startsWith('/projects') ? 1 : pathname.startsWith('/compare') ? 2 : 0;

  useEffect(()=>{
    if(!active || !canvas.current) return;
    const element=canvas.current;
    const ctx=element.getContext('2d');
    if(!ctx) return;
    let width=0,height=0,frame=0,last=0,time=elapsed.current;
    const accent=['#628fd0','#629eaf','#8b8fc7'][theme];
    function draw() {
      if(!ctx) return;
      ctx.clearRect(0,0,width,height);
      const scale=Math.max(width/48,height/35);
      const angle=.08*Math.sin(time*.025);
      const project=(x:number,y:number,z=0):Point=>{
        const u=x*Math.cos(angle)-y*Math.sin(angle),v=x*Math.sin(angle)+y*Math.cos(angle);
        return [width*.53+(u-v)*scale*.85,height*.48+(u+v)*scale*.43-z*scale];
      };
      function polygon(points:Point[],fill:string,stroke?:string) {
        if(!ctx) return;
        ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
        ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}
      }
      function box(x:number,y:number,w:number,d:number,h:number,color=accent,z=0) {
        polygon([project(x,y+d,z),project(x+w,y+d,z),project(x+w,y+d,z+h),project(x,y+d,z+h)],color);
        polygon([project(x+w,y,z),project(x+w,y+d,z),project(x+w,y+d,z+h),project(x+w,y,z+h)],'#94b4d9');
        polygon([project(x,y,z+h),project(x+w,y,z+h),project(x+w,y+d,z+h),project(x,y+d,z+h)],'#e3eefb','#9bb8dc');
      }
      ctx.lineWidth=1;ctx.strokeStyle='#b7cee8';
      for(let n=-32;n<=32;n+=2){ctx.beginPath();for(const [a,b] of [[project(n,-32),project(n,32)],[project(-32,n),project(32,n)]]){ctx.moveTo(...a);ctx.lineTo(...b);}ctx.stroke();}
      // Маршрутные петли и поток сигналов между станциями.
      ROUTES.forEach((route,index)=>{
        ctx.beginPath();route.forEach(([x,y],i)=>{const p=project(x,y);if(i)ctx.lineTo(...p);else ctx.moveTo(...p);});ctx.closePath();
        ctx.strokeStyle=index===1?accent:'#a4bedf';ctx.lineWidth=index===1?2:1.3;
        ctx.setLineDash([5,9]);ctx.lineDashOffset=-time*6;ctx.stroke();ctx.setLineDash([]);
      });
      const stations:Point[]=[[-11,-5],[-5,-5],[2,-5],[9,-5],[-11,4],[-5,4],[2,4],[9,4]];
      const items:{depth:number;paint:()=>void}[]=[];
      stations.forEach(([x,y],index)=>items.push({depth:x+y,paint:()=>{
        box(x-.4,y-.3,3,2,.12,'#a4c0e1');
        box(x,y,2.1,1.3,index%3===0?1.6:.7);
        if(index%3!==0)box(x+.35,y+.2,.65,.65,.65,'#b7cce7',.72);
        const p=project(x+1.5,y+.4,1.1);
        ctx.fillStyle=accent;ctx.beginPath();ctx.arc(...p,2.5,0,Math.PI*2);ctx.fill();
      }}));
      for(let i=0;i<(width<600?5:10);i++){
        const route=ROUTES[i%ROUTES.length];
        const lengths=route.map((a,j)=>Math.hypot(a[0]-route[(j+1)%route.length][0],a[1]-route[(j+1)%route.length][1]));
        const total=lengths.reduce((a,b)=>a+b,0);
        let distance=(time*(.55+(i%3)*.12)+i*13.7)%total,segment=0;
        while(distance>lengths[segment]&&segment<lengths.length-1){distance-=lengths[segment];segment++;}
        const a=route[segment],b=route[(segment+1)%route.length],t=distance/lengths[segment];
        const x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
        items.push({depth:x+y,paint:()=>{
          const p=project(x+.5,y+.4);
          ctx.fillStyle='#86a8d333';ctx.beginPath();ctx.ellipse(...p,scale*.9,scale*.35,0,0,Math.PI*2);ctx.fill();
          box(x,y,.95,.75,.35,accent,.08);
          box(x+.17,y+.12,.58,.5,.45,'#a1bbdc',.45);
          const light=project(x+.12,y+.1,.42);ctx.fillStyle='#458cae';ctx.beginPath();ctx.arc(...light,2,0,Math.PI*2);ctx.fill();
        }});
      }
      items.sort((a,b)=>a.depth-b.depth).forEach(item=>item.paint());
    }
    function tick(now:number) {
      if(document.hidden || paused || reduced) return;
      if(now-last>=1000/30){time+=last?Math.min((now-last)/1000,.1):0;elapsed.current=time;last=now;draw();}
      frame=requestAnimationFrame(tick);
    }
    function resize(){width=window.innerWidth;height=window.innerHeight;const dpr=Math.min(window.devicePixelRatio||1,1.5);element.width=Math.round(width*dpr);element.height=Math.round(height*dpr);ctx!.setTransform(dpr,0,0,dpr,0,0);draw();}
    function resume(){cancelAnimationFrame(frame);last=0;if(!document.hidden&&!paused&&!reduced)frame=requestAnimationFrame(tick);else draw();}
    resize();resume();window.addEventListener('resize',resize);document.addEventListener('visibilitychange',resume);
    return ()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',resume);};
  },[active,theme,reduced,paused]);

  if(!active) return null;
  return <><div className="animated-backdrop" aria-hidden="true"><canvas ref={canvas}/><div className="animated-backdrop__veil"/></div>
    {!reduced&&<button type="button" className="backdrop-toggle" aria-pressed={paused} onClick={()=>setPaused(v=>!v)} aria-label={paused?'Включить анимацию фона':'Приостановить анимацию фона'} title={paused?'Включить анимацию фона':'Приостановить анимацию фона'}>{paused?'▷':'Ⅱ'}<span>Фон</span></button>}
  </>;
}
