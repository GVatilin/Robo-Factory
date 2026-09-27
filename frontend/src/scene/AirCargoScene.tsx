import { Canvas, useThree } from "@react-three/fiber";
import { useLayoutEffect } from "react";
import { AirCargoSet } from "./AirCargoSet";
import { AirCargoTransfer } from "./AirCargoTransfer";
import { People } from "./People";
import type { WalkerLayout, StandingLayout } from "./layout";

const PEOPLE:WalkerLayout[]=[
  {path:[[-19,12.5],[19,12.5],[19,14],[-19,14]],speed:.9,start:.12},
  {path:[[-19,12.5],[19,12.5],[19,14],[-19,14]],speed:1,start:.66,carry:true,pauses:[0,2]},
];
const STAFF:StandingLayout[]=[{position:[-17,3.8],heading:Math.PI/2},{position:[18,3.8],heading:-Math.PI/2}];
const CAMERA={position:[22,39,45] as [number,number,number],zoom:30,near:1,far:200};
const GL={antialias:true,alpha:true,powerPreference:'default' as const};

function Camera() {
  const {camera,size,invalidate}=useThree();
  useLayoutEffect(()=>{
    // The vehicles provide motion; a fixed viewpoint keeps fine markings stable.
    const angle=.32;
    camera.zoom=Math.max(size.width/49,size.height/37);
    camera.position.set(48*Math.sin(angle),47,48*Math.cos(angle)-3);
    camera.lookAt(0,1.4,-3);
    camera.updateProjectionMatrix();
    invalidate();
  },[camera,size.width,size.height,invalidate]);
  return null;
}

/** Художественная сцена согласованной доставки; параметры расчётов проекта не использует. */
export default function AirCargoScene({animate}:{animate:boolean}) {
  return <Canvas orthographic camera={CAMERA} gl={GL} dpr={1} flat shadows="percentage" frameloop={animate?'always':'demand'}>
    <Camera/>
    <fog attach="fog" args={['#e6effa',80,140]}/>
    <hemisphereLight args={['#ffffff','#a9cddc',1.7]}/>
    <directionalLight position={[-16,30,20]} intensity={2.2} castShadow shadow-mapSize={[1024,1024]} shadow-normalBias={.025} shadow-bias={-.0003} shadow-radius={2}>
      <orthographicCamera attach="shadow-camera" args={[-35,35,32,-32,1,110]}/>
    </directionalLight>
    <directionalLight position={[20,15,-16]} intensity={.5} color="#c4e8ed"/>
    <group dispose={null}>
      <AirCargoSet/>
      {[-12,0,12].map((x,i)=><AirCargoTransfer key={x} x={x} phase={i*16+2} animate={animate}/>)}
      <People animate={animate} layouts={PEOPLE} standing={STAFF}/>
    </group>
  </Canvas>;
}
