'use client';
import {flushSync} from 'react-dom';
import {useState, useRef, useEffect} from 'react';
import {ArrowUpRight, Box, Frame, DoorOpen, Armchair, BatteryCharging, Cog, Activity, Disc3, Layers3, RotateCcw, Rotate3d, Plus, Minus, Maximize2, X, Crosshair, ChevronRight, CircleHelp, MoreHorizontal, Hand} from 'lucide-react';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {parts,describePiece, type PartId} from './parts';
import VehicleScene, {type SceneHandle} from './vehicle-scene';
import {HandControl, type GestureStatus} from './hand-control';
const GESTURE_LABEL:Record<GestureStatus['mode'],string>={idle:'Show a hand',shape:'Shaping',pilot:'Piloting'};
const icons:Record<PartId,typeof Box>={body:Box,glass:Frame,doors:DoorOpen,cabin:Armchair,battery:BatteryCharging,drive:Cog,suspension:Activity,wheels:Disc3};
// Read-outs in the status and performance panels are display dressing only:
// nothing in this study measures a real vehicle.
const readouts:[string,string,string][]=[['0-60 mph','2.6','s'],['Top speed','163','mph'],['Range (EPA)','348','mi'],['Drive','AWD','']];
const systems:[string,string][]=[['Drive system','OK'],['Suspension','OK'],['Doors','OK'],['Sensors','OK']];
function Brackets(){return <i className="brackets" aria-hidden="true"/>}
export default function Home(){
 const [selected,setSelected]=useState<PartId>('body');
 const [canFullscreen,setCanFullscreen]=useState(false);
 const [compact,setCompact]=useState(false);const [toolsOpen,setToolsOpen]=useState(false);
 const [componentsOpen,setComponentsOpen]=useState(false);const [detailOpen,setDetailOpen]=useState(false);
 const [explode,setExplode]=useState(0); const [labels,setLabels]=useState(false); const [noise,setNoise]=useState(false);
 // Both the gesture camera and the noise layer start off: they cost a webcam
 // permission and a continuously running renderer respectively.
 const [wantGesture,setWantGesture]=useState(false);
 const [gesture,setGesture]=useState<'starting'|'on'|'error'>('starting');
 const [gestureStatus,setGestureStatus]=useState<GestureStatus>({hands:0,mode:'idle'});
 const [gestureError,setGestureError]=useState('');
 const video=useRef<HTMLVideoElement>(null);const overlay=useRef<HTMLCanvasElement>(null);const hands=useRef<HandControl|null>(null); const [rotate,setRotate]=useState(false); const [isolated,setIsolated]=useState(false); const [help,setHelp]=useState(false);
 useEffect(()=>{setCanFullscreen(Boolean(document.fullscreenEnabled));const query=window.matchMedia('(max-width: 700px), (max-height: 500px)');const update=()=>{setCompact(query.matches);setComponentsOpen(!query.matches);setToolsOpen(false)};update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update)},[]);
 const [focusedMesh,setFocusedMesh]=useState('');
 const [catalog,setCatalog]=useState<{id:string;part:PartId;label:string}[]>([]);
 useEffect(()=>{fetch('/models/model-x-manifest.json').then(r=>r.json()).then(m=>setCatalog((m as {objects:{id:string;part:PartId;label:string}[]}).objects)).catch(()=>{});},[]);
 const [tab,setTab]=useState('overview'); const scene=useRef<SceneHandle|null>(null); const root=useRef<HTMLDivElement>(null);
 // Keyed on the request, not on the status it reports, so the tracker is not
 // torn down the moment it finishes starting.
 useEffect(()=>{
  if(!wantGesture)return;
  setGesture('starting');setGestureError('');
  const control=new HandControl(video.current!,overlay.current!,{
   onExplode:percent=>{setExplode(percent);setIsolated(false)},
   onOrbit:(theta,phi)=>scene.current?.orbit(theta,phi),
   onZoom:factor=>scene.current?.zoom(factor),
   onStatus:setGestureStatus,
  });
  hands.current=control;let live=true;
  control.start().then(()=>{if(live)setGesture('on');else control.stop()}).catch((e:unknown)=>{
   if(!live)return;
   const name=(e as {name?:string}).name;
   setGestureError(name==='NotAllowedError'?'Camera permission was declined.':name==='NotFoundError'?'No camera was found.':'The hand tracker could not start.');
   setGesture('error');
  });
  return()=>{live=false;control.stop();hands.current=null;setGestureStatus({hands:0,mode:'idle'})};
 },[wantGesture]);
 function toggleGesture(){setWantGesture(!wantGesture)}
 useEffect(()=>{
  const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>unknown}}).modelContext;
  if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  try { Promise.resolve(context.registerTool({name:'explore_vehicle_component',description:'Select a Model X component, set its exploded view and optionally isolate it in the 3D study.',inputSchema:{type:'object',properties:{component:{type:'string',enum:parts.map(p=>p.id)},explosion:{type:'number',minimum:0,maximum:100},isolate:{type:'boolean'}},required:['component'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input:unknown){
    const v=input as {component:PartId;explosion?:number;isolate?:boolean};
    if(!v||!parts.some(p=>p.id===v.component)||(v.explosion!==undefined&&(typeof v.explosion!=='number'||!Number.isFinite(v.explosion)||v.explosion<0||v.explosion>100))||(v.isolate!==undefined&&typeof v.isolate!=='boolean'))throw new Error('Choose a valid component and an explosion value between 0 and 100.');
    flushSync(()=>{setSelected(v.component);setFocusedMesh('');setDetailOpen(true);setTab('overview');if(window.matchMedia('(max-width: 700px), (max-height: 500px)').matches){setComponentsOpen(false);setHelp(false)}if(v.explosion!==undefined)setExplode(v.explosion);if(v.isolate!==undefined)setIsolated(v.isolate)});
    return {component:v.component,description:parts.find(p=>p.id===v.component)!.description};
  }},{signal:lifecycle.signal})).catch(()=>{}); }catch{}
  return()=>lifecycle.abort();
 },[]);
 const part=parts.find(p=>p.id===selected)!; const piece=catalog.find(p=>p.id===focusedMesh);
 function select(id:PartId){setFocusedMesh('');setSelected(id);setTab('overview');setDetailOpen(true);if(compact){setComponentsOpen(false);setHelp(false);setToolsOpen(false)}}
 function toggleComponents(){setComponentsOpen(!componentsOpen);if(compact){setDetailOpen(false);setHelp(false);setToolsOpen(false)}}
 function toggleHelp(){setHelp(!help);if(compact){setComponentsOpen(false);setDetailOpen(false);setToolsOpen(false)}}

 return <main className="studio" ref={root}>
  <section className="stage-view" aria-label="Interactive Model X studio">
   <VehicleScene focusedMesh={focusedMesh} onInspect={setFocusedMesh} ref={scene} selected={selected} explode={explode} labels={labels} autoRotate={rotate} isolated={isolated} noise={noise} onSelect={select}/>
  </section>
  <div className="hud-veil" aria-hidden="true"/>
  {noise&&<div className="hud-grain" aria-hidden="true"/>}
  <div className="model-plaque"><span>T E S L A</span><h1>MODEL X</h1></div>
  {componentsOpen&&<aside className="components-panel hud-panel" aria-label="Components"><Brackets/>
   <div className="panel-heading"><h2>Components</h2><button className="icon-button" onClick={()=>setComponentsOpen(false)} aria-label="Hide components"><X size={14}/></button></div>
   <div className="parts-list">{parts.map((p,i)=>{const Icon=icons[p.id];return <button key={p.id} onClick={()=>select(p.id)} className={'part-row '+(p.id===selected&&detailOpen?'selected':'')} aria-pressed={p.id===selected&&detailOpen}><Icon className="part-icon" size={13}/><span className="part-number">{String(i+1).padStart(2,'0')}</span><span>{p.name}</span><ChevronRight size={13}/></button>})}</div>
  </aside>}
  <nav className="view-tools hud-panel" data-expanded={toolsOpen} aria-label="View controls"><Brackets/>
   <button className={'tools-components '+(componentsOpen?'active':'')} title="Components" onClick={toggleComponents} aria-label="Toggle components" aria-pressed={componentsOpen}><Layers3 size={17}/></button>
   <span/>
   <button className="tools-extra" title="Zoom in" onClick={()=>scene.current?.zoom(.85)} aria-label="Zoom in"><Plus size={17}/></button>
   <button className="tools-extra" title="Zoom out" onClick={()=>scene.current?.zoom(1.18)} aria-label="Zoom out"><Minus size={17}/></button>
   <button className="tools-reset" title="Reset view" onClick={()=>{setRotate(false);scene.current?.reset()}} aria-label="Reset view"><RotateCcw size={16}/></button>
   <button className={'tools-extra '+(rotate?'active':'')} title="Auto rotate" onClick={()=>setRotate(!rotate)} aria-label="Toggle auto rotation" aria-pressed={rotate}><Rotate3d size={17}/></button>
   <button className={'tools-extra '+(wantGesture&&gesture==='on'?'active':'')} title="Hand control" onClick={toggleGesture} aria-label="Toggle hand control" aria-pressed={wantGesture}><Hand size={17}/></button>
   <span/>
   {canFullscreen&&<button className="tools-extra" title="Fullscreen" onClick={()=>{if(document.fullscreenElement)document.exitFullscreen();else root.current?.requestFullscreen?.()}} aria-label="Toggle fullscreen"><Maximize2 size={16}/></button>}
   <button className="tools-extra" title="About this model" onClick={toggleHelp} aria-label="About this model" aria-expanded={help}><CircleHelp size={16}/></button>
   <button className="tools-more" title="More view controls" onClick={()=>setToolsOpen(!toolsOpen)} aria-label="More view controls" aria-expanded={toolsOpen}><MoreHorizontal size={19}/></button>
  </nav>
  <div className="right-column">
   {wantGesture&&<aside className="gesture-panel hud-panel" aria-label="Hand control"><Brackets/>
    <div className="panel-heading"><h2>Hand control</h2><button className="icon-button" onClick={toggleGesture} aria-label="Stop hand control"><X size={14}/></button></div>
    <div className="gesture-feed">
     <video ref={video} className="gesture-video" playsInline muted aria-hidden="true"/>
     <canvas ref={overlay} className="gesture-overlay" width={208} height={156} aria-hidden="true"/>
     {gesture!=='on'&&<p className="gesture-notice">{gesture==='starting'?'Starting camera…':gestureError}</p>}
    </div>
    <p className="gesture-state" aria-live="polite">{gesture==='on'?`${GESTURE_LABEL[gestureStatus.mode]} · ${gestureStatus.hands} hand${gestureStatus.hands===1?'':'s'}`:'Offline'}</p>
    <ul className="gesture-legend">
     <li><b>One hand</b> Fist assembles the car, open hand explodes it</li>
     <li><b>Two hands</b> Move to orbit, pull apart to zoom in</li>
    </ul>
   </aside>}
   {detailOpen&&<aside className="detail-panel hud-panel" aria-label="Component details"><Brackets/>
    <div className="panel-heading"><span>{part.category}{['battery','drive','suspension'].includes(selected)&&<span className="illustrative-badge">Illustrative</span>}</span><button className="icon-button" onClick={()=>setDetailOpen(false)} aria-label="Close details"><X size={15}/></button></div>
    <div className="detail" aria-live="polite">
     <h2>{piece?piece.label:part.name}</h2>
     <Tabs value={tab} onValueChange={v=>setTab(String(v))}><TabsList variant="line" className="detail-tabs"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="working">How it works</TabsTrigger></TabsList></Tabs>
     <p className="detail-copy">{piece&&tab==='overview'?describePiece(piece.label):tab==='overview'?part.description:part.principle}</p>
     <dl className="specs">{part.specs.map(([a,b])=><div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
     {catalog.some(p=>p.part===selected)&&<div className="piece-picker"><span>Individual pieces</span><Select value={focusedMesh||'all'} onValueChange={value=>setFocusedMesh(value==='all'?'':String(value))}><SelectTrigger aria-label="Choose an individual mesh piece"><SelectValue>{piece?piece.label:`All ${catalog.filter(p=>p.part===selected).length} pieces`}</SelectValue></SelectTrigger><SelectContent alignItemWithTrigger={false}>{[{id:'all',label:'All pieces in this system'},...catalog.filter(p=>p.part===selected)].map((p,i)=><SelectItem key={p.id} value={p.id}>{i?`${String(i).padStart(2,'0')} · `:''}{p.label}</SelectItem>)}</SelectContent></Select></div>}
     <button className={'isolate-button '+(isolated?'is-active':'')} onClick={()=>setIsolated(!isolated)}>{isolated?<Layers3 size={14}/>:<Crosshair size={14}/>} {isolated?'Show everything':focusedMesh?'Isolate piece':'Isolate component'}</button>
     <a className="source-link" href={part.source} target="_blank" rel="noreferrer">Tesla documentation <ArrowUpRight size={12}/></a>
    </div>
   </aside>}
   {!detailOpen&&<section className="status-panel hud-panel" aria-label="System status"><Brackets/>
    <div className="panel-heading"><h2>System status</h2></div>
    <dl className="readout">
     <div><dt>Battery</dt><dd><span className="meter" aria-hidden="true"><i style={{width:'98%'}}/></span>98%</dd></div>
     {systems.map(([a,b])=><div key={a}><dt>{a}</dt><dd className="ok">{b}</dd></div>)}
    </dl>
   </section>}
   <section className="perf-panel hud-panel" aria-label="Reference performance figures"><Brackets/>
    <div className="panel-heading"><h2>Performance</h2></div>
    <dl className="readout">{readouts.map(([a,b,c])=><div key={a}><dt>{a}</dt><dd><strong>{b}</strong>{c&&<em>{c}</em>}</dd></div>)}</dl>
    <p className="panel-footnote">Reference figures · display only</p>
   </section>
  </div>
  <div className="explode-dock hud-panel" aria-label="Assembly controls"><Brackets/>
   <div className="explode-control"><span id="explode-label">Explode</span><Slider aria-labelledby="explode-label" value={[explode]} onValueChange={v=>setExplode(Array.isArray(v)?v[0]:v)} min={0} max={100}/><output>{explode===100&&catalog.length?`${catalog.length} pcs`:`${explode}%`}</output></div>
   <div className="dock-divider"/>
   <div className="dock-toggle"><span id="all-parts-label">All parts</span><Switch aria-labelledby="all-parts-label" checked={explode===100} onCheckedChange={on=>{setExplode(on?100:0);setIsolated(false)}}/></div>
   <div className="dock-toggle"><span id="labels-label">Labels</span><Switch aria-labelledby="labels-label" checked={labels} onCheckedChange={setLabels}/></div>
   <div className="dock-toggle"><span id="noise-label">Noise</span><Switch aria-labelledby="noise-label" checked={noise} onCheckedChange={setNoise}/></div>
  </div>
  {help&&<aside className="about-panel hud-panel" aria-label="About this model"><Brackets/><div className="panel-heading"><h2>About the model</h2><button className="icon-button" onClick={()=>setHelp(false)} aria-label="Close model information"><X size={15}/></button></div><p>Drag to orbit. Pinch or scroll to zoom. Select a component for details; use the slider to separate the car. Hand control and the noise layer are off by default; both are in the view controls and the dock.</p><p>Pre-refresh Model X by <a href="https://www.blendkit.com/asset-gallery-detail/983e8f94-5a56-44a4-94d9-eed5e4cdcd6c/" target="_blank" rel="noreferrer">cgi Moon</a>. The {catalog.length||334} mesh pieces are modeled geometry, not a complete Tesla parts catalog. Battery, drive and suspension are illustrative, and the status and performance read-outs are display dressing. Not affiliated with Tesla.</p></aside>}
 </main>
}
