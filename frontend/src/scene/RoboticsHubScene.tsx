import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3, type Group } from "three";
import { People } from "./People";
import type { StandingLayout, WalkerLayout, CellLayout } from "./layout";
import { geometries, material } from "./shared";
import { RoboticsHubSet } from "./RoboticsHubSet";
import { Manipulator } from "./Manipulator";
import { RobotModel } from "./robots/RobotModel";
import type { RobotKind } from "./robots/kinds";

const PEOPLE: WalkerLayout[] = [
  {path:[[-18,10.1],[18,10.1],[18,11.5],[-18,11.5]],speed:1.05,start:.05},
  {path:[[-18,10.1],[18,10.1],[18,11.5],[-18,11.5]],speed:.93,start:.4,carry:true,pauses:[0,2]},
  {path:[[-18,10.1],[18,10.1],[18,11.5],[-18,11.5]],speed:1.08,start:.72},
  {path:[[-12,5],[14,5],[14,5.6],[-12,5.6]],speed:.85,start:.15,carry:true,pauses:[0,1]},
  {path:[[-12,5],[14,5],[14,5.6],[-12,5.6]],speed:.95,start:.66,pauses:[0,2]},
  {path:[[-14,-6.4],[14,-6.4],[14,-6],[-14,-6]],speed:.9,start:.3},
];
const OPERATORS: StandingLayout[] = [{position:[-6,4.45],heading:Math.PI},{position:[6,4.45],heading:Math.PI},{position:[15.8,4.4],heading:Math.PI}];
const CELLS:CellLayout[]=[-9,3].map(x=>({base:[x,1],pick:[x-2.1,1],beltStart:[x-2.1,-2.6],pallet:[x+2.1,1]}));
// Скруглённые повороты: мобильные роботы не меняют направление рывком.
const TRACK=new CurvePath<Vector3>();
const point=(x:number,z:number)=>new Vector3(x,0,z);
TRACK.add(new LineCurve3(point(-15,-4.8),point(15,-4.8)));
TRACK.add(new QuadraticBezierCurve3(point(15,-4.8),point(17,-4.8),point(17,-2.8)));
TRACK.add(new LineCurve3(point(17,-2.8),point(17,5.2)));
TRACK.add(new QuadraticBezierCurve3(point(17,5.2),point(17,7.2),point(15,7.2)));
TRACK.add(new LineCurve3(point(15,7.2),point(-15,7.2)));
TRACK.add(new QuadraticBezierCurve3(point(-15,7.2),point(-17,7.2),point(-17,5.2)));
TRACK.add(new LineCurve3(point(-17,5.2),point(-17,-2.8)));
TRACK.add(new QuadraticBezierCurve3(point(-17,-2.8),point(-17,-4.8),point(-15,-4.8)));
const TRACK_LENGTH=TRACK.getLength();
const CAMERA = {position:[28,36,32] as [number,number,number],zoom:30,near:.1,far:220};
const GL = {antialias:true,alpha:true,powerPreference:'low-power' as const};

function Block({position,size,color='#c3d7ee'}:{position:[number,number,number];size:[number,number,number];color?:string}) {
  return <mesh position={position} scale={size} geometry={geometries.box} material={material(color)} castShadow receiveShadow/>;
}

function CameraRig({animate}:{animate:boolean}) {
  const {camera,size,invalidate}=useThree();
  const time=useRef(0);
  const target=useMemo(()=>new Vector3(),[]);
  const place=useCallback(()=>{
    const azimuth=.4+Math.sin(time.current*.035)*.027;
    target.set(size.width>900?1:3,0,-1.5);
    camera.position.set(target.x+42*Math.sin(azimuth),57,target.z+42*Math.cos(azimuth));
    camera.lookAt(target);
  },[camera,size.width,target]);
  useLayoutEffect(()=>{camera.zoom=Math.max(size.width/47,size.height/34);place();camera.updateProjectionMatrix();invalidate();},[camera,size,place,invalidate]);
  useFrame((_,dt)=>{if(animate){time.current+=Math.min(dt,.05);place();}});
  return null;
}

function MobileRobot({index,kind,animate}:{index:number;kind:RobotKind;animate:boolean}) {
  const root=useRef<Group>(null);
  const travel=useRef(index*.25);
  const direction=useMemo(()=>new Vector3(),[]);
  const position=useMemo(()=>new Vector3(),[]);
  const place=useCallback(()=>{
    if(!root.current)return;
    TRACK.getPointAt(travel.current%1,position);
    TRACK.getTangentAt(travel.current%1,direction);
    root.current.position.copy(position);
    root.current.rotation.y=Math.atan2(direction.x,direction.z)-Math.PI/2;
  },[position,direction]);
  useLayoutEffect(place,[place]);
  useFrame((_,dt)=>{if(animate){travel.current+=Math.min(dt,.05)*1.05/TRACK_LENGTH;place();}});
  return <group ref={root} dispose={null}>
    <RobotModel kind={kind} size={kind==='forklift'?{l:1.9,w:.9,h:2.1}:kind==='delivery'?{l:.7,w:.65,h:1.3}:{l:1.35,w:.95,h:.4}}/>
    {kind==='platform'&&<>
      <Block position={[0,.49,0]} size={[1.05,.12,.8]} color="#a2bbd8"/>
      <Block position={[-.23,.82,0]} size={[.42,.55,.62]} color="#e1eaf6"/>
      <Block position={[.23,.75,0]} size={[.4,.42,.6]} color="#b7cee8"/>
    </>}
  </group>;
}

function Hub({animate}:{animate:boolean}) {
  return <group dispose={null}>
    <RoboticsHubSet/>
    {CELLS.map((layout,i)=><Manipulator key={i} layout={layout} seed={230+i*71} animate={animate}/>)}
    <group position={[12,0,.5]}>
      <RobotModel kind="mobileArm" size={{l:1.4,w:1.05,h:1.9}} animate={animate}/>
      <Block position={[1.7,.6,0]} size={[1.6,.12,1.2]} color="#b0cbe9"/>
      <Block position={[1.7,.29,0]} size={[.9,.58,.7]} color="#c6d9ee"/>
      <Block position={[1.7,.95,0]} size={[.64,.58,.64]} color="#e5eef9"/>
    </group>
    <group position={[-14,0,12.2]}><RobotModel kind="cleaner" size={{l:1.1,w:.7,h:1.05}} tone="muted"/></group>
    {(['platform','forklift','platform','delivery'] as const).map((kind,index)=><MobileRobot key={index} index={index} kind={kind} animate={animate}/>)}
    <People animate={animate} layouts={PEOPLE} standing={OPERATORS}/>
  </group>;
}

/** Декоративный роботизированный логистический центр, независимый от расчётов проекта. */
export default function RoboticsHubScene({animate}:{animate:boolean}) {
  return <Canvas orthographic camera={CAMERA} gl={GL} dpr={[1,1.5]} flat shadows="percentage" frameloop={animate?'always':'demand'}>
    <CameraRig animate={animate}/>
    <fog attach="fog" args={['#e6effa',77,128]}/>
    <hemisphereLight args={['#f8fbff','#a6c1e2',1.65]}/>
    <directionalLight position={[-16,32,18]} intensity={2.4} castShadow shadow-mapSize={[2048,2048]} shadow-normalBias={.035} shadow-bias={-.0003} shadow-radius={3}>
      <orthographicCamera attach="shadow-camera" args={[-54,54,46,-46,1,150]}/>
    </directionalLight>
    <directionalLight position={[16,12,-18]} intensity={.45} color="#bfdcff"/>
    <Hub animate={animate}/>
  </Canvas>;
}
