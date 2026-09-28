import {Canvas, useFrame, useThree} from "@react-three/fiber";
import {useCallback, useLayoutEffect, useMemo, type RefObject} from "react";
import {MathUtils, MeshStandardMaterial, Vector3, type OrthographicCamera} from "three";

import {CELLS} from "../../scene/layout";
import {Manipulator} from "../../scene/Manipulator";
import {palette} from "../../scene/palette";
import {People} from "../../scene/People";
import {RobotModel} from "../../scene/robots/RobotModel";
import {geometries, material} from "../../scene/shared";
import {SceneBoundary, supportsWebGL} from "../../scene/support";
import {Warehouse} from "../../scene/Warehouse";
import {createSimulationWarehouseLayout, type SimulationSceneOrder, type SimulationWarehouseLayout} from "./SimulationLayout";

export type SimulationSegment={state:string;start:number;end:number;phase_end?:number};
export type SimulationRobot={id:number;segments:SimulationSegment[]};
export type SimulationView="isometric"|"top";

type Point=[number,number];
type Pose={x:number;z:number;rotation:number;state:string};
type OrderLayout=SimulationWarehouseLayout&{cells:typeof CELLS};
type SceneProps={
  robots:SimulationRobot[];
  order:SimulationSceneOrder;
  time:number;
  duration:number;
  playing:boolean;
  view:SimulationView;
  activeRobot:number|null;
  onRobotSelect:(id:number)=>void;
  canvasRef:RefObject<HTMLCanvasElement|null>;
};

const CAMERA={position:[30,50,50] as [number,number,number],zoom:24,near:.1,far:400};
const GL={antialias:true,alpha:true,powerPreference:"high-performance" as const,preserveDrawingBuffer:true};
const VISIBLE_ROBOTS=18;
const ELEVATION=MathUtils.degToRad(58);
const AZIMUTH=MathUtils.degToRad(27);
const DISTANCE=82;
const CHARGER_Z=[3.5,5.25,7,8.75,10.5,12.25] as const;

const stateColors:Record<string,string>={
  preparation:"#42a779",outbound:"#2f79de",operation:"#1d9a68",return:"#57a7d9",
  station_queue:"#e59a39",charger_queue:"#dc665b",charging:"#8b6bd2",downtime:"#8998aa",idle:"#9aa9ba",
};

const routeMaterial=new MeshStandardMaterial({color:"#78a3e0",roughness:.82,metalness:0});
const sourceZoneMaterial=new MeshStandardMaterial({color:"#d4e5f8",roughness:.95,transparent:true,opacity:.74});
const chargingZoneMaterial=new MeshStandardMaterial({color:"#e2d9f4",roughness:.95,transparent:true,opacity:.8});

function createOrderLayout(order:SimulationSceneOrder):OrderLayout{
  const layout=createSimulationWarehouseLayout(order);
  return {...layout,cells:Array.from({length:layout.cellCount},(_,index)=>CELLS[(layout.cellOffset+index)%CELLS.length])};
}

function currentSegment(segments:SimulationSegment[],time:number){
  let low=0,high=segments.length-1;
  while(low<=high){
    const mid=(low+high)>>1;
    const segment=segments[mid];
    if(time<segment.start)high=mid-1;
    else if(time>=segment.end)low=mid+1;
    else return segment;
  }
  return undefined;
}

function homePoint(index:number,layout:OrderLayout):Point{
  const spacing=16/Math.max(1,layout.homeColumns-1);
  return [4+(index%layout.homeColumns)*spacing,-4.5-Math.floor(index/layout.homeColumns)*1.15];
}

function pathPoint(points:Point[],progress:number){
  const lengths=points.slice(1).map((point,index)=>Math.hypot(point[0]-points[index][0],point[1]-points[index][1]));
  const total=lengths.reduce((sum,length)=>sum+length,0);
  let distance=Math.min(1,Math.max(0,progress))*total;
  for(let index=0;index<lengths.length;index++){
    const length=lengths[index];
    if(distance<=length||index===lengths.length-1){
      const ratio=length?distance/length:0;
      const from=points[index],to=points[index+1];
      return {x:from[0]+(to[0]-from[0])*ratio,z:from[1]+(to[1]-from[1])*ratio,rotation:Math.atan2(to[1]-from[1],to[0]-from[0])};
    }
    distance-=length;
  }
  return {x:points[0][0],z:points[0][1],rotation:0};
}

function robotPose(robot:SimulationRobot,time:number,duration:number,layout:OrderLayout):Pose{
  const segment=currentSegment(robot.segments,Math.min(time,Math.max(0,duration-.0001)));
  const state=segment?.state??"idle";
  const phaseEnd=segment?.phase_end??segment?.end??1;
  const progress=segment?Math.min(1,Math.max(0,(time-segment.start)/Math.max(.001,phaseEnd-segment.start))):0;
  const index=robot.id-1;
  const home=homePoint(index,layout);
  const cell=layout.cells[index%layout.cells.length];
  const operation:Point=[cell.pallet[0],5.15+(Math.floor(index/layout.cells.length)%2)*.62];
  if(state==="outbound"){
    const pose=pathPoint([home,[home[0],-.55],[cell.base[0]+.5,-.55],[cell.base[0]+.5,3.4],operation],progress);
    return {...pose,state};
  }
  if(state==="return"){
    const pose=pathPoint([operation,[cell.base[0]-.35,3.8],[cell.base[0]-.35,1.15],[home[0],1.15],home],progress);
    return {...pose,state};
  }
  if(state==="operation")return {x:operation[0],z:operation[1],rotation:Math.PI/2,state};
  if(state==="station_queue"){
    const order=Math.floor(index/layout.cells.length)%5;
    return {x:cell.base[0]+.65+(order-2)*.72,z:3.35+(order%2)*.58,rotation:Math.PI/2,state};
  }
  if(state==="charging"){
    const charger=index%layout.chargerCount;
    return {x:-18.55,z:CHARGER_Z[charger],rotation:Math.PI/2,state};
  }
  if(state==="charger_queue"){
    const queue=index%layout.chargerCount;
    return {x:-16.8+Math.floor(index/layout.chargerCount)*.8,z:CHARGER_Z[queue],rotation:Math.PI,state};
  }
  return {x:home[0],z:home[1],rotation:state==="preparation"?Math.PI:Math.PI/2,state};
}

function Block({position,size,color="#c5d8ef",rounded=false}:{position:[number,number,number];size:[number,number,number];color?:string;rounded?:boolean}){
  return <mesh position={position} scale={size} geometry={rounded?geometries.roundedBox:geometries.box} material={material(color)} castShadow receiveShadow/>;
}

function Arrow({x,z,rotation=0}:{x:number;z:number;rotation?:number}){
  return <group position={[x,.045,z]} rotation-y={rotation}>
    <mesh position={[.19,0,.16]} rotation-y={Math.PI/4} scale={[.36,.025,.075]} geometry={geometries.box} material={routeMaterial}/>
    <mesh position={[.19,0,-.16]} rotation-y={-Math.PI/4} scale={[.36,.025,.075]} geometry={geometries.box} material={routeMaterial}/>
  </group>;
}

function RouteMarkings({layout}:{layout:OrderLayout}){
  return <group>
    {Array.from({length:29},(_,index)=><mesh key={`out-${index}`} position={[-18.2+index*1.3,.03,-.55]} scale={[.78,.02,.1]} geometry={geometries.box} material={routeMaterial}/>) }
    {Array.from({length:29},(_,index)=><mesh key={`back-${index}`} position={[18.2-index*1.3,.03,1.15]} scale={[.78,.02,.1]} geometry={geometries.box} material={routeMaterial}/>) }
    {layout.cells.map(cell=><group key={cell.base[0]}>{Array.from({length:5},(_,index)=><mesh key={index} position={[cell.base[0]+.5,.03,2.75+index*.68]} scale={[.1,.02,.38]} geometry={geometries.box} material={routeMaterial}/>)}</group>)}
    {[-11,0,11].map(x=><Arrow key={`out-${x}`} x={x} z={-.55} rotation={Math.PI}/>)}
    {[-11,0,11].map(x=><Arrow key={`back-${x}`} x={x} z={1.15}/>)}
  </group>;
}

function SourceZone(){
  return <group>
    <mesh position={[11.5,.018,-5.25]} scale={[18.8,.025,4.5]} geometry={geometries.roundedBox} material={sourceZoneMaterial} receiveShadow/>
    {[3,20].map(x=><group key={x} position={[x,0,-3.15]}>
      <Block position={[0,.7,0]} size={[.16,1.4,.16]} color="#7fa7da" rounded/>
      <Block position={[0,1.34,0]} size={[.58,.13,.3]} color="#dce8f7" rounded/>
      <mesh position={[0,1.35,.17]} scale={[.09,.04,.03]} geometry={geometries.box} material={material("#5e91d6")}/>
    </group>)}
  </group>;
}

function ChargingZone({layout}:{layout:OrderLayout}){
  const chargers=CHARGER_Z.slice(0,layout.chargerCount);
  const center=(chargers[0]+chargers[chargers.length-1])/2;
  const depth=chargers[chargers.length-1]-chargers[0]+1.55;
  return <group>
    <mesh position={[-19,.018,center]} scale={[3.3,.025,depth]} geometry={geometries.roundedBox} material={chargingZoneMaterial} receiveShadow/>
    {chargers.map(z=><group key={z} position={[-19.2,0,z]}>
      <Block position={[0,.04,0]} size={[1.3,.08,1.25]} color="#bdaee0" rounded/>
      <Block position={[-.52,.73,0]} size={[.22,1.46,.5]} color="#8f76c1" rounded/>
      <Block position={[-.39,.86,0]} size={[.035,.22,.22]} color="#f0ebfa" rounded/>
      <mesh position={[-.36,1.18,0]} scale={[.42,.42,.42]} geometry={geometries.head} material={material("#6f9edc")}/>
    </group>)}
  </group>;
}

function SimulationInfrastructure({layout}:{layout:OrderLayout}){
  return <group><SourceZone/><ChargingZone layout={layout}/><RouteMarkings layout={layout}/></group>;
}

function Robot({robot,time,duration,playing,active,layout,onSelect}:{robot:SimulationRobot;time:number;duration:number;playing:boolean;active:boolean;layout:OrderLayout;onSelect:(id:number)=>void}){
  const pose=robotPose(robot,time,duration,layout);
  const moving=pose.state==="outbound"||pose.state==="return";
  return <group position={[pose.x,.075,pose.z]} rotation-y={-pose.rotation} onClick={event=>{event.stopPropagation();onSelect(robot.id);}}>
    <mesh position={[0,-.03,0]} scale={[active ? .82 : .68,.04,active ? .82 : .68]} geometry={geometries.cylinder} material={material(stateColors[pose.state]??stateColors.idle)} receiveShadow/>
    <group scale={active?1.1:1}>
      <RobotModel kind="platform" size={{l:1.15,w:.76,h:.3}} tone={active?"highlight":pose.state==="idle"||pose.state==="downtime"?"muted":"default"} animate={playing&&moving}/>
      <Block position={[-.1,.46,0]} size={[.62,.27,.5]} color="#edf3fb" rounded/>
      <Block position={[.33,.46,0]} size={[.2,.27,.5]} color="#adc6e4" rounded/>
    </group>
  </group>;
}

function CameraRig({view,animate,width,depth}:{view:SimulationView;animate:boolean;width:number;depth:number}){
  const camera=useThree(state=>state.camera) as OrthographicCamera;
  const size=useThree(state=>state.size);
  const invalidate=useThree(state=>state.invalidate);
  const target=useMemo(()=>new Vector3(0,0,0),[]);
  const place=useCallback((azimuth:number)=>{
    if(view==="top"){
      camera.position.set(target.x,82,target.z+.01);
      camera.up.set(0,0,-1);
    }else{
      const horizontal=DISTANCE*Math.cos(ELEVATION);
      camera.position.set(target.x+horizontal*Math.sin(azimuth),DISTANCE*Math.sin(ELEVATION),target.z+horizontal*Math.cos(azimuth));
      camera.up.set(0,1,0);
    }
    camera.lookAt(target);
  },[camera,target,view]);
  useLayoutEffect(()=>{
    camera.zoom=Math.max(8,Math.min(size.width/(width+(view==="top"?3:8)),size.height/(depth+(view==="top"?3:6))));
    place(AZIMUTH);camera.updateProjectionMatrix();invalidate();
  },[camera,depth,invalidate,place,size.height,size.width,view,width]);
  useFrame(({clock})=>{if(animate&&view==="isometric")place(AZIMUTH+Math.sin(clock.elapsedTime*.09)*.035);});
  return null;
}

function Lights(){
  return <>
    <hemisphereLight args={["#ffffff","#b6cef1",1.75]}/>
    <directionalLight position={[-16,30,14]} intensity={2.2} castShadow shadow-mapSize={[2048,2048]} shadow-bias={-.0004} shadow-normalBias={.03} shadow-radius={3}>
      <orthographicCamera attach="shadow-camera" args={[-30,30,30,-30,1,90]}/>
    </directionalLight>
    <directionalLight position={[20,14,-18]} intensity={.28} color="#c7ddfb"/>
  </>;
}

function Scene({robots,order,time,duration,playing,view,activeRobot,onRobotSelect}:Omit<SceneProps,"canvasRef">){
  const layout=useMemo(()=>createOrderLayout(order),[order]);
  const sampleTime=Math.min(time,Math.max(0,duration-.0001));
  const activeCells=new Set(robots.filter(robot=>currentSegment(robot.segments,sampleTime)?.state==="operation").map(robot=>(robot.id-1)%layout.cells.length));
  return <>
    <color attach="background" args={[palette.background]}/>
    <fog attach="fog" args={[palette.background,78,132]}/>
    <CameraRig view={view} animate={playing} width={layout.width} depth={layout.depth}/>
    <Lights/>
    <Warehouse seed={layout.seed} occupancy={layout.occupancy} dockCount={layout.dockCount} rackRows={layout.rackRows} width={layout.width} depth={layout.depth}/>
    <SimulationInfrastructure layout={layout}/>
    {layout.cells.map((cell,index)=><Manipulator key={`${cell.base[0]}-${index}`} layout={cell} seed={layout.seed+index*17} animate={playing&&activeCells.has(index)}/>) }
    <People animate={playing}/>
    {robots.slice(0,VISIBLE_ROBOTS).map(robot=><Robot key={robot.id} robot={robot} time={time} duration={duration} playing={playing} active={robot.id===activeRobot} layout={layout} onSelect={onRobotSelect}/>) }
  </>;
}

function StaticFallback(){
  return <div className="simulation-scene__fallback" role="img" aria-label="Упрощённая схема объекта">
    <div><span>Выдача заданий</span><i/></div><div><span>Маршрут</span><i/></div><div><span>Операции</span><i/></div><div><span>Зарядка</span><i/></div>
  </div>;
}

export default function SimulationScene3D(props:SceneProps){
  if(!supportsWebGL())return <StaticFallback/>;
  return <SceneBoundary fallback={<StaticFallback/>}>
    <Canvas orthographic flat shadows="percentage" dpr={[1,1.6]} camera={CAMERA} gl={GL} frameloop={props.playing?"always":"demand"}
      onCreated={({gl})=>{props.canvasRef.current=gl.domElement;}} onPointerMissed={()=>props.onRobotSelect(0)}>
      <Scene {...props}/>
    </Canvas>
  </SceneBoundary>;
}
