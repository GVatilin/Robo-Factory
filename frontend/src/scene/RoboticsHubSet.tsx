import { useLayoutEffect, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import { geometries, material, seededRandom } from "./shared";

type Part = {p:[number,number,number];s:[number,number,number];color:string};
const architecture:Part[]=[], details:Part[]=[], markings:Part[]=[], distant:Part[]=[];
function add(target:Part[],p:Part['p'],s:Part['s'],color:string) { target.push({p,s,color}); }
const random=seededRandom(840);

// Пол и сетка продолжаются далеко за любой размер кадра; бортиков и подиума нет.
const EXTENT=128;
for(let x=-EXTENT;x<=EXTENT;x+=2) add(markings,[x,-.008,0],[.012,.008,EXTENT*2],'#cbd9ed');
for(let z=-EXTENT;z<=EXTENT;z+=2) add(markings,[0,-.008,z],[EXTENT*2,.008,.012],'#cbd9ed');
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
// Продольные маршруты соединяют участки большого цеха. Пешеходный проход
// отделён от роботов; дополнительные полосы не пересекают стеллажи.
for(let row=-3;row<=3;row++) {
  const oz=row*32;
  for(const z of [-4.8,7.2]) {
    add(markings,[0,.012,z+oz],[EXTENT*2,.014,2],'#c5d9ed');
    for(let x=-EXTENT;x<=EXTENT;x+=1.4)add(markings,[x,.026,z+oz],[.55,.01,.055],'#edf5ff');
  }
  for(let column=-2;column<=2;column++)for(const x of [-17,17]) {
    add(markings,[column*44+x,.012,1.2+oz],[2,.014,12],'#c5d9ed');
  }
  add(markings,[0,.015,10.5+oz],[EXTENT*2,.018,2.4],'#edf3fb');
  for(let x=-EXTENT;x<=EXTENT;x+=1.2)add(markings,[x,.03,9.15+oz],[.55,.012,.065],'#96b9d7');
}
// Островки паллетизации, ограждения и панели управления.
for(const x of [-9,3,13]) {
  add(architecture,[x,.014,.8],[7,.025,7.3],'#d1e1f2');
  for(const dx of [-3.5,3.5])add(details,[x+dx,.035,.8],[.035,.02,7.3],'#a2bfdc');
  add(details,[x+2.9,.59,3.9],[.1,1.18,.1],'#8baed6');
  add(details,[x+2.9,1.2,3.9],[.55,.38,.12],'#8aa8cd');
  add(details,[x+2.9,1.22,3.98],[.43,.25,.018],'#d4edf4');
  add(details,[x+2.9,1.3,4],[.28,.023,.012],'#7db7c8');
}
// Зарядная станция у пешеходного прохода.
for(const x of [-14,-11,-8]) {
  add(details,[x,.03,12],[2,.04,1.4],'#bdd4ec');
  add(details,[x,.38,12.5],[1.2,.72,.28],'#c5d9f1');
  add(details,[x,.52,12.66],[.6,.16,.035],'#799fcf');
  add(details,[x+.35,.8,12.5],[.07,.1,.07],'#7db5bd');
}

// Соседние участки продолжают цех во все стороны. Геометрия собирается один раз
// в инстансы; за пределами ближайших участков убраны мелкие детали и тени.
// Живые манипуляторы и люди остаются только в основном участке сцены.
const bayArchitecture=[...architecture], bayDetails=[...details];
for(let column=-2;column<=2;column++)for(let row=-2;row<=2;row++) {
  if(column===0&&row===0)continue;
  const ox=column*44,oz=row*32;
  const near=Math.abs(column)<=1&&Math.abs(row)<=1;
  const structureTarget=near?architecture:distant;
  const detailTarget=near?details:distant;
  for(const part of bayArchitecture) {
    add(structureTarget,[part.p[0]+ox,part.p[1],part.p[2]+oz],part.s,part.color);
  }
  for(const part of bayDetails) {
    if(!near&&(part.s[1]<.1||part.s[2]<.04))continue;
    add(detailTarget,[part.p[0]+ox,part.p[1],part.p[2]+oz],part.s,part.color);
  }
  // Статичные упаковочные столы: дополнительные рабочие места без новых
  // анимированных роботов и расчётов на каждом кадре.
  for(const x of [-9,3,13]) {
    add(structureTarget,[x+ox,.86,oz+.8],[3.8,.16,1.8],'#c2d6ed');
    for(const dx of [-1.6,1.6])for(const dz of [-.65,.65]) {
      add(structureTarget,[x+ox+dx,.4,oz+.8+dz],[.12,.8,.12],'#98b7dc');
    }
    add(detailTarget,[x+ox-.7,1.25,oz+.8],[.75,.62,.72],'#e4edf9');
    add(detailTarget,[x+ox+.55,1.15,oz+.8],[.7,.42,.62],'#bed3ec');
    add(detailTarget,[x+ox+1.4,1.35,oz+.1],[.48,.55,.09],'#8fabcf');
    if(near) {
      add(detailTarget,[x+ox+1.4,1.37,oz+.155],[.38,.39,.02],'#d5edf6');
      add(detailTarget,[x+ox-.6,1.22,oz+1.17],[.26,.18,.014],'#f9fbff');
    }
  }
}

function Batch({parts,castShadows=true,receiveShadows=true}:{parts:Part[];castShadows?:boolean;receiveShadows?:boolean}) {
  const ref=useRef<InstancedMesh>(null);
  useLayoutEffect(()=>{
    if(!ref.current)return;
    const pose=new Object3D(),color=new Color();
    parts.forEach((part,i)=>{pose.position.set(...part.p);pose.scale.set(...part.s);pose.updateMatrix();ref.current!.setMatrixAt(i,pose.matrix);ref.current!.setColorAt(i,color.set(part.color));});
    ref.current.instanceMatrix.needsUpdate=true;
    if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;
    ref.current.computeBoundingSphere();
  },[parts]);
  return <instancedMesh ref={ref} args={[geometries.box,material('#ffffff'),parts.length]} castShadow={castShadows} receiveShadow={receiveShadows} dispose={null}/>;
}

export function RoboticsHubSet() {
  return <group>
    <mesh geometry={geometries.box} material={material('#e1eaf6')} position={[0,-.03,0]} scale={[512,.02,512]} receiveShadow/>
    <Batch parts={markings} castShadows={false}/>
    <Batch parts={architecture}/>
    <Batch parts={details}/>
    <Batch parts={distant} castShadows={false} receiveShadows={false}/>
  </group>;
}
