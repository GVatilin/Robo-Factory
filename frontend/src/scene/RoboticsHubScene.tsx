import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { People } from "./People";
import type { StandingLayout, WalkerLayout } from "./layout";
import { geometries, material, seededRandom } from "./shared";
import { Walker } from "./walker";
import { RobotModel } from "./robots/RobotModel";
import type { RobotKind } from "./robots/kinds";

const PEOPLE: WalkerLayout[] = [
  {path:[[-16,8],[16,8],[16,10],[-16,10]],speed:1.05,start:.05},
  {path:[[-16,8],[16,8],[16,10],[-16,10]],speed:.9,start:.4,carry:true,pauses:[0,2]},
  {path:[[-16,8],[16,8],[16,10],[-16,10]],speed:1.12,start:.7},
  {path:[[-12,2],[12,2],[12,3],[-12,3]],speed:.85,start:.2,carry:true,pauses:[0,1]},
  {path:[[-12,2],[12,2],[12,3],[-12,3]],speed:.95,start:.7,pauses:[0,2]},
  {path:[[-12,-7],[12,-7],[12,-6.5],[-12,-6.5]],speed:.9,start:.3},
];
const OPERATORS: StandingLayout[] = [{position:[-9,1.4],heading:Math.PI},{position:[9,1.4],heading:Math.PI}];
const TRACK: WalkerLayout['path'] = [[-15,-4.5],[15,-4.5],[15,5.5],[-15,5.5]];
const CAMERA = {position:[28,36,32] as [number,number,number],zoom:30,near:.1,far:160};
const GL = {antialias:true,alpha:true,powerPreference:'low-power' as const};

function Block({position,size,color='#c3d7ee'}:{position:[number,number,number];size:[number,number,number];color?:string}) {
  return <mesh position={position} scale={size} geometry={geometries.box} material={material(color)} castShadow receiveShadow/>;
}

function CameraRig() {
  const {camera,size,invalidate}=useThree();
  useLayoutEffect(()=>{camera.zoom=Math.max(size.width/48,size.height/34);camera.lookAt(0,0,0);camera.updateProjectionMatrix();invalidate();},[camera,size,invalidate]);
  return null;
}

function MobileRobot({index,kind,animate}:{index:number;kind:RobotKind;animate:boolean}) {
  const root=useRef<Group>(null);
  const route=useMemo(()=>new Walker({path:TRACK,speed:1.05,start:index*.25,pauses:[0,2]},seededRandom(90+index)),[index]);
  const place=()=>{if(root.current){root.current.position.set(route.x,0,route.z);root.current.rotation.y=route.heading-Math.PI/2;}};
  useLayoutEffect(place);
  useFrame((_,dt)=>{if(animate){route.update(Math.min(dt,.05));place();}});
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
    <Block position={[0,-.24,0]} size={[38,.4,26]} color="#dbe7f5"/>
    <gridHelper args={[38,38,'#bfd3e9','#cbdcef']} position={[0,-.025,0]}/>
    {[-4.5,5.5].map(z=><Block key={z} position={[0,.005,z]} size={[31,.015,1.9]} color="#c5d9ef"/>)}
    {[-15,15].map(x=><Block key={x} position={[x,.005,.5]} size={[1.9,.015,11.5]} color="#c5d9ef"/>)}
    {[2.5,9].map(z=><Block key={z} position={[0,.007,z]} size={[34,.016,1.8]} color="#e9f0f9"/>)}
    {Array.from({length:26},(_,i)=><Block key={i} position={[-16+i*1.3,.025,7.9]} size={[.6,.025,.055]} color="#91b4dc"/>)}
    {[-11,-4,3,10].map(x=><group key={x} position={[x,0,-10]}>
      {[-2,2].flatMap(a=>[-.7,.7].map(z=><Block key={`${a}-${z}`} position={[a,1.5,z]} size={[.1,3,.1]} color="#8dadd4"/>))}
      {[.15,1.25,2.35].map((y,level)=><group key={y}>
        <Block position={[0,y,0]} size={[4.2,.08,1.6]} color="#abc5e5"/>
        {[-1.45,-.45,.6,1.5].map((a,i)=><Block key={a} position={[a,y+.37,0]} size={[.66,.65,1]} color={(i+level)%2?'#dce8f7':'#b7cde8'}/>)}
      </group>)}
    </group>)}
    {[-10,0,10].map((x,i)=><group key={x} position={[x,0,-.3]}>
      <Block position={[0,.02,0]} size={[5.5,.04,3]} color="#cadcf0"/>
      <group position={[-1,0,0]}><RobotModel kind="arm" size={{l:1,w:1,h:2}} animate={animate}/></group>
      <Block position={[1.3,.65,0]} size={[1.6,.16,1.1]} color="#a8c4e4"/>
      <Block position={[1.3,.31,0]} size={[.7,.62,.7]} color="#b8cee7"/>
      <Block position={[1.3,.98,0]} size={[.6,.5,.65]} color={i%2?'#dbe7f5':'#abc5e5'}/>
    </group>)}
    {(['platform','forklift','platform','delivery'] as const).map((kind,index)=><MobileRobot key={index} index={index} kind={kind} animate={animate}/>)}
    <People animate={animate} layouts={PEOPLE} standing={OPERATORS}/>
  </group>;
}

/** Декоративный роботизированный логистический центр, независимый от расчётов проекта. */
export default function RoboticsHubScene({animate}:{animate:boolean}) {
  return <Canvas orthographic camera={CAMERA} gl={GL} dpr={[1,1.25]} shadows frameloop={animate?'always':'demand'}>
    <CameraRig/>
    <hemisphereLight args={['#ffffff','#b9cde5',2]}/>
    <directionalLight position={[-12,26,15]} intensity={2} castShadow shadow-mapSize={[1024,1024]} shadow-normalBias={.04}>
      <orthographicCamera attach="shadow-camera" args={[-28,28,24,-24,1,75]}/>
    </directionalLight>
    <Hub animate={animate}/>
  </Canvas>;
}
