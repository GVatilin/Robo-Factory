export type SimulationSceneOrder={
  key:string;
  target:number;
  fleet:number;
  routeM:number;
  stationCount:number;
  chargerCount:number;
};

export type SimulationWarehouseLayout={
  seed:number;
  width:number;
  depth:number;
  occupancy:number;
  dockCount:number;
  rackRows:number;
  chargerCount:number;
  homeColumns:number;
  cellCount:number;
  cellOffset:number;
};

const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));

function hashOrder(value:string){
  let hash=2166136261;
  for(let index=0;index<value.length;index++){
    hash^=value.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return hash>>>0;
}

/** Один снимок заказа всегда создаёт одну и ту же конфигурацию склада. */
export function createSimulationWarehouseLayout(order:SimulationSceneOrder):SimulationWarehouseLayout{
  const target=Math.max(1,order.target);
  const fleet=Math.max(1,order.fleet);
  const demand=Math.log10(target+1);
  const seed=hashOrder(`${order.key}|${order.target}|${order.fleet}|${order.routeM}|${order.stationCount}|${order.chargerCount}`);
  return {
    seed,
    width:Math.round(clamp(42+demand*2.5+Math.sqrt(fleet)*.7+order.routeM/150,44,62)),
    depth:Math.round(clamp(25+demand*1.7+Math.sqrt(fleet)*.45,28,40)),
    occupancy:clamp(.38+demand*.15,.4,.94),
    dockCount:Math.round(clamp(Math.ceil(demand),1,4)),
    rackRows:Math.round(clamp(Math.ceil(demand),1,3)),
    chargerCount:Math.round(clamp(order.chargerCount,1,6)),
    homeColumns:Math.round(clamp(Math.ceil(Math.sqrt(fleet*2)),4,8)),
    cellCount:Math.round(clamp(order.stationCount,1,4)),
    cellOffset:seed%4,
  };
}
