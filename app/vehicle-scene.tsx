'use client';
import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {createNoiseField} from './noise-field';
import {createExplosionLayout,layoutCenter,overviewDirection} from './explosion-layout';
import {PointerTap} from './pointer-tap';
import {parts,type PartId} from './parts';
export type SceneHandle={zoom:(factor:number)=>void;orbit:(dTheta:number,dPhi:number)=>void;reset:()=>void};
type Props={focusedMesh:string;onInspect:(id:string)=>void;selected:PartId;explode:number;labels:boolean;autoRotate:boolean;isolated:boolean;noise:boolean;onSelect:(id:PartId)=>void};
const offsets:Record<PartId,[number,number,number]>={body:[0,.6,0],glass:[0,2,0],doors:[0,1.1,0],cabin:[0,.7,0],battery:[0,-.85,0],drive:[0,-.18,0],suspension:[0,.08,0],wheels:[0,0,0]};
const anchors:Record<PartId,[number,number,number]>={body:[-1.9,1.02,.2],glass:[.15,1.94,0],doors:[.25,1.44,1.05],cabin:[.05,1.05,-.4],battery:[.1,.24,1.02],drive:[-1.54,.57,.2],suspension:[1.57,.83,-.83],wheels:[1.53,.46,1.1]};
// Every surface is a dark occluding shell carrying a world-space scan grid, with
// the model's own feature edges drawn over it. A per-triangle wireframe would be
// 2.3 million segments on this asset; the grid stays even however dense the mesh is.
const LINE=0x3dffb0,ACTIVE=0x9dffd8,HOT=0xe4fff6,SHELL=0x02120c,GRID_SCALE=11.5,EDGE_ANGLE=26;
const holoStyle:Record<PartId,{fill:number;grid:number;edge:number}>={body:{fill:.9,grid:.5,edge:.5},glass:{fill:.3,grid:.42,edge:.55},doors:{fill:.9,grid:.5,edge:.5},cabin:{fill:.8,grid:.34,edge:.3},battery:{fill:.88,grid:.55,edge:.6},drive:{fill:.88,grid:.55,edge:.6},suspension:{fill:.88,grid:.55,edge:.6},wheels:{fill:.9,grid:.45,edge:.45}};
type Holo={fill:THREE.MeshBasicMaterial;edge:THREE.LineBasicMaterial;grid:THREE.Color;baseFill:number;baseEdge:number};
const gridPatch=(shader:{uniforms:Record<string,{value:unknown}>;vertexShader:string;fragmentShader:string},grid:THREE.Color,strength:number)=>{
 shader.uniforms.uGridColor={value:grid};shader.uniforms.uGridScale={value:GRID_SCALE};shader.uniforms.uGridStrength={value:strength};
 shader.vertexShader='varying vec3 vHoloWorld;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n vHoloWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
 shader.fragmentShader='varying vec3 vHoloWorld;\nuniform vec3 uGridColor;\nuniform float uGridScale;\nuniform float uGridStrength;\n'+shader.fragmentShader.replace('#include <fog_fragment>',
  ' vec3 hp=vHoloWorld*uGridScale;\n vec3 hg=abs(fract(hp-0.5)-0.5)/max(fwidth(hp),vec3(1e-4));\n float hline=(1.0-min(min(min(hg.x,hg.y),hg.z),1.0))*uGridStrength;\n gl_FragColor.rgb=mix(gl_FragColor.rgb,uGridColor,hline);\n gl_FragColor.a=max(gl_FragColor.a,hline);\n#include <fog_fragment>');
};
function holo(style:{fill:number;grid:number;edge:number},line=LINE):Holo{
 const grid=new THREE.Color(line);
 const fill=new THREE.MeshBasicMaterial({color:SHELL,transparent:true,opacity:style.fill,depthWrite:true,polygonOffset:true,polygonOffsetFactor:1.4,polygonOffsetUnits:1.4});
 fill.onBeforeCompile=shader=>gridPatch(shader,grid,style.grid);
 const edge=new THREE.LineBasicMaterial({color:line,transparent:true,opacity:style.edge,depthWrite:false});
 return {fill,edge,grid,baseFill:style.fill,baseEdge:style.edge};
}
// Feature edges are shared per source geometry, so instanced pieces build them once.
const edgeCache=new Map<THREE.BufferGeometry,THREE.BufferGeometry>();
function dress(o:THREE.Mesh,h:Holo){
 o.material=h.fill;o.renderOrder=0;
 let outline=edgeCache.get(o.geometry);
 if(!outline){outline=new THREE.EdgesGeometry(o.geometry,EDGE_ANGLE);edgeCache.set(o.geometry,outline)}
 const edges=new THREE.LineSegments(outline,h.edge);edges.renderOrder=1;edges.raycast=()=>{};o.add(edges);
}
const VehicleScene=forwardRef<SceneHandle,Props>(function VehicleScene(props,ref){
 const host=useRef<HTMLDivElement>(null);const latest=useRef(props);latest.current=props;
 const engine=useRef<{camera:THREE.PerspectiveCamera;controls:OrbitControls;reset:()=>void;interrupt:()=>void}|null>(null);const [error,setError]=useState<string|null>(null);const [ready,setReady]=useState(false);
 useImperativeHandle(ref,()=>({zoom(f){const e=engine.current;if(e){e.interrupt();e.camera.position.sub(e.controls.target).multiplyScalar(f).add(e.controls.target)}},
  orbit(dTheta,dPhi){const e=engine.current;if(!e)return;e.interrupt();
   const spherical=new THREE.Spherical().setFromVector3(e.camera.position.clone().sub(e.controls.target));
   spherical.theta-=dTheta;spherical.phi=THREE.MathUtils.clamp(spherical.phi-dPhi,.08,Math.PI-.08);
   e.camera.position.copy(e.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));e.camera.lookAt(e.controls.target);},
  reset(){const e=engine.current;if(e){e.reset()}}}),[]);
 useEffect(()=>{
  setReady(false);setError(null);
  const el=host.current!; let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'})}catch{setError('Your browser could not start the 3D view.');return}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,window.matchMedia('(pointer: coarse)').matches?1.25:1.5));renderer.setClearColor(0x000403,1);renderer.toneMapping=THREE.NoToneMapping;el.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#000403');scene.fog=new THREE.Fog('#000403',18,62);const camera=new THREE.PerspectiveCamera(37,1,.05,500);camera.position.set(-5.7,2.9,6.3);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.8,0);controls.enableDamping=true;controls.dampingFactor=.065;controls.minDistance=5;controls.maxDistance=180;controls.maxPolarAngle=Math.PI*.49;controls.minPolarAngle=.18;controls.enablePan=true;controls.autoRotateSpeed=.65;engine.current={camera,controls,reset:()=>{fitView(true);invalidated=true},interrupt:()=>{framingTime=0}};
  const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.4,.3,.3);composer.addPass(bloom);composer.addPass(new OutputPass());
  // Signal noise sits after the output pass so the grain and channel split land
  // on the finished image rather than on linear colour.
  const grain=new ShaderPass({
   uniforms:{tDiffuse:{value:null},uTime:{value:0},uSplit:{value:.0035},uGrain:{value:.055},uResolution:{value:new THREE.Vector2(1,1)}},
   vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
   fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime;uniform float uSplit;uniform float uGrain;uniform vec2 uResolution;varying vec2 vUv;
void main(){
 vec2 dir=vUv-vec2(.5);float offset=uSplit*length(dir);
 vec4 r=texture2D(tDiffuse,vUv+dir*offset),g=texture2D(tDiffuse,vUv),b=texture2D(tDiffuse,vUv-dir*offset*.6);
 vec3 colour=vec3(r.r*.9,g.g*1.03,b.b*.94)*(1.0+.014*sin(uTime*29.0)*sin(uTime*7.3));
 float speck=fract(sin(dot(vUv*uResolution+uTime*57.0,vec2(12.9898,78.233)))*43758.5453);
 gl_FragColor=vec4(colour+vec3(.55,1.0,.82)*(speck-.5)*uGrain,1.0);
}`,
  });composer.addPass(grain);
  // Illustrative internals share one material set; only source pieces highlight.
  const shell=holo({fill:.88,grid:.5,edge:.6}),core=holo({fill:.8,grid:.4,edge:.4}),hot=holo({fill:.9,grid:.9,edge:1},HOT);
  const groups={} as Record<PartId,THREE.Group>;parts.forEach(p=>{const g=new THREE.Group();g.name=p.id;g.userData.part=p.id;groups[p.id]=g;scene.add(g)});
  function mesh(g:THREE.Group,geometry:THREE.BufferGeometry,h:Holo,pos:[number,number,number]=[0,0,0]){const o=new THREE.Mesh(geometry,h.fill);o.position.set(...pos);o.userData.part=g.userData.part;g.add(o);dress(o,h);return o}
  function box(g:THREE.Group,s:[number,number,number],p:[number,number,number],h:Holo,r=.04){return mesh(g,new RoundedBoxGeometry(...s,3,r),h,p)}
  function cyl(g:THREE.Group,r:number,len:number,p:[number,number,number],h:Holo){const o=mesh(g,new THREE.CylinderGeometry(r,r,len,24),h,p);o.rotation.x=Math.PI/2;return o}
  function tube(g:THREE.Group,points:THREE.Vector3[],r:number,h:Holo){return mesh(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),20,r,6,false),h)}
  // Battery casing with visible illustrative modules and bright high-voltage busbars.
  box(groups.battery,[2.95,.20,1.70],[0,.32,0],shell,.065);box(groups.battery,[2.8,.08,1.58],[0,.45,0],core,.025);
  for(let x=0;x<8;x++)for(let z=0;z<4;z++)box(groups.battery,[.30,.07,.33],[-1.22+x*.35,.51,-.585+z*.39],core,.018);
  [-1,1].forEach(s=>box(groups.battery,[2.8,.035,.035],[0,.56,s*.77],hot,.009));
  // Two motors, half-shafts and ribbed inverter housings.
  [-1.56,1.56].forEach(x=>{cyl(groups.drive,.21,.73,[x,.59,0],shell);cyl(groups.drive,.095,1.82,[x,.55,0],core);box(groups.drive,[.46,.17,.49],[x,.82,0],shell);for(let j=0;j<7;j++)box(groups.drive,[.022,.04,.43],[x-.19+j*.065,.922,0],core,.004);tube(groups.drive,[new THREE.Vector3(x,.75,.4),new THREE.Vector3(x*.8,.57,.58),new THREE.Vector3(x*.77,.44,.66)],.026,hot)});
  // Air springs and suspension arms remain aligned with each wheel.
  [-1.55,1.57].forEach(x=>[-1,1].forEach(side=>{const strut=cyl(groups.suspension,.09,.41,[x,.78,side*.73],shell);strut.rotation.x=0;for(let j=0;j<5;j++){const ring=mesh(groups.suspension,new THREE.TorusGeometry(.11,.028,6,18),core,[x,.68+j*.055,side*.73]);ring.rotation.x=Math.PI/2;}[-.18,.18].forEach(dx=>tube(groups.suspension,[new THREE.Vector3(x+dx,.48,side*.37),new THREE.Vector3(x,.47,side*.96)],.026,shell))}));
  // The exterior, wheels and interior below are the creator's actual imported mesh.
  const readyRef={current:false};
  let cancelled=false;
  const pieces:({node:THREE.Object3D;home:THREE.Vector3;spread:THREE.Vector3;part:PartId;id:string;bounds:THREE.Box3;center:THREE.Vector3;fullSpread:THREE.Vector3}&Holo)[]=[];
  let layout:ReturnType<typeof createExplosionLayout>|null=null;
  const pieceLabels:{b:HTMLButtonElement;id:string;part:PartId;center:THREE.Vector3;spread:THREE.Vector3;fullSpread:THREE.Vector3}[]=[];
  const disposeObject=(root:THREE.Object3D)=>root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())}});
  new GLTFLoader().load('/models/model-x.glb?v=334',gltf=>{
   if(cancelled){disposeObject(gltf.scene);return}
   Object.values(groups).forEach(g=>g.position.set(0,0,0));scene.updateMatrixWorld(true);
   const model=gltf.scene;model.rotation.y=-Math.PI/2;scene.add(model);model.updateMatrixWorld(true);
   const nodes:THREE.Object3D[]=[];model.traverse(o=>{if(o.userData.component)nodes.push(o)});
   nodes.forEach(node=>{
    const id=node.userData.part as PartId;if(!groups[id])return;
    const component=node.userData.component as string;groups[id].attach(node);
    const bounds=new THREE.Box3().setFromObject(node);const center=bounds.getCenter(new THREE.Vector3());
    const side=Math.sign(center.z)||1;
    const spread=new THREE.Vector3(id==='body'?center.x*.17:0,0,id==='wheels'?side*.95:id==='doors'?side*.9:id==='glass'?side*.12:0);
    const skin=holo(holoStyle[id]);
    pieces.push({node,home:node.position.clone(),spread,part:id,id:component,bounds,center,fullSpread:new THREE.Vector3(),...skin});
    // Collect first: dressing adds children that traversal would otherwise revisit.
    const surfaces:THREE.Mesh[]=[];node.traverse(o=>{if(o instanceof THREE.Mesh)surfaces.push(o)});
    surfaces.forEach(o=>{o.userData.part=id;o.userData.component=component;
     (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());
     dress(o,skin);
    });
   });
   layout=createExplosionLayout(pieces);
   pieces.forEach((piece,i)=>{
    piece.fullSpread.copy(layout!.pieces.get(piece.id)!.translation);
    const b=document.createElement('button');b.className='mesh-marker';b.textContent=String(i+1);b.title=piece.node.userData.label||'Modeled piece';b.setAttribute('aria-label',`Inspect piece ${i+1}: ${b.title}`);
    b.addEventListener('click',()=>{latest.current.onSelect(piece.part);latest.current.onInspect(piece.id)});el.appendChild(b);
    pieceLabels.push({b,id:piece.id,part:piece.part,center:piece.center,spread:piece.spread,fullSpread:piece.fullSpread});
   });
   const positions=new Float32Array(pieces.length*3);markerGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
   scene.remove(model);readyRef.current=true;setReady(true);fitView(true);invalidated=true;
  },undefined,()=>{if(!cancelled)setError('The detailed car could not load. Reload to try again.')});
  const markerGeometry=new THREE.BufferGeometry();
  const markerMaterial=new THREE.PointsMaterial({color:0x6bffc4,size:4,sizeAttenuation:false,depthWrite:false,depthTest:false,transparent:true,opacity:.75,blending:THREE.AdditiveBlending});
  const markers=new THREE.Points(markerGeometry,markerMaterial);markers.visible=false;markers.frustumCulled=false;markers.renderOrder=10;scene.add(markers);
  // A ring of light stands in for the display platform; nothing here casts shadows.
  const stage=new THREE.Group();scene.add(stage);
  const ringMaterials:THREE.MeshBasicMaterial[]=[];
  const spinners:{node:THREE.Object3D;speed:number}[]=[];
  function ring(radius:number,tube:number,opacity:number,arc=Math.PI*2,speed=0,offset=0){
   const material=new THREE.MeshBasicMaterial({color:LINE,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
   material.userData.base=opacity;ringMaterials.push(material);
   const geometry=new THREE.TorusGeometry(radius,tube,4,Math.max(12,Math.round(arc*40)),arc);
   const disc=new THREE.Mesh(geometry,material);disc.rotation.x=-Math.PI/2;disc.renderOrder=2;
   const holder=new THREE.Group();holder.rotation.y=offset;holder.position.y=-.13;holder.add(disc);stage.add(holder);
   if(speed)spinners.push({node:holder,speed});
   return material;
  }
  const platform=new THREE.Mesh(new THREE.CircleGeometry(4.02,96),new THREE.MeshBasicMaterial({color:0x00110b,transparent:true,opacity:.85,depthWrite:false}));
  platform.rotation.x=-Math.PI/2;platform.position.y=-.14;platform.renderOrder=1;stage.add(platform);
  ringMaterials.push(platform.material as THREE.MeshBasicMaterial);(platform.material as THREE.MeshBasicMaterial).userData.base=.85;
  ring(3.98,.012,.62);ring(3.9,.005,.26);ring(3.62,.009,.5);ring(3.1,.004,.18);ring(2.72,.004,.12);
  for(let i=0;i<7;i++)ring(3.78,.007,.42,.34,.13,i*(Math.PI*2/7));
  for(let i=0;i<4;i++)ring(3.36,.006,.3,.62,-.09,i*(Math.PI/2)+.4);
  const pulse=ring(3.46,.005,.22,Math.PI*2,.5);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(220,220),new THREE.MeshBasicMaterial({color:0x000604}));ground.rotation.x=-Math.PI/2;ground.position.y=-.19;scene.add(ground);
  const grid=new THREE.GridHelper(120,120,0x1f7a5b,0x115c42);grid.position.y=-.185;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.3;scene.add(grid);
  // Faint drifting motes give the empty volume around the car some depth.
  const moteGeometry=new THREE.BufferGeometry();const motes=new Float32Array(420*3);
  for(let i=0;i<420;i++){const radius=6+Math.random()*44,angle=Math.random()*Math.PI*2;motes.set([Math.cos(angle)*radius,Math.random()*24-1.5,Math.sin(angle)*radius],i*3)}
  moteGeometry.setAttribute('position',new THREE.BufferAttribute(motes,3));
  const moteMaterial=new THREE.PointsMaterial({color:0x35d99b,size:1.6,sizeAttenuation:false,transparent:true,opacity:.32,depthWrite:false,blending:THREE.AdditiveBlending});
  const dust=new THREE.Points(moteGeometry,moteMaterial);dust.frustumCulled=false;scene.add(dust);
  const noise=createNoiseField(LINE,HOT);scene.add(noise.node);
  const labelNodes=parts.map((p,i)=>{const b=document.createElement('button');b.className='scene-label';b.setAttribute('aria-label','Inspect '+p.name);b.innerHTML='<span>'+String(i+1).padStart(2,'0')+'</span><strong>'+p.name+'</strong>';b.addEventListener('click',()=>latest.current.onSelect(p.id));el.appendChild(b);return {b,id:p.id}});
  let viewWidth=1,viewHeight=1;
  const resize=()=>{const w=el.clientWidth,h=el.clientHeight;viewWidth=w;viewHeight=h;renderer.setSize(w,h);composer.setSize(w,h);(grain.uniforms.uResolution.value as THREE.Vector2).set(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(readyRef.current){invalidated=true;framingTime=.8}};const observer=new ResizeObserver(resize);observer.observe(el);resize();
  const taps=new PointerTap();const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();
  const onDown=(e:PointerEvent)=>{taps.down(e.pointerId,e.clientX,e.clientY,e.pointerType==='touch'?10:5)};
  const onMove=(e:PointerEvent)=>{taps.move(e.pointerId,e.clientX,e.clientY)};
  const onCancel=(e:PointerEvent)=>{taps.cancel(e.pointerId)};
  const onUp=(e:PointerEvent)=>{if(!taps.up(e.pointerId,e.clientX,e.clientY))return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);if(markers.visible){let nearest=-1,nearestDistance=e.pointerType==='touch'?324:64;pieces.forEach((piece,i)=>{vector.copy(piece.center).add(piece.node.position).sub(piece.home).add(groups[piece.part].position).project(camera);const dx=(vector.x-pointer.x)*viewWidth/2,dy=(vector.y-pointer.y)*viewHeight/2,d=dx*dx+dy*dy;if(vector.z<1&&d<nearestDistance){nearest=i;nearestDistance=d}});if(nearest>=0){latest.current.onSelect(pieces[nearest].part);latest.current.onInspect(pieces[nearest].id);return}}
   const hits=raycaster.intersectObjects(Object.values(groups),true).filter(h=>{let o:THREE.Object3D|null=h.object;while(o){if(!o.visible)return false;o=o.parent}return true});if(hits[0]){latest.current.onSelect(hits[0].object.userData.part);latest.current.onInspect(hits[0].object.userData.component||'')}};
  renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('pointermove',onMove);renderer.domElement.addEventListener('pointercancel',onCancel);renderer.domElement.addEventListener('pointerup',onUp);
  const lost=(e:Event)=>{e.preventDefault();setError('The graphics connection was interrupted. Please reload the view.')};renderer.domElement.addEventListener('webglcontextlost',lost);
  let raf=0;let amount=latest.current.explode/100;const vector=new THREE.Vector3();let last=performance.now();
  let focusKey='';let previousExplosion=latest.current.explode;let framingTime=0;
  let invalidated=true,previousProps:Props|null=null,lastLabels=0;
  let labelsPending=false;let lastHighlighted='';let lastSelected:PartId|''='';const cameraPosition=new THREE.Vector3(),cameraQuaternion=new THREE.Quaternion();
  const homeTarget=new THREE.Vector3(0,.8,0),framingDirection=overviewDirection.clone();
  function fitView(immediate=false,dt=1/60){
   if(latest.current.isolated)return;
   const f=THREE.MathUtils.smoothstep(immediate?latest.current.explode/100:amount,.4,1);
   const target=homeTarget.clone().lerp(layoutCenter,f);
   const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
   const fullDistance=layout?Math.max(layout.height/(2*tangent),layout.width/(2*tangent*camera.aspect))*1.18+3:9;
   const assembledDistance=Math.max(10.5,7.5/camera.aspect);
   const distance=THREE.MathUtils.lerp(assembledDistance,fullDistance,f);
   const direction=immediate?overviewDirection:framingDirection.clone().lerp(overviewDirection,f).normalize();
   const blend=immediate?1:1-Math.exp(-8*dt);
   controls.target.lerp(target,blend);camera.position.lerp(target.addScaledVector(direction,distance),blend);
  }
  const stopFraming=()=>{framingTime=0};controls.addEventListener('start',stopFraming);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(now:number){raf=requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.05);last=now;if(document.hidden)return;
   const p=latest.current,propsChanged=!previousProps||p.selected!==previousProps.selected||p.focusedMesh!==previousProps.focusedMesh||p.isolated!==previousProps.isolated||p.noise!==previousProps.noise||p.labels!==previousProps.labels||p.autoRotate!==previousProps.autoRotate;
   if(p.explode!==previousExplosion){previousExplosion=p.explode;framingTime=1.5;framingDirection.copy(camera.position).sub(controls.target).normalize()}
   const oldAmount=amount;amount=reduced?p.explode/100:THREE.MathUtils.damp(amount,p.explode/100,7,dt);if(Math.abs(amount-p.explode/100)<.0001)amount=p.explode/100;
   const moving=oldAmount!==amount,geometryChanged=moving||invalidated||propsChanged;
   const individual=THREE.MathUtils.smoothstep(amount,.4,1);
   if(scene.fog instanceof THREE.Fog){scene.fog.near=18+individual*382;scene.fog.far=62+individual*438;}
   framingTime=Math.max(0,framingTime-dt);if(framingTime>0)fitView(false,dt);
   controls.autoRotate=p.autoRotate&&!reduced;controls.update();
   const cameraChanged=camera.position.distanceToSquared(cameraPosition)>1e-10||1-Math.abs(camera.quaternion.dot(cameraQuaternion))>1e-10;
   const animating=(stage.visible||p.noise)&&!reduced;
   if(!geometryChanged&&!cameraChanged&&!animating&&!(labelsPending&&now-lastLabels>50))return;
   labelsPending=true;
   if(animating){spinners.forEach(s=>{s.node.rotation.y+=s.speed*dt});pulse.opacity=(.08+.14*(Math.sin(now/900)*.5+.5))*(pulse.userData.scale??1)}
   // The noise layer keeps its own clock so it stays put under reduced motion.
   if(p.noise){noise.update(reduced?0:now/1000,dt);grain.uniforms.uTime.value=reduced?0:now/1000}
   const noiseVisible=p.noise&&!p.isolated;
   if(noiseVisible!==noise.node.visible)noise.node.visible=noiseVisible;
   if(p.noise!==grain.enabled)grain.enabled=p.noise;
   if(geometryChanged){
    ground.position.y=-.19-.85*amount-individual*(layout?.height||0)*.6;grid.position.y=ground.position.y+.005;
    stage.visible=amount<.18&&!p.isolated;
    const stageFade=1-THREE.MathUtils.smoothstep(amount,.02,.18);
    ringMaterials.forEach(m=>{m.opacity=(m.userData.base as number)*stageFade});pulse.userData.scale=stageFade;
    ground.visible=individual<.2&&!p.isolated;grid.visible=individual<.2&&!p.isolated;dust.visible=!p.isolated;
    parts.forEach(({id})=>{const g=groups[id],o=offsets[id];g.position.set(o[0]*amount*(1-individual),o[1]*amount*(1-individual),o[2]*amount*(1-individual));g.visible=!p.isolated||p.selected===id;
     if(['battery','drive','suspension'].includes(id))g.visible=g.visible&&(amount>.08||p.isolated)&&(individual<.98||p.isolated);
    });
    const positions=markerGeometry.getAttribute('position') as THREE.BufferAttribute|undefined;
    pieces.forEach((piece,i)=>{
     piece.node.position.copy(piece.home).addScaledVector(piece.spread,amount*(1-individual)).addScaledVector(piece.fullSpread,individual);
     piece.node.visible=!p.isolated||!p.focusedMesh||p.focusedMesh===piece.id;
     if(positions){vector.copy(piece.center).add(piece.node.position).sub(piece.home).add(groups[piece.part].position);positions.setXYZ(i,vector.x,vector.y,vector.z)}
    });
    if(positions)positions.needsUpdate=true;
    markers.visible=individual>.45&&!p.isolated&&!p.labels;
    markerMaterial.opacity=THREE.MathUtils.smoothstep(individual,.45,.9)*.75;
    if(p.focusedMesh!==lastHighlighted||p.selected!==lastSelected||invalidated){
     lastHighlighted=p.focusedMesh;lastSelected=p.selected;
     for(const piece of pieces){
      const focused=piece.id===p.focusedMesh,active=!p.focusedMesh&&piece.part===p.selected;
      const tone=focused?HOT:active?ACTIVE:LINE;
      piece.grid.setHex(tone);piece.edge.color.setHex(tone);
      piece.edge.opacity=Math.min(1,piece.baseEdge*(focused?2:active?1.4:1));
      piece.fill.opacity=Math.min(1,piece.baseFill*(focused?1.1:1));
     }
    }
   }
   const nextFocus=p.isolated?(p.focusedMesh||p.selected):'';
   if(readyRef.current&&nextFocus!==focusKey){
    focusKey=nextFocus;
    if(nextFocus){
     const target=p.focusedMesh?pieces.find(x=>x.id===p.focusedMesh)?.node:groups[p.selected];
     if(target){scene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(target);const center=bounds.getCenter(new THREE.Vector3());const extent=bounds.getSize(new THREE.Vector3()).length();const direction=camera.position.clone().sub(controls.target).normalize();controls.minDistance=.15;controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,Math.max(.4,extent*1.8));}
    }else{controls.minDistance=.15;fitView(true)}
    controls.update();
   }
   if(p.isolated&&readyRef.current&&geometryChanged){
    const target=p.focusedMesh?pieces.find(x=>x.id===p.focusedMesh)?.node:groups[p.selected];
    if(target){scene.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3());const movement=center.clone().sub(controls.target);camera.position.add(movement);controls.target.copy(center);controls.update()}
   }
   // Transform-only label updates avoid hundreds of layout writes on every frame.
   if(now-lastLabels>50||propsChanged||invalidated){
    lastLabels=now;labelsPending=false;
    labelNodes.forEach(({b,id})=>{const show=individual<.5&&readyRef.current&&p.labels&&(!['battery','drive','suspension'].includes(id)||amount>.08||p.isolated)&&(!p.isolated||p.selected===id);
     if(b.hidden===show)b.hidden=!show;if(!show)return;
     const a=anchors[id];vector.set(...a).add(groups[id].position).project(camera);b.style.display=vector.z<1?'flex':'none';b.classList.toggle('chosen',id===p.selected);
     b.style.transform=`translate3d(${(vector.x*.5+.5)*viewWidth}px,${(-vector.y*.5+.5)*viewHeight}px,0) translate(-12px,-50%)`;
    });
    pieceLabels.forEach(({b,id,part,center,spread,fullSpread})=>{
     const show=individual>.45&&(p.labels||id===p.focusedMesh)&&(!p.isolated||p.selected===part)&&(!p.isolated||!p.focusedMesh||p.focusedMesh===id);
     if(b.hidden===show)b.hidden=!show;if(!show)return;
     vector.copy(center).addScaledVector(spread,amount*(1-individual)).addScaledVector(fullSpread,individual).add(groups[part].position).project(camera);
     b.style.display=vector.z<1&&Math.abs(vector.x)<1&&Math.abs(vector.y)<1?'grid':'none';b.classList.toggle('chosen',p.focusedMesh===id);b.classList.add('numbered');
     b.style.transform=`translate3d(${(vector.x*.5+.5)*viewWidth}px,${(-vector.y*.5+.5)*viewHeight}px,0) translate(-50%,-50%)`;
    });
   }
   cameraPosition.copy(camera.position);cameraQuaternion.copy(camera.quaternion);previousProps=p;invalidated=false;
   composer.render();
  }raf=requestAnimationFrame(frame);
  return()=>{cancelled=true;cancelAnimationFrame(raf);observer.disconnect();controls.removeEventListener('start',stopFraming);controls.dispose();markerGeometry.dispose();markerMaterial.dispose();moteGeometry.dispose();moteMaterial.dispose();noise.dispose();engine.current=null;labelNodes.forEach(x=>x.b.remove());pieceLabels.forEach(x=>x.b.remove());renderer.domElement.removeEventListener('pointerdown',onDown);renderer.domElement.removeEventListener('pointermove',onMove);renderer.domElement.removeEventListener('pointercancel',onCancel);renderer.domElement.removeEventListener('pointerup',onUp);renderer.domElement.removeEventListener('webglcontextlost',lost);scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.LineSegments){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose())}});edgeCache.clear();grid.geometry.dispose();(grid.material as THREE.Material).dispose();composer.dispose();renderer.dispose();renderer.domElement.remove();};
 },[]);
 return <><div ref={host} className="canvas-host" aria-label="Rotatable exploded 3D vehicle model"/>{!ready&&!error&&<div className="scene-loading"><span/>Initialising hologram…</div>}{error&&<div className="scene-error"><h3>The 3D view needs a moment.</h3><p>{error}</p><button onClick={()=>location.reload()}>Reload the view</button></div>}</>;
});
export default VehicleScene;
