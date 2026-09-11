import type {HandLandmarker,NormalizedLandmark} from '@mediapipe/tasks-vision';

// Gesture grammar, split by hand count so no two readings ever fight:
//   one hand  — how open it is IS the explosion. Close a fist and the 334
//               pieces gather into a car; open your hand and it blooms apart.
//   two hands — you are holding the model: move both to orbit, pull apart to
//               zoom in, bring together to zoom out. The explosion holds.
const WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WRIST=0,MIDDLE_MCP=9,TIPS=[8,12,16,20];
const LINKS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
// Fingertip-to-wrist distance in palm widths: a fist sits near 1.2, a splayed
// hand near 1.95. Measured on the metric world landmarks, so it holds up when
// the hand is turned away from the camera.
const FIST=1.2,SPLAY=1.95;
const SMOOTH=.28,ORBIT_X=4.5,ORBIT_Y=3,DEADZONE=1e-3;

export type GestureMode='idle'|'shape'|'pilot';
export type GestureStatus={hands:number;mode:GestureMode};
type Point={x:number;y:number};
export type HandCallbacks={onExplode(percent:number):void;onOrbit(dTheta:number,dPhi:number):void;onZoom(factor:number):void;onStatus(status:GestureStatus):void};

const distance=(a:{x:number;y:number;z?:number},b:{x:number;y:number;z?:number})=>Math.hypot(a.x-b.x,a.y-b.y,(a.z??0)-(b.z??0));

export class HandControl{
 private landmarker:HandLandmarker|null=null;
 private stream:MediaStream|null=null;
 private raf=0;private running=false;private stopped=false;private lastFrame=-1;
 private openness=0;private sent=-1;
 private mode:GestureMode='idle';
 private pilotCentre:Point|null=null;private pilotSpan:number|null=null;
 private reported:GestureStatus={hands:0,mode:'idle'};
 constructor(private video:HTMLVideoElement,private overlay:HTMLCanvasElement,private callbacks:HandCallbacks){}

 // Single use: once stopped it stays stopped, so a teardown that lands while
 // the camera or the model is still opening can't leave either running.
 async start(){
  const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'},audio:false});
  if(this.stopped){stream.getTracks().forEach(t=>t.stop());return}
  this.stream=stream;this.video.srcObject=stream;await this.video.play();
  // Loaded on demand: the vision runtime is far larger than the rest of the app.
  const {FilesetResolver,HandLandmarker}=await import('@mediapipe/tasks-vision');
  const fileset=await FilesetResolver.forVisionTasks(WASM);
  const options={baseOptions:{modelAssetPath:MODEL,delegate:'GPU' as const},runningMode:'VIDEO' as const,numHands:2,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6};
  try{this.landmarker=await HandLandmarker.createFromOptions(fileset,options)}
  catch{this.landmarker=await HandLandmarker.createFromOptions(fileset,{...options,baseOptions:{...options.baseOptions,delegate:'CPU' as const}})}
  if(this.stopped){this.landmarker.close();this.landmarker=null;return}
  this.running=true;this.loop();
 }

 stop(){
  this.stopped=true;this.running=false;cancelAnimationFrame(this.raf);
  this.landmarker?.close();this.landmarker=null;
  this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
  this.video.srcObject=null;
  this.pilotCentre=null;this.pilotSpan=null;this.mode='idle';
  this.overlay.getContext('2d')?.clearRect(0,0,this.overlay.width,this.overlay.height);
  this.report({hands:0,mode:'idle'});
 }

 private loop=()=>{
  if(!this.running)return;
  this.raf=requestAnimationFrame(this.loop);
  if(!this.landmarker||this.video.readyState<2||this.video.currentTime===this.lastFrame)return;
  this.lastFrame=this.video.currentTime;
  const result=this.landmarker.detectForVideo(this.video,performance.now());
  this.read(result.landmarks,result.worldLandmarks);
  this.draw(result.landmarks);
 };

 private read(screen:NormalizedLandmark[][],world:NormalizedLandmark[][]){
  const mode:GestureMode=screen.length>=2?'pilot':screen.length===1?'shape':'idle';
  if(mode!==this.mode){this.pilotCentre=null;this.pilotSpan=null;this.mode=mode}

  if(mode==='shape'&&world[0]){
   const hand=world[0],palm=distance(hand[WRIST],hand[MIDDLE_MCP]);
   if(palm>1e-6){
    const reach=TIPS.reduce((sum,tip)=>sum+distance(hand[tip],hand[WRIST]),0)/(TIPS.length*palm);
    const target=Math.min(1,Math.max(0,(reach-FIST)/(SPLAY-FIST)));
    this.openness+=(target-this.openness)*SMOOTH;
    const percent=Math.round(this.openness*100);
    if(percent!==this.sent){this.sent=percent;this.callbacks.onExplode(percent)}
   }
  }else if(mode==='pilot'){
   // Mirrored, so moving your hands right pushes the model right.
   const centres=screen.slice(0,2).map(hand=>({x:1-(hand[WRIST].x+hand[MIDDLE_MCP].x)/2,y:(hand[WRIST].y+hand[MIDDLE_MCP].y)/2}));
   const centre={x:(centres[0].x+centres[1].x)/2,y:(centres[0].y+centres[1].y)/2};
   const span=Math.hypot(centres[0].x-centres[1].x,centres[0].y-centres[1].y);
   if(this.pilotCentre){
    const dx=centre.x-this.pilotCentre.x,dy=centre.y-this.pilotCentre.y;
    if(Math.abs(dx)>DEADZONE||Math.abs(dy)>DEADZONE)this.callbacks.onOrbit(dx*ORBIT_X,dy*ORBIT_Y);
   }
   if(this.pilotSpan&&span>1e-4){
    const factor=Math.min(1.11,Math.max(.9,this.pilotSpan/span));
    if(Math.abs(factor-1)>1e-3)this.callbacks.onZoom(factor);
   }
   this.pilotCentre=centre;this.pilotSpan=span;
  }
  this.report({hands:screen.length,mode});
 }

 private report(status:GestureStatus){
  if(status.hands===this.reported.hands&&status.mode===this.reported.mode)return;
  this.reported=status;this.callbacks.onStatus(status);
 }

 private draw(hands:NormalizedLandmark[][]){
  const ctx=this.overlay.getContext('2d');if(!ctx)return;
  const {width,height}=this.overlay;ctx.clearRect(0,0,width,height);
  const lit=hands.length>=2?'#e4fff6':'#3dffb0';
  for(const hand of hands){
   const at=(i:number)=>[(1-hand[i].x)*width,hand[i].y*height] as const;
   ctx.strokeStyle=lit;ctx.lineWidth=1.2;ctx.globalAlpha=.75;ctx.beginPath();
   for(const [a,b] of LINKS){const p=at(a),q=at(b);ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1])}
   ctx.stroke();
   ctx.globalAlpha=1;ctx.fillStyle=lit;
   for(const tip of TIPS){const [x,y]=at(tip);ctx.beginPath();ctx.arc(x,y,2.4,0,Math.PI*2);ctx.fill()}
  }
  ctx.globalAlpha=1;
 }
}
