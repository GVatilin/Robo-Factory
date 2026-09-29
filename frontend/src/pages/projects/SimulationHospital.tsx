import {useEffect,useMemo} from "react";
import {CanvasTexture,SRGBColorSpace} from "three";
import {People} from "../../scene/People";
import {geometries,material} from "../../scene/shared";
import type {StandingLayout,WalkerLayout} from "../../scene/layout";
import type {SimulationSceneProfile} from "./SimulationLayout";

type V3=[number,number,number];
export type WardActivity={door:number;progress:number|null};
const WARDS=[-11,-2.5,6,14.5];
const STAFF:WalkerLayout[]=[
  {path:[[-12,2.4],[20,2.4],[20,3.1],[-12,3.1]],speed:.8,start:.2},
  {path:[[-12,2.4],[20,2.4],[20,3.1],[-12,3.1]],speed:1,start:.72,carry:true},
  {path:[[3,-8],[20,-8],[20,-8.7],[3,-8.7]],speed:.65,start:.35,carry:true},
];
const DESK_STAFF:StandingLayout[]=[{position:[-5.4,-8.8],heading:0},{position:[-2.6,-8.8],heading:.3}];
const NO_WALKERS:WalkerLayout[]=[];
const clamp=(v:number)=>Math.min(1,Math.max(0,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};

function Part({at,size,color,round=false}:{at:V3;size:V3;color:string;round?:boolean}){
  return <mesh position={at} scale={size} geometry={round?geometries.roundedBox:geometries.box} material={material(color)} castShadow receiveShadow/>;
}
function Cross({at,scale=1}:{at:V3;scale?:number}){
  return <group position={at} scale={scale}><Part at={[0,0,0]} size={[.55,.16,.035]} color="#238f83"/><Part at={[0,0,0]} size={[.16,.55,.04]} color="#238f83"/></group>;
}

/** Local canvas labels keep Cyrillic crisp without loading external fonts. */
export function HospitalSign({text,at,width=3.2}:{text:string;at:V3;width?:number}){
  const texture=useMemo(()=>{
    const canvas=document.createElement("canvas");canvas.width=768;canvas.height=128;
    const context=canvas.getContext("2d")!;
    context.fillStyle="#f6fffd";context.beginPath();context.roundRect(3,3,762,122,20);context.fill();
    context.strokeStyle="#a6d3c9";context.lineWidth=3;context.stroke();
    context.fillStyle="#168a7e";context.fillRect(20,27,7,74);
    context.fillStyle="#245e5b";context.font="600 42px Arial, sans-serif";
    context.textAlign="center";context.textBaseline="middle";context.fillText(text,396,66,690);
    const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;return map;
  },[text]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  return <sprite position={at} scale={[width,width/6,1]}><spriteMaterial map={texture} transparent depthWrite={false}/></sprite>;
}

function PatientBed({x,z}:{x:number;z:number}){
  return <group position={[x,0,z]}>
    <Part at={[0,.46,0]} size={[1.5,.18,2.9]} color="#9abbbf" round/>
    <Part at={[0,.65,0]} size={[1.4,.23,2.75]} color="#ffffff" round/>
    <Part at={[0,.81,-.9]} size={[1.15,.17,.58]} color="#eff9f7" round/>
    <Part at={[0,.89,.35]} size={[1.2,.28,1.6]} color="#85bdbb" round/>
    <mesh position={[0,.92,-.77]} scale={[1.15,1,1.3]} geometry={geometries.head} material={material("#dcba9d")}/>
    {[-.71,.71].map(dx=><group key={dx}>
      <Part at={[dx,.93,.2]} size={[.055,.045,1.65]} color="#adbec9"/>
      {[-.6,.8].map(dz=><Part key={dz} at={[dx,.73,dz]} size={[.05,.43,.05]} color="#adbec9"/>)}
    </group>)}
    {[-1.43,1.43].map(dz=><Part key={dz} at={[0,.73,dz]} size={[1.5,.8,.09]} color="#d5e7e7" round/>)}
    {[-.55,.55].flatMap(dx=>[-1,1].map(dz=><mesh key={`${dx}-${dz}`} position={[dx,.18,dz]} rotation-z={Math.PI/2} scale={[.14,.08,.14]} geometry={geometries.cylinder} material={material("#5d747e")}/>))}
    <Part at={[1.1,.8,-.8]} size={[.65,1.6,.55]} color="#e2edee" round/>
    <Part at={[1.1,1.85,-.8]} size={[.75,.54,.09]} color="#466f7a" round/>
    <Part at={[1.1,1.85,-.856]} size={[.63,.41,.02]} color="#233f4d"/>
    {[-.22,-.1,0,.07,.17,.25].map((dx,i)=><Part key={dx} at={[1.1+dx,1.85+(i===2?.08:i===3?-.09:0),-.873]} size={[.08,i===2||i===3?.14:.025,.012]} color="#84e0b9"/>)}
    <Part at={[-1.1,1.1,-.7]} size={[.045,2.2,.045]} color="#92b0bb"/>
    <Part at={[-1.1,2,-.7]} size={[.5,.04,.04]} color="#92b0bb"/>
    <Part at={[-.92,1.79,-.7]} size={[.2,.3,.12]} color="#c1e7ea" round/>
  </group>;
}

function SupplyCabinet({x,label}:{x:number;label:string}){
  return <group position={[x,0,-10]}>
    <Part at={[0,1.25,0]} size={[2.8,2.5,1.15]} color="#f4f9f8" round/>
    <Part at={[0,1.36,.6]} size={[2.5,1.85,.08]} color="#b0ccc9"/>
    {[.64,1.22,1.8].map(y=><group key={y}>
      <Part at={[0,y,.72]} size={[2.5,.07,.55]} color="#e7f1ef"/>
      {[-.82,0,.82].map((dx,i)=><Part key={dx} at={[dx,y+.2,.71]} size={[.57,.35,.36]} color={i%2?"#c4ded5":"#88bfc0"} round/>)}
    </group>)}
    <HospitalSign text={label} at={[0,2.92,0]} width={3}/>
  </group>;
}

/** Visual handoff only; its progress comes from the calculated operation segment. */
function WardNurse({progress}:{progress:number|null}){
  const take=progress===null?0:smooth((progress-.2)/.4);
  const reach=progress===null?0:Math.sin(clamp(progress)*Math.PI);
  return <group position={[3.3,0,8.2]} rotation-y={-Math.PI/2}>
    {[-.1,.1].map(x=><mesh key={x} position={[x,.43,0]} scale={[1.1,1.08,1.1]} geometry={geometries.limb} material={material("#519f9c")}/>)}
    <mesh position={[0,1.12,0]} geometry={geometries.torso} material={material("#f5fcfb")} castShadow/>
    <mesh position={[0,1.68,0]} geometry={geometries.head} material={material("#dcba9d")}/>
    <Part at={[0,1.79,0]} size={[.29,.1,.27]} color="#65b4ab" round/>
    <Part at={[.09,1.28,.2]} size={[.09,.13,.02]} color="#219b87"/>
    {[-.26,.26].map(x=><group key={x} position={[x,1.4,0]} rotation-x={-.25-reach*1.1}>
      <mesh position={[0,-.27,0]} scale={[.86,.82,.86]} geometry={geometries.limb} material={material("#f5fcfb")}/>
    </group>)}
    {progress!==null&&progress>.52&&<Part at={[0,1.1,.4+.3*(1-take)]} size={[.52,.25,.4]} color="#91cdbc" round/>}
  </group>;
}

export function MedicalFacility({activity,scene,playing}:{activity:Map<number,WardActivity>;scene:SimulationSceneProfile;playing:boolean}){
  const supply=scene.cargo==='food'?'Питание':scene.cargo==='linen'?'Чистое бельё':scene.cargo==='waste'?'Закрытые контейнеры':'Медицинские грузы';
  return <group>
    <Part at={[0,-.006,0]} size={[90,.01,50]} color="#e8f0ec"/>
    <Part at={[2,.023,1.9]} size={[43,.025,8.1]} color="#e4efed"/>
    <Part at={[2,.042,4.7]} size={[42,.016,.12]} color="#7ebcb4"/>
    <Part at={[2,1.65,13]} size={[78,3.3,.25]} color="#f3f6f1"/>
    <Part at={[2,.5,12.83]} size={[78,1,.1]} color="#b1d2ca"/>
    {WARDS.map((x,i)=>{
      const state=activity.get(x);const open=smooth(state?.door??0);
      return <group key={x} position={[x,0,0]}>
        <Part at={[3.8,.06,9.5]} size={[8,.06,6.7]} color={i%2?'#e4efe6':'#e5eff1'}/>
        <Part at={[0,1.35,9.55]} size={[.17,2.7,6.7]} color="#d1e3de"/>
        <Part at={[5.1,1.8,12.8]} size={[3.5,1.7,.08]} color="#91c4d4"/>
        <Part at={[5.1,1.8,12.74]} size={[.06,1.7,.035]} color="#f4f9f9"/>
        <Part at={[5.1,1.8,12.74]} size={[3.5,.06,.035]} color="#f4f9f9"/>
        <Part at={[6.9,1.8,12.45]} size={[.45,2.1,.25]} color="#a8ccc4"/>
        <PatientBed x={5.2} z={9.8}/>
        {/* Low cutaway walls keep the bed and delivery visible from the corridor. */}
        <Part at={[.45,.48,6.3]} size={[.8,.96,.18]} color="#a5cfc7"/>
        <Part at={[5.6,.48,6.3]} size={[4.7,.96,.18]} color="#a5cfc7"/>
        {[.88,3.2].map(dx=><Part key={dx} at={[dx,1.42,6.3]} size={[.13,2.84,.24]} color="#88b6b1"/>)}
        <Part at={[2.04,2.83,6.3]} size={[2.47,.17,.24]} color="#88b6b1"/>
        <group position={[-open*2.12,0,0]}>
          <Part at={[2.04,1.34,6.27]} size={[2.16,2.66,.12]} color="#dbecea"/>
          <Part at={[2.04,1.85,6.19]} size={[1.42,.64,.04]} color="#94c3d0"/>
          <Part at={[2.9,1.13,6.18]} size={[.045,.32,.055]} color="#689a9d"/>
          <Cross at={[2.04,.85,6.18]} scale={.8}/>
        </group>
        <HospitalSign text={`Палата ${101+i}`} at={[2.04,3.35,6.3]} width={3}/>
        <Part at={[3.6,2.08,6.11]} size={[.22,.38,.06]} color={open>.1?'#48b897':'#809b9d'} round/>
        <WardNurse progress={state?.progress??null}/>
      </group>;
    })}
    <Part at={[2,.64,-11.3]} size={[78,1.28,.22]} color="#f2f6f3"/>
    <Part at={[2,.5,-11.15]} size={[78,1,.08]} color="#aed1c8"/>
    <Part at={[-14,1.55,-11.2]} size={[4,3.1,.16]} color="#d1e3de"/>
    <Part at={[-14,1.42,-11]} size={[3.2,2.84,.14]} color="#91abb6"/>
    <Part at={[-14,1.42,-10.9]} size={[.04,2.84,.04]} color="#e3ecee"/>
    <HospitalSign text="Лифты · этаж 1" at={[-14,3.15,-10.9]} width={3.4}/>
    <Part at={[-4,.63,-7.5]} size={[6.4,1.26,1.5]} color="#66a89f" round/>
    <Part at={[-4,1.29,-7.5]} size={[6.6,.1,1.6]} color="#eff8f5" round/>
    <Cross at={[-4,.7,-6.73]} scale={1.2}/>
    {[-5.4,-2.6].map(x=><group key={x}>
      <Part at={[x,1.48,-7.8]} size={[.11,.4,.1]} color="#839ba8"/>
      <Part at={[x,1.75,-7.8]} size={[.9,.58,.08]} color="#527e86" round/>
      <Part at={[x,1.75,-7.75]} size={[.76,.43,.018]} color="#a8dacc"/>
    </group>)}
    <HospitalSign text="Пост медсестры" at={[-4,3,-9.8]} width={4}/>
    <SupplyCabinet x={5} label={supply}/><SupplyCabinet x={11} label="Расходные материалы"/><SupplyCabinet x={18} label="Выдача роботу"/>
    {[-14.5,-13,-11.5].map(x=><group key={x}>
      <Part at={[x,.54,-4.2]} size={[1.1,.16,1]} color="#77ada9" round/>
      <Part at={[x,.95,-4.65]} size={[1.1,.8,.12]} color="#77ada9" round/>
      <Part at={[x,.25,-4.2]} size={[.1,.5,.6]} color="#90a7ad"/>
    </group>)}
    <HospitalSign text="Зарядка роботов" at={[-19,2.5,3]} width={3.3}/>
    <People animate={playing} medical layouts={STAFF} standing={[]}/>
    <People animate={playing} medical layouts={NO_WALKERS} standing={DESK_STAFF}/>
  </group>;
}

/** An illustrative removable medical module, mounted on the selected AMR base. */
export function MedicalCargo({baseHeight,state,progress,cargo}:{baseHeight:number;state:string;progress:number;cargo:string}){
  const working=state==='operation';
  const door=working?smooth(progress/.16)*(1-smooth((progress-.82)/.18)):0;
  const loaded=state==='outbound'||state==='station_queue'||state==='preparation'||(working&&progress<.55);
  return <group position={[0,baseHeight,0]}>
    <Part at={[-.07,.37,0]} size={[.72,.74,.72]} color="#f0f9f6" round/>
    <Part at={[.302,.36,0]} size={[.018,.55,.58]} color="#547b80"/>
    <group position={[.315,.36,-.32]} rotation-y={-door*1.55}>
      <Part at={[0,0,.32]} size={[.025,.61,.64]} color="#c2e4db" round/>
      <Part at={[.02,0,.57]} size={[.03,.2,.035]} color="#519e93"/>
    </group>
    {loaded&&<Part at={[.15+(working?smooth((progress-.18)/.34)*.65:0),.34,0]} size={[.46,.25,.42]} color={cargo==='food'?'#e4c6a0':'#90cdbb'} round/>}
    <Part at={[-.08,.62,.366]} size={[.32,.075,.02]} color="#269a85"/>
    <Part at={[-.08,.62,.367]} size={[.075,.32,.022]} color="#269a85"/>
    <Part at={[-.07,.76,0]} size={[.65,.05,.65]} color="#73b8ac" round/>
  </group>;
}
