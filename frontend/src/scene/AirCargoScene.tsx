import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef } from "react";
import { AirCargoSet } from "./AirCargoSet";
import { AirCargoTransfer } from "./AirCargoTransfer";
import { People } from "./People";
import type { WalkerLayout, StandingLayout } from "./layout";

const PEOPLE:WalkerLayout[]=[
  {path:[[-19,12.5],[19,12.5],[19,14],[-19,14]],speed:.9,start:.12},
  {path:[[-19,12.5],[19,12.5],[19,14],[-19,14]],speed:1,start:.66,carry:true,pauses:[0,2]},
];
const STAFF:StandingLayout[]=[{position:[-17,3.8],heading:Math.PI/2},{position:[18,3.8],heading:-Math.PI/2}];
const CAMERA={position:[22,39,45] as [number,number,number],zoom:30,near:.1,far:240};
const GL={antialias:true,alpha:true,powerPreference:'low-power' as const};

function Camera({animate}:{animate:boolean}) {
  const {camera,size,invalidate}=useThree();
  const time=useRef(0);
  const place=useCallback(()=>{
    const angle=.32+Math.sin(time.current*.026)*.024;
    camera.position.set(48*Math.sin(angle),47,48*Math.cos(angle)-3);
    camera.lookAt(0,1.4,-3);
  },[camera]);
  useLayoutEffect(()=>{camera.zoom=Math.max(size.width/49,size.height/37);place();camera.updateProjectionMatrix();invalidate();},[camera,size,place,invalidate]);
  useFrame((_,dt)=>{if(animate){time.current+=Math.min(dt,.05);place();}});
  return null;
}

/** Художественная сцена согласованной доставки; параметры расчётов проекта не использует. */
export default function AirCargoScene({animate}:{animate:boolean}) {
  return <Canvas orthographic camera={CAMERA} gl={GL} dpr={[1,1.5]} flat shadows="percentage" frameloop={animate?'always':'demand'}>
    <Camera animate={animate}/>
    <fog attach="fog" args={['#e6effa',80,140]}/>
    <hemisphereLight args={['#ffffff','#a9cddc',1.7]}/>
    <directionalLight position={[-16,30,20]} intensity={2.2} castShadow shadow-mapSize={[2048,2048]} shadow-normalBias={.025} shadow-bias={-.0003} shadow-radius={3}>
      <orthographicCamera attach="shadow-camera" args={[-48,48,45,-45,1,145]}/>
    </directionalLight>
    <directionalLight position={[20,15,-16]} intensity={.5} color="#c4e8ed"/>
    <group dispose={null}>
      <AirCargoSet/>
      {[-12,0,12].map((x,i)=><AirCargoTransfer key={x} x={x} phase={i*16+2} animate={animate}/>)}
      <People animate={animate} layouts={PEOPLE} standing={STAFF}/>
    </group>
  </Canvas>;
}
