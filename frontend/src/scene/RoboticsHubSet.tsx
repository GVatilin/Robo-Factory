import { useLayoutEffect, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import { geometries, material, seededRandom } from "./shared";

type Part = {p:[number,number,number];s:[number,number,number];color:string};
const architecture:Part[]=[], details:Part[]=[];
function add(target:Part[],p:Part['p'],s:Part['s'],color:string) { target.push({p,s,color}); }
const random=seededRandom(840);

// Архитектурный макет: открытый фасад, доки и светлая промышленная плитка.
add(architecture,[0,-.3,-1],[42,.55,29],'#c5d8ef');
add(architecture,[0,-.04,-1],[41.6,.04,28.6],'#e1eaf6');
add(architecture,[0,.12,-15.2],[42,.3,.3],'#a7c2e4');
add(architecture,[-20.8,.16,-1],[.22,.4,28.5],'#b1c9e8');
for(let x=-20;x<=20;x+=2) add(details,[x,-.008,-1],[.012,.008,28],'#cbd9ed');
for(let z=-14;z<=12;z+=2) add(details,[0,-.008,z],[41,.008,.012],'#cbd9ed');
// Низкая задняя стена с воротами и ритмом белых опор.
for(let i=0;i<6;i++) {
  const x=-17.5+i*7;
  add(architecture,[x,1.75,-14.6],[6.7,3.5,.25],'#d5e3f4');
  add(architecture,[x,1.5,-14.42],[3.6,2.8,.08],'#b9cfe9');
  add(architecture,[x,2.96,-14.31],[3.7,.12,.1],'#94b4de');
  add(architecture,[x,3.5,-14.5],[6.9,.13,.5],'#eff5fc');
  for(let y=.35;y<2.8;y+=.32) add(details,[x,y,-14.35],[3.4,.022,.02],'#dce8f7');
  for(const side of [-1,1]) {
    add(architecture,[x+side*1.98,1.55,-14.25],[.14,3.1,.24],'#89addb');
    add(details,[x+side*2.32,.42,-13.95],[.15,.84,.15],'#87accb');
  }
  add(details,[x+1.53,3.23,-14.29],[.24,.09,.035],'#72b9bc');
}
// Высокие полочные стеллажи с неодинаковым заполнением и наклейками на коробках.
for(const x of [-15.5,-9,-2.5]) for(const z of [-11.5,-8.3]) {
  for(const dx of [-2.45,2.45]) for(const dz of [-.7,.7]) add(architecture,[x+dx,1.75,z+dz],[.085,3.5,.085],'#82a6d3');
  for(const y of [.13,1.2,2.27,3.34]) {
    add(architecture,[x,y,z],[5,.065,1.65],'#b3cce9');
    for(const dz of [-.79,.79]) add(details,[x,y-.03,z+dz],[5,.13,.035],'#8dacd6');
    if(y>3)continue;
    for(let j=0;j<5;j++) {
      if(random()<.18)continue;
      const h=.4+random()*.44,xx=x-1.95+j*.98;
      const tint=['#edf3fb','#dce8f7','#c9dbef'][j%3];
      add(details,[xx,y+h/2+.04,z],[.68,h,1.05],tint);
      add(details,[xx+.1,y+h*.55,z+.532],[.21,.15,.012],'#f9fbff');
      add(details,[xx-.17,y+h+.046,z],[.065,.012,1.06],'#aac2df');
    }
  }
}
// Зона комплектации и готовые к отправке паллеты.
for(const x of [6,10.4,14.8])for(const z of [-11.5,-8.5]) {
  add(details,[x,.13,z],[1.6,.14,1.35],'#abc3e2');
  for(const dx of [-.55,0,.55])add(details,[x+dx,.04,z],[.14,.1,1.3],'#a0badb');
  for(let layer=0;layer<2;layer++)for(const dx of [-.36,.36])for(const dz of [-.3,.3]) {
    add(details,[x+dx,.43+layer*.5,z+dz],[.63,.48,.5],layer?'#d3e2f4':'#c1d5ee');
    add(details,[x+dx,.43+layer*.5,z+dz+.255],[.2,.12,.012],'#f4f8fd');
  }
}
// Полосы движения: роботы по внешнему контуру, люди по светлому переднему проходу.
for(const z of [-4.8,7.2]) {
  add(architecture,[0,.012,z],[35,.014,2],'#c5d9ed');
  for(let x=-15;x<=15;x+=1.4)add(details,[x,.026,z],[.55,.01,.055],'#edf5ff');
}
for(const x of [-17,17])add(architecture,[x,.012,1.2],[2,.014,12],'#c5d9ed');
add(architecture,[0,.015,10.5],[38,.018,2.4],'#edf3fb');
for(let x=-18;x<=18;x+=1.2)add(details,[x,.03,9.15],[.55,.012,.065],'#96b9d7');
// Островки паллетизации, ограждения и панели управления.
for(const x of [-9,3,13]) {
  add(architecture,[x,.014,.8],[7,.025,7.3],'#d1e1f2');
  for(const dx of [-3.5,3.5])add(details,[x+dx,.035,.8],[.035,.02,7.3],'#a2bfdc');
  add(details,[x+2.9,.59,3.9],[.1,1.18,.1],'#8baed6');
  add(details,[x+2.9,1.2,3.9],[.55,.38,.12],'#8aa8cd');
  add(details,[x+2.9,1.22,3.98],[.43,.25,.018],'#d4edf4');
  add(details,[x+2.9,1.3,4],[.28,.023,.012],'#7db7c8');
}
// Зарядная станция и небольшая зона оборудования у открытого фасада.
for(const x of [-14,-11,-8]) {
  add(details,[x,.03,12],[2,.04,1.4],'#bdd4ec');
  add(details,[x,.38,12.5],[1.2,.72,.28],'#c5d9f1');
  add(details,[x,.52,12.66],[.6,.16,.035],'#799fcf');
  add(details,[x+.35,.8,12.5],[.07,.1,.07],'#7db5bd');
}

function Batch({parts}:{parts:Part[]}) {
  const ref=useRef<InstancedMesh>(null);
  useLayoutEffect(()=>{
    if(!ref.current)return;
    const pose=new Object3D(),color=new Color();
    parts.forEach((part,i)=>{pose.position.set(...part.p);pose.scale.set(...part.s);pose.updateMatrix();ref.current!.setMatrixAt(i,pose.matrix);ref.current!.setColorAt(i,color.set(part.color));});
    ref.current.instanceMatrix.needsUpdate=true;
    if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;
    ref.current.computeBoundingSphere();
  },[parts]);
  return <instancedMesh ref={ref} args={[geometries.box,material('#ffffff'),parts.length]} castShadow receiveShadow dispose={null}/>;
}

export function RoboticsHubSet() {
  return <group><Batch parts={architecture}/><Batch parts={details}/></group>;
}
