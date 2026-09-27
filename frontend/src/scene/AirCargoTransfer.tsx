import { useFrame } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Vector3, type Group, type Mesh } from "three";
import { geometries, material, wrapAngle } from "./shared";
import { RobotModel } from "./robots/RobotModel";

type Position = [number,number,number];
const UP = new Vector3(0,1,0);
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const ease=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
function between(a:Position,b:Position,t:number,lift=0):Position {
  const u=ease(t);
  return [mix(a[0],b[0],u),mix(a[1],b[1],u)+Math.sin(u*Math.PI)*lift,mix(a[2],b[2],u)];
}

/** Один цикл управляет дроном, грузом и роботом: передача без дублирования коробки. */
export function AirCargoTransfer({x,phase,animate}:{x:number;phase:number;animate:boolean}) {
  const elapsed=useRef(phase);
  const drone=useRef<Group>(null),robot=useRef<Group>(null),cargo=useRef<Group>(null),sling=useRef<Group>(null);
  const shoulder=useRef<Mesh>(null),forearm=useRef<Mesh>(null),elbowJoint=useRef<Mesh>(null),grip=useRef<Mesh>(null);
  const amber=useRef<Mesh>(null),green=useRef<Mesh>(null);
  const direction=useMemo(()=>new Vector3(),[]);
  const orient=useRef(0);
  const previous=useRef<Position|null>(null);
  const place=useCallback((dt=1/60)=>{
    const t=elapsed.current%48;
    if(!drone.current||!robot.current||!cargo.current)return;
    const origin:Position=[x-4,5.8,-18],supply:Position=[x-4,1.49,-18],high:Position=[x,5.8,0],low:Position=[x,1.525,0];
    let air:Position;
    if(t<8)air=between(origin,high,t/8,.5);
    else if(t<12)air=between(high,low,(t-8)/4);
    else if(t<14)air=low;
    else if(t<18)air=between(low,high,(t-14)/4);
    else if(t<27)air=between(high,origin,(t-18)/9,.7);
    else if(t<31)air=between(origin,supply,(t-27)/4);
    else if(t<46)air=supply;
    else air=between(supply,origin,(t-46)/2);
    drone.current.position.set(...air);
    drone.current.rotation.z=(t<8?-.065*Math.sin(Math.PI*t/8):t>=18&&t<27?.065*Math.sin(Math.PI*(t-18)/9):0);
    drone.current.rotation.y=.15;
    if(sling.current)sling.current.visible=t<12||t>=44;

    let ground:Position=[x,0,5];
    if(t>=18&&t<21)ground=between([x,0,5],[x,0,3.4],(t-18)/3);
    else if(t>=21&&t<26)ground=[x,0,3.4];
    else if(t>=26&&t<30)ground=between([x,0,3.4],[x+3,0,5.6],(t-26)/4);
    else if(t>=30&&t<33)ground=between([x+3,0,5.6],[x+3,0,7.1],(t-30)/3);
    else if(t>=33&&t<38)ground=[x+3,0,7.1];
    else if(t>=38&&t<42)ground=between([x+3,0,7.1],[x,0,7.1],(t-38)/4);
    else if(t>=42&&t<46)ground=between([x,0,7.1],[x,0,5],(t-42)/4);
    if(previous.current){
      const dx=ground[0]-previous.current[0],dz=ground[2]-previous.current[2];
      if(Math.hypot(dx,dz)>.00001)orient.current+=wrapAngle(Math.atan2(dx,dz)-Math.PI/2-orient.current)*Math.min(1,dt*8);
    }
    previous.current=ground;
    robot.current.position.set(...ground);
    // Поворот только шасси: установленная сверху рука ориентирует захват независимо.
    robot.current.rotation.y=orient.current;

    const deck:Position=[ground[0]+.15,.875,ground[2]];
    const pad:Position=[x,.775,0],shelf:Position=[x+3,.775,9];
    let box:Position;
    if(t<12)box=[air[0],air[1]-.75,air[2]];
    else if(t<22)box=pad;
    else if(t<25)box=between(pad,[x+.15,.875,3.4],(t-22)/3,1.05);
    else if(t<34)box=deck;
    else if(t<37)box=between([x+3+.15,.875,7.1],shelf,(t-34)/3,.9);
    else if(t<38)box=shelf;
    else if(t<44)box=between(shelf,[x+8,.775,9],(t-38)/6);
    else box=[air[0],air[1]-.75,air[2]];
    cargo.current.position.set(...box);
    cargo.current.visible=true;
    // Следующая посылка подаётся в удалённом доке; дрон поднимает её с площадки.
    cargo.current.scale.setScalar(t>=44&&t<45?ease(t-44):1);

    const base:Position=[ground[0]-.58,.53,ground[2]];
    const fold:Position=[ground[0]-.55,1.05,ground[2]+.2];
    const touch:Position=[box[0],box[1]+.37,box[2]];
    let target:Position=fold;
    if(t>=21&&t<22)target=between(fold,[x,1.145,0],t-21);
    else if(t>=22&&t<25)target=touch;
    else if(t>=25&&t<26)target=between(touch,fold,t-25);
    else if(t>=33&&t<34)target=between(fold,touch,t-33);
    else if(t>=34&&t<37)target=touch;
    else if(t>=37&&t<38)target=between(touch,fold,t-37);
    const elbow:Position=[base[0],Math.max(1.5,target[1]+.35),base[2]];
    function bone(mesh:Mesh|null,a:Position,b:Position){
      if(!mesh)return;
      direction.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
      const length=direction.length();
      mesh.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
      mesh.scale.set(.08,length,.08);mesh.quaternion.setFromUnitVectors(UP,direction.normalize());
    }
    bone(shoulder.current,base,elbow);bone(forearm.current,elbow,target);
    elbowJoint.current?.position.set(...elbow);grip.current?.position.set(...target);
    if(amber.current)amber.current.visible=t<18;
    if(green.current)green.current.visible=t>=18;
  },[x,direction]);
  useLayoutEffect(place,[place]);
  useFrame((_,dt)=>{if(animate){elapsed.current+=Math.min(dt,.05);place(Math.min(dt,.05));}});
  return <group dispose={null}>
    <group ref={drone}>
      <RobotModel kind="drone" size={{l:2.9,w:2.9,h:.85}} animate={animate}/>
      <group ref={sling}>{[-.24,.24].map(offset=><mesh key={offset} geometry={geometries.cylinder} material={material('#7e9cb4')} position={[offset,-.19,0]} scale={[.009,.48,.009]}/>)}</group>
    </group>
    <group ref={robot}>
      <RobotModel kind="platform" size={{l:1.7,w:1.2,h:.45}} animate={animate}/>
      <mesh geometry={geometries.roundedBox} material={material('#c7e1e7')} position={[0,.49,0]} scale={[1.5,.08,1.06]} receiveShadow/>
    </group>
    <mesh ref={shoulder} geometry={geometries.cylinder} material={material('#79a4b8')} castShadow/>
    <mesh ref={forearm} geometry={geometries.cylinder} material={material('#aecbd9')} castShadow/>
    <mesh ref={elbowJoint} geometry={geometries.head} material={material('#698fba')} scale={1.35} castShadow/>
    <mesh ref={grip} geometry={geometries.cylinder} material={material('#7399ab')} scale={[.24,.08,.24]} castShadow/>
    <group ref={cargo}>
      <mesh geometry={geometries.roundedBox} material={material('#d7bd96')} scale={[.72,.65,.62]} castShadow receiveShadow/>
      <mesh geometry={geometries.box} material={material('#b39c7b')} position={[0,.329,0]} scale={[.065,.009,.62]}/>
      <mesh geometry={geometries.box} material={material('#faf8ef')} position={[.07,.015,.313]} scale={[.29,.2,.007]}/>
      {[0,1,2,3,4].map(i=><mesh key={i} geometry={geometries.box} material={material('#7593a1')} position={[-.025+i*.034,.01,.318]} scale={[i%2?.009:.016,.085,.005]}/>)}
    </group>
    <mesh ref={amber} geometry={geometries.head} material={material('#d8b982')} position={[x+2.15,.9,1.8]} scale={.9}/>
    <mesh ref={green} geometry={geometries.head} material={material('#67b8b5')} position={[x+2.15,.9,1.8]} scale={.9}/>
  </group>;
}
