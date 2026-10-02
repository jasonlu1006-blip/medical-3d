import * as T from './vendor/three-0.180.0/three.module.min.js';
import {OrbitControls} from './vendor/three-0.180.0/OrbitControls.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let active,callbacks={},generation=0;
export function configureScene(c){callbacks=c;}
const vertex=`out vec3 worldPos;void main(){worldPos=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(worldPos,1.);}`;
const fragment=`precision highp float;precision highp sampler3D;
uniform sampler3D volume;uniform vec3 eye;uniform vec3 extent;uniform float strength;uniform float depth;uniform float cutY;uniform bool cutting;uniform bool showPlane;
in vec3 worldPos;out vec4 outColor;
float signalAt(vec3 p){vec3 uv=vec3(p.x/extent.x+.5,.5-p.z/extent.z,.5-p.y/extent.y);uv.z=(uv.z*(depth-1.)+.5)/depth;return texture(volume,uv).r;}
void main(){vec3 ray=normalize(worldPos-eye);vec3 inv=1./ray;vec3 nearV=(-extent*.5-eye)*inv,farV=(extent*.5-eye)*inv;vec3 lo=min(nearV,farV),hi=max(nearV,farV);float begin=max(max(lo.x,lo.y),lo.z);float end=min(min(hi.x,hi.y),hi.z);begin=max(begin,0.);if(end<=begin)discard;float dt=(end-begin)/192.;float planeT=(cutY-eye.y)/ray.y;vec4 accum=vec4(0.);for(int i=0;i<192;i++){float t=begin+(float(i)+.5)*dt;vec3 p=eye+ray*t;if(showPlane&&planeT>=t-dt*.5&&planeT<t+dt*.5){float pv=signalAt(eye+ray*planeT);if(pv>.035){accum.rgb+=(1.-accum.a)*vec3(pv);accum.a=1.;break;}}if(cutting&&p.y>cutY)continue;float v=signalAt(p);if(v<.035)continue;float a=smoothstep(.06,.48,v)*strength*.095*dt;vec3 n=vec3(signalAt(p+vec3(1.5,0,0))-signalAt(p-vec3(1.5,0,0)),signalAt(p+vec3(0,2.5,0))-signalAt(p-vec3(0,2.5,0)),signalAt(p+vec3(0,0,1.5))-signalAt(p-vec3(0,0,1.5)));float light=.65+.5*abs(dot(normalize(n+vec3(.00001)),normalize(vec3(-.5,1.,.7))));vec3 color=mix(vec3(.32,.38,.41),vec3(1.,.88,.74),smoothstep(.03,.60,v))*light;accum.rgb+=(1.-accum.a)*color*a;accum.a+=(1.-accum.a)*a;if(accum.a>.98)break;}if(accum.a<.008)discard;outColor=vec4(accum.rgb/max(accum.a,.001),accum.a);}`;
function readMask(info,n){
 if(info?.format!=='brain-candidate-v1'||info.geometryVerified!==false||info.mask?.voxels!==n)throw Error('缺少相符的候選腦部遮罩');
 const r=info.mask,raw=atob(r.runs),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length%4)throw Error('遮罩資料不完整');
 const view=new DataView(bytes.buffer),mask=new Uint8Array(n);let offset=0,value=r.first;if(![0,1].includes(value))throw Error('遮罩格式錯誤');
 for(let i=0;i<bytes.length;i+=4){const size=view.getUint32(i,true);if(!size||offset+size>n)throw Error('遮罩長度錯誤');if(value)mask.fill(1,offset,offset+size);offset+=size;value=1-value;}if(offset!==n)throw Error('遮罩長度錯誤');return mask;
}
function initLayout(p){
 if(!$('spatial')){const el=document.createElement('section');el.id='spatial';document.body.append(el);}
 const guide=p.familyGuide;
 $('spatial').innerHTML=`<header class="spatial-header"><div class="spatial-brand"><span>M³</span><div>MEDICAL 3D<small>腦部立體解說</small></div></div><div class="spatial-study"><label class="sr-only" for="spatialStudy">立體檢查日期</label><select id="spatialStudy"></select><button id="spatialLock" ${$('lock').hidden?'hidden':''}>鎖定</button></div></header><div class="spatial-workspace"><section class="spatial-copy"><div class="spatial-kicker">從 MRI，走進腦內</div><h1 id="spatialTitle">把腦部轉過來，<br>看清裡面的位置。</h1><p id="spatialText">拖曳立體大腦。橙色框是原片的閱讀位置，轉動時會一起留在腦內。</p><div class="spatial-location"><i></i><div><span>這次要看的區域</span><strong>${esc(guide.location)}</strong></div></div><nav class="spatial-modes" aria-label="立體觀看方式"><button data-spatial="locate"><span>01</span><b>透明看位置</b><small>腦部、病灶提示一起轉</small></button><button data-spatial="whole"><span>02</span><b>完整看大腦</b><small>旋轉查看影像立體外觀</small></button><button data-spatial="cut"><span>03</span><b>剖開看裡面</b><small>移動剖面，逐層看 MRI</small></button></nav><button id="spatialReport" class="spatial-report">報告與治療說明 ↗</button></section><div class="spatial-stage" id="spatialStage"><canvas id="spatialCanvas" aria-label="可拖曳旋轉的病例 MRI 三維體積，橙框為原片閱讀位置"></canvas><div class="spatial-hint">單指旋轉 · 雙指縮放</div><div class="spatial-tools"><button id="spatialRotate" aria-pressed="false" aria-label="旋轉展示">↻</button><button id="spatialHome" aria-label="回到初始立體視角">⌂</button></div><div class="spatial-tag" id="spatialTag"><i></i><span>原片閱讀位置<small>定位提示，非腫瘤邊界</small></span></div><div class="spatial-orbit-label">INTERACTIVE MRI / 3D</div></div><section class="spatial-source"><div class="source-title"><span>同一層的 MRI</span><output id="spatialFrame"></output></div><img id="spatialSource" alt="與立體剖面相同的原始 MRI 切片"><div class="source-caption" id="spatialCaption">橙框與立體畫面對應同一閱讀區域</div><label for="spatialSlice">逐層查看</label><input id="spatialSlice" type="range" min="0" max="${p.framesBase64.length-1}" value="${guide.frame}"><button id="spatialTarget">回到病灶參考層</button><details><summary>影像來源與範圍</summary><p>由 ${p.framesBase64.length} 張 MRI 顯示圖片建立立體示意。腦部遮罩為 AI 候選；比例為展示設定；左右方向與毫米尺度未校準。橙框只沿用原片的閱讀定位，不代表腫瘤分割或手術切除範圍。</p></details></section></div><footer class="spatial-footer"><span>病例影像立體示意 · 幾何未校準</span><span>橙框＝閱讀提示　米色＝MRI 訊號</span></footer>`;
 for(const option of $('dataset').options){if(option.value==='phantom')continue;const o=option.cloneNode(true);o.textContent=option.textContent.replace(/ · 序列.*/,'');$('spatialStudy').append(o);}$('spatialStudy').value=$('dataset').value;
 $('spatialStudy').onchange=e=>callbacks.onStudy?.(e.target.value);$('spatialLock').onclick=()=>location.reload();
 $('spatialReport').onclick=()=>{active?.pause();setSpatialVisible(false);callbacks.onReport?.(p);};
}
export function setSpatialVisible(yes){$('spatial')?.toggleAttribute('hidden',!yes);document.body.classList.toggle('spatial-mode',yes);if(yes)window.scrollTo(0,0);if(yes){document.body.classList.remove('family-mode');$('family')?.setAttribute('hidden','');active?.resize();}else active?.pause();}
export async function showSpatial(p){
 const token=++generation;active?.dispose();active=null;
 if(!p?.familyGuide||p.dimensions?.join(',')!==`256,256,${p.framesBase64?.length}`||p.framesBase64.length>128)throw Error('這份資料沒有可用的立體解說');
 const g=p.familyGuide;if(!Number.isInteger(g.frame)||g.frame<0||g.frame>=p.framesBase64.length||!Array.isArray(g.roi)||g.roi.length!==4||g.roi.some(v=>!Number.isFinite(v)||v<0||v>768)||g.roi[0]+g.roi[2]>768||g.roi[1]+g.roi[3]>768)throw Error('原片定位資料不完整');
 initLayout(p);setSpatialVisible(true);
 const canvas=$('spatialCanvas'),stage=$('spatialStage');
 let renderer;
 try{renderer=new T.WebGLRenderer({canvas,antialias:false,alpha:true,powerPreference:'high-performance'});}catch{throw Error('此裝置無法啟動 WebGL2 立體畫面，可改用「報告與治療說明」。');}
 renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1:1.35));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=T.SRGBColorSpace;
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(36,1,.1,2000);camera.position.set(210,220,260);
 const controls=new OrbitControls(camera,canvas);controls.enablePan=false;controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=275;controls.maxDistance=780;controls.target.set(0,0,0);controls.autoRotateSpeed=.65;
 const n=p.framesBase64.length,res=n<=64?512:256,mask=readMask(p.brainExtraction,256*256*n),values=new Uint8Array(res*res*n),images=[];
 const helper=document.createElement('canvas');helper.width=helper.height=res;const ctx=helper.getContext('2d',{willReadFrequently:true});const previewHelper=document.createElement('canvas');previewHelper.width=previewHelper.height=256;const previewCtx=previewHelper.getContext('2d',{willReadFrequently:true});
 for(let z=0;z<n;z++){
  if(token!==generation){renderer.dispose();return;}
  const raw=Uint8Array.from(atob(p.framesBase64[z]),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([raw],{type:'image/jpeg'}));ctx.drawImage(bitmap,0,0,res,res);previewCtx.drawImage(bitmap,0,0,256,256);bitmap.close();const rgba=ctx.getImageData(0,0,res,res).data;images.push(previewCtx.getImageData(0,0,256,256).data);
  for(let y=0;y<res;y++)for(let x=0;x<res;x++){const i=z*res*res+(res-1-y)*res+x,mi=z*65536+(255-Math.floor(y*256/res))*256+Math.floor(x*256/res);values[i]=mask[mi]?rgba[(y*res+x)*4]:0;}
 }
 const volumeTexture=new T.Data3DTexture(values,res,res,n);volumeTexture.format=T.RedFormat;volumeTexture.type=T.UnsignedByteType;volumeTexture.minFilter=volumeTexture.magFilter=T.LinearFilter;volumeTexture.unpackAlignment=1;volumeTexture.needsUpdate=true;
 const height=(n-1)*4,extent=new T.Vector3(256,height,256);
 const shader=new T.ShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:fragment,uniforms:{volume:{value:volumeTexture},eye:{value:camera.position.clone()},extent:{value:extent},strength:{value:.23},depth:{value:n},cutY:{value:0},cutting:{value:false},showPlane:{value:true}},side:T.BackSide,transparent:true,depthWrite:false});
 const volume=new T.Mesh(new T.BoxGeometry(256,height,256),shader);volume.renderOrder=2;scene.add(volume);
 const planeCanvas=document.createElement('canvas');planeCanvas.width=planeCanvas.height=256;const planeCtx=planeCanvas.getContext('2d');
 const planeTexture=new T.CanvasTexture(planeCanvas);planeTexture.colorSpace=T.SRGBColorSpace;
 const plane=new T.Mesh(new T.PlaneGeometry(256,256),new T.MeshBasicMaterial({map:planeTexture,side:T.DoubleSide,transparent:true,alphaTest:.05,depthWrite:true}));plane.rotation.x=-Math.PI/2;plane.renderOrder=1;scene.add(plane);
 const roi=p.familyGuide.roi,reference=p.familyGuide.frame,rx=roi[0]/3-128,rz=roi[1]/3-128,rw=roi[2]/3,rh=roi[3]/3,referenceY=height/2-reference*4;
 const points=[[rx,referenceY+.8,rz],[rx+rw,referenceY+.8,rz],[rx+rw,referenceY+.8,rz+rh],[rx,referenceY+.8,rz+rh]].map(v=>new T.Vector3(...v));
 const locator=new T.LineLoop(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:0xffbc77,depthTest:false,transparent:true,opacity:1}));locator.renderOrder=6;scene.add(locator);
 const target=new T.Vector3(rx+rw/2,referenceY,rz+rh/2);
 const orb=new T.Mesh(new T.SphereGeometry(2,16,12),new T.MeshBasicMaterial({color:0xffca8e,depthTest:false}));orb.position.copy(points[0]);orb.renderOrder=6;scene.add(orb);
 const ring=new T.Mesh(new T.RingGeometry(171,171.5,100),new T.MeshBasicMaterial({color:0x48606d,transparent:true,opacity:.23,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=-height/2-13;scene.add(ring);
 let mode='locate',frame=reference,dead=false,request=0,dirty=true,autoUntil=0,last=0;
 const uniforms=shader.uniforms;
 function render(){uniforms.eye.value.copy(camera.position);renderer.render(scene,camera);const q=target.clone().project(camera),rect=stage.getBoundingClientRect();const tag=$('spatialTag');tag.style.left=Math.max(12,Math.min(rect.width-165,(q.x+1)*rect.width/2+28))+'px';tag.style.top=Math.max(58,Math.min(rect.height-80,(-q.y+1)*rect.height/2-65))+'px';tag.hidden=mode==='whole'||frame!==reference;}
 function tick(time){if(dead)return;request=requestAnimationFrame(tick);if(document.hidden||!document.body.classList.contains('spatial-mode'))return;if(time-last<33)return;last=time;if(autoUntil&&time>=autoUntil)pause();const changed=controls.update();if(changed||dirty){render();dirty=false;}}
 function pause(){controls.autoRotate=false;autoUntil=0;$('spatialRotate')?.setAttribute('aria-pressed','false');dirty=true;}
 function resize(){const {width,height}=stage.getBoundingClientRect();if(width<2||height<2)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();dirty=true;}
 function updateSlice(z){frame=z;$('spatialSlice').value=z;$('spatialFrame').textContent=`${z+1} / ${n}`;
  const rgba=new Uint8ClampedArray(images[z]);for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(!mask[z*65536+(255-y)*256+x])rgba[(y*256+x)*4+3]=0;
  planeCtx.putImageData(new ImageData(rgba,256,256),0,0);planeTexture.needsUpdate=true;plane.position.y=height/2-z*4;uniforms.cutY.value=plane.position.y;
  const preview=document.createElement('canvas');preview.width=preview.height=256;const pc=preview.getContext('2d');pc.putImageData(new ImageData(new Uint8ClampedArray(images[z]),256,256),0,0);
  if(z===reference){pc.strokeStyle='#ffca8e';pc.lineWidth=1.4;pc.setLineDash([3,2]);pc.strokeRect(roi[0]/3,roi[1]/3,roi[2]/3,roi[3]/3);}
  $('spatialSource').src=preview.toDataURL('image/png');$('spatialCaption').textContent=z===reference?'橙框：這次病灶的原片閱讀位置':'目前是其他層面；按下方按鈕回到病灶參考層';locator.visible=orb.visible=mode!=='whole'&&z===reference;dirty=true;
 }
 function setMode(value){mode=value;pause();document.querySelectorAll('[data-spatial]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.spatial===mode)));uniforms.strength.value=mode==='locate'?.08:3.0;uniforms.cutting.value=mode==='cut';plane.visible=false;uniforms.showPlane.value=mode!=='whole';locator.visible=orb.visible=mode!=='whole'&&frame===reference;
  $('spatialTitle').innerHTML=({locate:'把腦部轉過來，<br>看清裡面的位置。',whole:'這是影像裡，<br>大腦的立體樣子。',cut:'把上半部打開，<br>看進腦內這一層。'})[mode];
  $('spatialText').textContent=({locate:'拖曳立體大腦。橙色框是原片的閱讀位置，轉動時會一起留在腦內。',whole:'用手指旋轉，從不同角度看 MRI 訊號形成的立體外觀。切換「透明看位置」找回病灶提示。',cut:'滑動「逐層查看」，剖面會穿過大腦；旁邊的 MRI 同步顯示這一層。'})[mode];dirty=true;
 }
 const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(stage);
 controls.addEventListener('start',pause);controls.addEventListener('change',()=>dirty=true);
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pause();$('spatialText').textContent='立體顯示已中斷，請重新整理；可先開啟報告與治療說明。';});
 $('spatialSlice').oninput=e=>{pause();if(mode==='whole')setMode('cut');updateSlice(Number(e.target.value));};$('spatialTarget').onclick=()=>{setMode('locate');updateSlice(reference);camera.position.set(210,220,260);controls.target.set(0,0,0);};
 $('spatialHome').onclick=()=>{pause();camera.position.set(210,220,260);controls.target.set(0,0,0);controls.update();dirty=true;};
 $('spatialRotate').onclick=()=>{if(controls.autoRotate)pause();else{controls.autoRotate=true;autoUntil=0;$('spatialRotate').setAttribute('aria-pressed','true');dirty=true;}};
 document.querySelectorAll('[data-spatial]').forEach(b=>b.onclick=()=>setMode(b.dataset.spatial));
 active={pause,resize,dispose(){dead=true;cancelAnimationFrame(request);resizeObserver.disconnect();controls.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});volumeTexture.dispose();planeTexture.dispose();renderer.dispose();images.length=0;}};
 setMode('cut');updateSlice(reference);resize();controls.update();render();request=requestAnimationFrame(tick);
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches){controls.autoRotate=true;autoUntil=performance.now()+6000;$('spatialRotate').setAttribute('aria-pressed','true');}
 $('spatial').dataset.ready='true';
}
