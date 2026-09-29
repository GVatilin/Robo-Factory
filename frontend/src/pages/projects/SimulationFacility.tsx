import {geometries,material} from "../../scene/shared";
import {RobotModel} from "../../scene/robots/RobotModel";
import type {WalkerLayout} from "../../scene/layout";

export const FACILITY_WALKERS:WalkerLayout[]=[
  {path:[[-14,2.3],[19,2.3],[19,2.9],[-14,2.9]],speed:.9,start:.15},
  {path:[[-14,2.3],[19,2.3],[19,2.9],[-14,2.9]],speed:1.1,start:.65},
  {path:[[2,-7],[20,-7],[20,-7.7],[2,-7.7]],speed:.8,start:.4,carry:true},
];
function Block({at,size,color}:{at:[number,number,number];size:[number,number,number];color:string}){
 return <mesh position={at} scale={size} geometry={geometries.box} material={material(color)} castShadow receiveShadow/>;
}
function Cross({x,y,z}:{x:number;y:number;z:number}){return <group position={[x,y,z]}><Block at={[0,0,0]} size={[.7,.2,.04]} color="#3da798"/><Block at={[0,0,0]} size={[.2,.7,.05]} color="#3da798"/></group>;}
export function FacilityFloor({width,depth}:{width:number;depth:number}){
 return <group><Block at={[0,-.22,0]} size={[width,.42,depth]} color="#e5eef4"/><Block at={[0,.003,.3]} size={[width-1,.01,4.5]} color="#d2e6ec"/>
 {Array.from({length:13},(_,i)=><Block key={i} at={[-24+i*4,.012,0]} size={[.016,.012,depth]} color="#c6d6e1"/>)}
 {Array.from({length:9},(_,i)=><Block key={i} at={[0,.013,-16+i*4]} size={[width,.012,.016]} color="#c6d6e1"/>)}
 </group>;
}
export function MedicalFacility(){
 return <group>
  <Block at={[0,1.3,13]} size={[43,2.6,.25]} color="#e7f0f4"/>
  {[-11,-2.5,6,14.5].map((x,i)=><group key={x}>
   <Block at={[x,1.2,9.5]} size={[.16,2.4,6.8]} color="#c7dde5"/>
   <Block at={[x+3.3,.024,9.4]} size={[6.3,.035,6.5]} color={i%2?'#e2f1eb':'#eaf2fa'}/>
   <Block at={[x+3.2,1.15,12.7]} size={[2.8,1.3,.08]} color="#abd9e7"/>
   <Block at={[x+2,1.15,6.1]} size={[1.7,2.3,.14]} color="#dcebef"/>
   <Cross x={x+2} y={1.65} z={5.99}/>
   <Block at={[x+4.2,.44,10]} size={[1.4,.16,2.9]} color="#86a8bd"/>
   <Block at={[x+4.2,.64,10]} size={[1.35,.26,2.7]} color="#f8fcfd"/>
   <Block at={[x+4.2,.84,9.3]} size={[1.15,.12,.6]} color="#b6dcd3"/>
   {[-.5,.5].map(dx=><Block key={dx} at={[x+4.2+dx,.23,10]} size={[.1,.46,2]} color="#8dacbb"/>)}
  </group>)}
  <Block at={[-13.5,1.4,-11]} size={[10,2.8,.3]} color="#d5e9e8"/>
  <Block at={[-14,1.12,-10.8]} size={[2.5,2.24,.14]} color="#96b7cc"/>
  <Block at={[-14,1.12,-10.69]} size={[.045,2.2,.03]} color="#e9f3f7"/>
  <Cross x={-10} y={1.6} z={-10.8}/>
  <Block at={[-4, .6,-10]} size={[5,1.2,1.4]} color="#8ec6c2"/>
  {[5,10,15,19].map(x=><group key={x}><Block at={[x,.8,-10]} size={[2.1,1.6,1.4]} color="#d4e4ef"/><Block at={[x,1.63,-10]} size={[2.15,.1,1.45]} color="#f7fbfd"/></group>)}
 </group>;
}
export function AirportFacility(){
 return <group>
  <Block at={[0,1.5,-13]} size={[44,3,.2]} color="#c7e1ef"/>
  {[-20,-12,-4,4,12,20].map(x=><Block key={x} at={[x,1.7,-12.8]} size={[.14,3.4,.2]} color="#779bb6"/>)}
  <group position={[-11,.2,-9.5]} rotation-y={Math.PI/2}><RobotModel kind="plane" size={{l:7,w:9,h:1.8}} animate={false}/></group>
  {[3,8,13,18].map((x,i)=><group key={x}>
   <Block at={[x,.6,-10]} size={[2.8,1.2,1.3]} color="#6e9bbd"/>
   <Block at={[x,1.5,-10]} size={[.9,.5,.12]} color="#294f72"/>
   <Block at={[x,2.9,-11.6]} size={[2.2,.7,.12]} color="#346481"/>
   <Block at={[x+.7,.35,-8.8]} size={[.7,.7,.48]} color={i%2?'#9bb6d0':'#b0cbd4'}/>
  </group>)}
  {[-11,-2.5,6,14.5].map((x,i)=><group key={x}>
   <Block at={[x+1.5,.34,8.7]} size={[5.8,.65,3.4]} color="#7999ae"/>
   <Block at={[x+1.5,.71,8.7]} size={[5.6,.08,3.2]} color="#486f88"/>
   <Block at={[x+1.5,.8,8.7]} size={[3.1,.22,1.2]} color="#c1d5e1"/>
   {[-1.6,0,1.7].map(dx=><Block key={dx} at={[x+1.5+dx,1,7.5]} size={[.7,.55,.45]} color={i%2?'#d1b78c':'#a2c4dd'}/>)}
   <Block at={[x+1.5,2.5,11.8]} size={[3.3,.65,.14]} color="#365d7b"/>
   <Block at={[x+1.5,1.1,11.8]} size={[.13,2.2,.13]} color="#98b5c7"/>
  </group>)}
 </group>;
}
