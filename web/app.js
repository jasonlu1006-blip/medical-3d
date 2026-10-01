import { showFamily } from './family.js?v=20261001-family1';
import { unlockVault } from './unlock.js';
import { Niivue } from './vendor/niivue-0.58.0.js';

const $ = id => document.getElementById(id);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_VOXELS = 256 ** 3;
let nv, current, loading = false, activeMode = 'slice', rotationFrame = 0, rotationTime = 0;
const catalog = new Map();

function status(text) { $('state').textContent = text; }
function failure(error) {
  console.error(error);
  status('無法載入');
  $('notice').textContent = `未載入新資料：${error.message}。目前顯示保留上一份影像。`;
}

// The demo has no anatomical affine or millimetre units. Spacing only sets display proportions.
function nifti(data, dims, spacing = [1, 1, 1]) {
  const buffer = new ArrayBuffer(352 + data.length);
  const h = new DataView(buffer);
  h.setInt32(0, 348, true); h.setInt16(40, 3, true);
  dims.forEach((d, i) => h.setInt16(42 + i * 2, d, true));
  h.setInt16(48, 1, true); h.setInt16(70, 2, true); h.setInt16(72, 8, true);
  h.setFloat32(76, 1, true);
  spacing.forEach((d, i) => h.setFloat32(80 + i * 4, d, true));
  h.setFloat32(108, 352, true); h.setFloat32(112, 1, true);
  h.setUint8(123, 0); // units unknown
  h.setFloat32(124, 220, true); h.setFloat32(128, 25, true);
  new Uint8Array(buffer, 148, 40).set(new TextEncoder().encode('UNCALIBRATED DISPLAY ONLY').slice(0, 40));
  new Uint8Array(buffer, 344, 4).set([110, 43, 49, 0]);
  new Uint8Array(buffer, 352).set(data);
  return buffer;
}

function phantom() {
  const n = 96, data = new Uint8Array(n ** 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x - 47.5) / 35, dy = (y - 47.5) / 39, dz = (z - 47.5) / 32;
    const r = dx * dx + dy * dy + dz * dz;
    let v = r < 1 ? 115 + 35 * Math.sin(x / 5) * Math.cos(z / 6) : 0;
    if (r > .82 && r < 1) v = 195;
    if ((x - 58) ** 2 + (y - 50) ** 2 + (z - 51) ** 2 < 10 ** 2) v = 250;
    if ((x - 35) ** 2 + (y - 44) ** 2 + (z - 48) ** 2 < 9 ** 2) v = 15;
    data[x + y * n + z * n * n] = v;
  }
  return { buffer: nifti(data, [n, n, n]), label: '合成幾何 · 功能測試', kind: '合成測試', dims: [n,n,n],
    notice: '合成幾何，僅用於驗證顯示與操作，並非病例影像。', note: '合成幾何 · 非病例影像' };
}

function base64Bytes(value) {
  if (typeof value !== 'string' || value.length > 3 * 1024 * 1024) throw Error('單張圖片超出限制');
  const raw = atob(value); return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function decodeBrain(info,count){
  if(!info)return null;
  if(info.format!=='brain-candidate-v1'||info.candidate!==true||info.geometryVerified!==false||info.mask?.encoding!=='rle-u32le-base64'||info.mask.voxels!==count)throw Error('腦分割資料格式不符');
  const r=info.mask;if(![0,1].includes(r.first)||typeof r.runs!=='string'||r.runs.length>4*1024*1024)throw Error('分割遮罩大小異常');
  const bytes=Uint8Array.from(atob(r.runs),c=>c.charCodeAt(0));if(bytes.length%4)throw Error('分割遮罩不完整');
  const view=new DataView(bytes.buffer),mask=new Uint8Array(count);let offset=0,value=r.first;
  for(let i=0;i<bytes.length;i+=4){const n=view.getUint32(i,true);if(!n||offset+n>count)throw Error('分割遮罩越界');if(value)mask.fill(1,offset,offset+n);offset+=n;value=1-value;}
  if(offset!==count)throw Error('分割遮罩體素數不符');
  if(typeof info.meshOBJ!=='string'||info.meshOBJ.length>12*1024*1024||info.surfaceFaces>160000)throw Error('表面模型超出限制');
  return {mask,obj:info.meshOBJ,vertices:info.surfaceVertices,faces:info.surfaceFaces};
}

async function decodePackage(p) {
  if (p.format !== 'medical-3d-display-stack-v1' || p.calibrated !== false || p.orientationKnown !== false)
    throw Error('不支援的影像包格式');
  if (!Array.isArray(p.framesBase64) || p.framesBase64.length < 8 || p.framesBase64.length > 256)
    throw Error('影像包需包含 8–256 張圖片');
  if (p.dimensions?.[0] !== 256 || p.dimensions?.[1] !== 256 || p.dimensions?.[2] !== p.framesBase64.length)
    throw Error('影像尺寸與張數不符');
  const size=p.framesBase64.length<=64?512:256;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const voxels = new Uint8Array(size * size * p.framesBase64.length);
  let sourceShape = '';
  for (let i = 0; i < p.framesBase64.length; i++) {
    status(`讀取切片 ${i + 1} / ${p.framesBase64.length}`);
    const bytes = base64Bytes(p.framesBase64[i]);
    if (bytes[0] !== 255 || bytes[1] !== 216) throw Error('影像包包含非 JPEG 檔案');
    const bitmap = await createImageBitmap(new Blob([bytes], {type:'image/jpeg'}));
    try {
      const shape = `${bitmap.width}x${bitmap.height}`;
      if (bitmap.width > 2048 || bitmap.height > 2048 || (sourceShape && sourceShape !== shape)) throw Error('來源圖片尺寸不一致或過大');
      sourceShape = shape;
      ctx.drawImage(bitmap, 0, 0, size, size);
      const rgba = ctx.getImageData(0, 0, size, size).data;
      // Raster row 0 is the screen top; NIfTI's displayed Y increases upward.
      // This preserves the original 2D display, without assigning patient directions.
      for (let v = 0; v < size * size; v++) {
        const target=i*size*size+(size-1-Math.floor(v/size))*size+v%size;
        voxels[target] = Math.round(.299 * rgba[v*4] + .587 * rgba[v*4+1] + .114 * rgba[v*4+2]);
      }
    } finally { bitmap.close(); }
  }
  const dims=[size,size,p.framesBase64.length],spacing=[256/size,256/size,4];
  const brain=decodeBrain(p.brainExtraction,256*256*dims[2]);
  if(brain&&size===512){const mask=new Uint8Array(voxels.length);for(let z=0;z<dims[2];z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)mask[z*size*size+y*size+x]=brain.mask[z*65536+(y>>1)*256+(x>>1)];brain.mask=mask;}
  return {buffer:nifti(voxels, dims, spacing), dims,spacing,brain,familyPackage:p,
    label:String(p.label || '本機顯示影像').slice(0,100), kind:'JPEG 堆疊',
    notice:'PACS 顯示圖片堆疊。體積比例為展示設定；方向、切片間距與毫米尺度未校準，不可用於距離或手術路徑判斷。',
    note:'未校準影像堆疊 · 非解剖比例'};
}

function inspectNifti(buffer, label) {
  if (buffer.byteLength < 352 || buffer.byteLength > MAX_BYTES) throw Error('NIfTI 檔案需為 352 bytes 至 64 MiB');
  const v = new DataView(buffer); const le = v.getInt32(0, true) === 348;
  if (!le && v.getInt32(0, false) !== 348) throw Error('目前支援未壓縮 NIfTI-1 .nii；DICOM／.nii.gz 需先轉換');
  if (v.getUint8(344) !== 110 || v.getUint8(345) !== 43 || v.getUint8(346) !== 49) throw Error('需要單一檔案 NIfTI-1');
  if (v.getInt16(40, le) !== 3) throw Error('第一版只接受單一 3D volume');
  const dims = [0,1,2].map(i=>v.getInt16(42+i*2, le));
  const count = dims.reduce((a,b)=>a*b,1);
  if (dims.some(d=>d<2 || d>512) || count>MAX_VOXELS) throw Error('體積超出第一版容量限制');
  const datatype = v.getInt16(70,le), bits = v.getInt16(72,le);
  if (!({2:8,4:16,8:32,16:32,64:64,256:8,512:16,768:32}[datatype] === bits)) throw Error('不支援的 NIfTI 數值格式');
  const offset=v.getFloat32(108,le);
  if (!Number.isInteger(offset)||offset<352||offset+count*bits/8>buffer.byteLength) throw Error('NIfTI 像素資料不完整');
  for(let i=0;i<3;i++) if(!(v.getFloat32(80+i*4,le)>0) || !Number.isFinite(v.getFloat32(80+i*4,le))) throw Error('無效的體素間距');
  return {buffer,label,kind:'NIfTI',dims,notice:'已載入 NIfTI 檔案內的幾何。仍需與原始影像核對方向、尺度和完整性；本版不提供臨床測量。',note:'外部 NIfTI · 幾何尚待核對'};
}

async function show(data) {
  status('建立三維紋理…');
  const previous = [...nv.volumes];
  [...nv.meshes].forEach(mesh=>nv.removeMesh(mesh));
  await nv.loadFromArrayBuffer(data.buffer, 'volume.nii');
  // NiiVue appends by default. Keep one study only, never silently fuse datasets.
  previous.forEach(volume => nv.removeVolume(volume));
  if(nv.volumes.length!==1)throw Error('影像切換未完成');
  current = data;
  current.rawImg=nv.volumes[0].img.slice();
  if(data.brain){
    const masked=current.rawImg.slice();for(let i=0;i<masked.length;i++)if(!data.brain.mask[i])masked[i]=0;
    current.brainImg=masked;
    const maskBuffer=nifti(data.brain.mask,data.dims,data.spacing);
    const maskHeader=new DataView(maskBuffer);maskHeader.setFloat32(124,1,true);maskHeader.setFloat32(128,0,true);
    await nv.loadFromArrayBuffer(maskBuffer,'brain-mask.nii');
    nv.volumes[1].cal_min=.5;nv.volumes[1].cal_max=1;nv.setColormap(nv.volumes[1].id,'green');nv.setOpacity(1,0);
    const mesh=await nv.addMeshFromUrl({url:'brain-candidate.obj',buffer:new TextEncoder().encode(data.brain.obj).buffer,rgba255:[213,185,171,255]});
    current.brainMesh=mesh;nv.setMeshProperty(mesh.id,'visible',false);
  }
  document.querySelectorAll('[data-needs-brain]').forEach(b=>b.hidden=!data.brain);

  current.window = data.kind==='NIfTI' ? [nv.volumes[0].cal_min, nv.volumes[0].cal_max] : [25,220];
  const min=data.kind==='NIfTI'?Math.floor(nv.volumes[0].global_min):0;
  const max=data.kind==='NIfTI'?Math.ceil(nv.volumes[0].global_max):255;
  for(const id of ['contrast','ceiling']){$(id).min=min;$(id).max=Math.max(min+1,max);$(id).step=data.kind==='NIfTI'?Math.max(.001,(max-min)/1000):1;}
  $('title').textContent = data.label; $('kind').textContent = data.kind;
  $('dimensions').textContent = data.dims.join(' × ');
  $('resolution').textContent = `${data.dims[2]} 張切片`;
  $('notice').textContent = data.notice; $('details').textContent = data.notice;
  $('canvasNote').textContent = data.note;
  $('slice').max=data.dims[2]-1; $('slice').value=Math.floor(data.dims[2]/2);
  await reset();
  document.title = 'Medical 3D · Brain Explorer';
  document.body.dataset.ready = 'true';
  status('已載入 · 本機顯示');
  showFamily(data.familyPackage);
}

async function guarded(work) {
  if (loading) return;
  stopRotation();loading=true; $('dataset').disabled=true; $('openFile').disabled=true;
  const controls=[...document.querySelectorAll('#previewSlice, #rotate, #reset, aside input, aside button, aside select, #cutControls input, #cutControls select, #cutControls button, #modes button, .slice-navigation input, .quick-views button')];
  controls.forEach(c=>c.disabled=true);
  try { await work(); } catch(e) { failure(e); }
  finally {loading=false;$('dataset').disabled=false;$('openFile').disabled=false;controls.forEach(c=>c.disabled=false);}
}

const cutViews = [[0,0],[90,0],[0,90]];
async function mode(value) {
  stopRotation();activeMode=value;document.body.dataset.viewMode=value;
  if(['brain','tissue','review'].includes(value)&&!current?.brain)throw Error('這份影像尚無腦分割');
  const internal=value==='planes'||value==='multi';
  const isolated=value==='brain'||value==='tissue'||(value==='cut'&&current?.brain);
  if(current?.rawImg){nv.volumes[0].img=isolated?current.brainImg:current.rawImg;nv.updateGLVolume();}
  if(current?.brainMesh)nv.setMeshProperty(current.brainMesh.id,'visible',value==='brain');
  if(nv.volumes.length>1)nv.setOpacity(1,value==='review'?.42:0);
  nv.setOpacity(0,value==='brain'?0:Number($('opacity').value)/100);

  const sculpted=isolated&&value!=='brain'&&$('renderStyle').value!=='flat';
  nv.setColormap(nv.volumes[0].id,sculpted&&$('renderStyle').value==='warm'?'brainWarm':'gray');
  nv.setGamma(sculpted?1.45:1);
  await nv.setVolumeRenderIllumination(internal?-1:sculpted?.7:0);
  // Illumination refreshes the base layer; rebuild overlays afterwards.
  nv.updateGLVolume();
  nv.setSliceType(['slice','review'].includes(value)?0:value==='multi'?3:4);
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===value));
  $('sceneTitle').textContent=({brain:'腦的輪廓。',tissue:'腦內，另一個視角。',review:'讓分割，回到原片。',planes:'走進影像的空間。',cut:'從表面，走進內部。',slice:'回到影像本身。',multi:'讓每個視角連在一起。'})[value];
  $('viewLabel').textContent=({brain:'BRAIN ENVELOPE',tissue:'BRAIN / VOLUME EXPLORER',review:'MASK OVER SOURCE',planes:'3D INTERNAL PLANES',cut:'VOLUME CUTAWAY',slice:'SOURCE SLICE',multi:'INTERNAL PLANES + SLICES'})[value];
  $('modeHelp').textContent=({brain:'腦部候選分割的獨立表面。拖曳旋轉；可用「核對分割」檢查邊界。',tissue:'僅顯示候選腦區域內的 MRI 訊號，頭皮等外層已依遮罩移除。',review:'綠色為模型選取的腦區域。逐張換片，檢查有無漏選或誤選。',planes:'三個內部切面可旋轉；下方滑桿移動切面，查看腦內影像。',cut:current?.brain?'只顯示分割後的腦組織，並剖開露出內部 MRI。拖曳旋轉；下方可調剖切方向與深度。':'已移除半側體積。可調剖切方向與深度。',slice:'直接查看原切片方向的影像，滑動下方「原切片位置」逐張查看。',multi:'點選切片移動交點，同時對照三個重切面與立體切面。'})[value];
  $('gestureHelp').textContent=['slice','review'].includes(value)?'點選移動交點 · 下方滑桿換片':'單指拖曳旋轉 · 雙指縮放';
  $('cutControls').hidden=value!=='cut';
  document.querySelector('.quick-views').hidden=['slice','review'].includes(value);
  $('sourceCard').hidden=!current.brain||['slice','review','multi'].includes(value);
  document.querySelector('.slice-navigation').hidden=['cut','brain','tissue'].includes(value);
  if(internal||isolated)nv.setRenderAzimuthElevation(135,160);
  $('canvasNote').textContent=(isolated||value==='review')?'AI 候選分割 · 幾何未校準':current.note;
  $('notice').textContent=(isolated||value==='review')?'SynthStrip 從顯示 JPEG 估計的腦部遮罩。尚未人工逐界核定；不是腫瘤分割，也不代表完整腦溝表面。方向與毫米尺度未校準。':current.notice;
  document.querySelectorAll('.reslice-control').forEach(el=>el.hidden=['slice','review','cut'].includes(value));
  // A camera-facing central clip is enabled whenever cutaway is selected.
  if(value==='cut'){clipping();nv.setRenderAzimuthElevation(135,145);}else{nv.setClipPlane([2,0,0]);}
  nv.setScale(current?.brain?(['cut','brain','tissue'].includes(value)?(innerWidth<621?1.45:1.12):1):1);
  nv.drawScene();drawSource();
}
function syncSlices() {
  if(!current)return;
  for(const [id,axis] of [['slice',2],['sliceX',0],['sliceY',1]]){
    const maximum=current.dims[axis]-1;
    const value=Math.max(0,Math.min(maximum,Math.round(nv.scene.crosshairPos[axis]*maximum)));
    $(id).max=maximum;$(id).value=value;
    $(id+'Value').textContent=`${value+1} / ${current.dims[axis]}`;
  }
  drawSource();
}
function slice(id='slice',axis=2) {
  if(!current)return;
  nv.scene.crosshairPos[axis]=Number($(id).value)/Math.max(1,current.dims[axis]-1);
  syncSlices();nv.drawScene();
}
function windowing() {
  if(!nv.volumes.length)return;
  let low=Number($('contrast').value),high=Number($('ceiling').value);
  const step=Number($('contrast').step);
  if(high<=low){low=Math.max(Number($('contrast').min),high-step);$('contrast').value=low;}
  $('contrastValue').textContent=Number(low.toFixed(2));$('ceilingValue').textContent=Number(high.toFixed(2));
  nv.volumes[0].cal_min=low;nv.volumes[0].cal_max=high;nv.updateGLVolume();
}
function clipping() {
  const angle=cutViews[Number($('clipAxis').value)];
  nv.setClipPlane([Number($('clip').value)/100,...angle]);
  $('clipValue').textContent=$('clip').value==='0'?'中央':$('clip').value+'%';
}
function faceCut() {nv.setRenderAzimuthElevation(...cutViews[Number($('clipAxis').value)]);}
async function reset() {
  $('contrast').value=current.window[0];$('ceiling').value=current.window[1];$('opacity').value=100;$('opacityValue').textContent='100%';
  $('clip').value=0;$('clipAxis').value='2';
  nv.scene.crosshairPos=[.5,.5,.5];nv.setScale(current.brain?2.2:1);nv.setRenderAzimuthElevation(120,40);
  nv.setOpacity(0,1);windowing();syncSlices();if(current.brainMesh)nv.setMeshProperty(current.brainMesh.id,'opacity',1);await mode(current.brain?'cut':'slice');
}

// Procedural neutral studio lighting, not anatomical image generation.
function softLightMatcap(){
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),img=ctx.createImageData(128,128);
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){const nx=(x-63.5)/63.5,ny=(63.5-y)/63.5,nz=Math.sqrt(Math.max(0,1-nx*nx-ny*ny));const diffuse=Math.max(0,-.36*nx+.48*ny+.8*nz),fill=Math.max(0,.6*nx-.1*ny+.3*nz);const v=Math.min(255,255*(.23+.48*diffuse+.12*fill));const i=(y*128+x)*4;img.data[i]=img.data[i+1]=img.data[i+2]=v;img.data[i+3]=255;}
  ctx.putImageData(img,0,0);return c.toDataURL();
}
function setSettings(open){$('settingsPanel').hidden=!open;$('settingsToggle').setAttribute('aria-expanded',String(open));if(!open)$('settingsToggle').focus();}
function stopRotation(){if(rotationFrame)cancelAnimationFrame(rotationFrame);rotationFrame=0;rotationTime=0;$('rotate').setAttribute('aria-pressed','false');}
function startRotation(){
  if(!current||!['tissue','brain','cut','multi'].includes(activeMode))return;
  $('rotate').setAttribute('aria-pressed','true');
  const frame=t=>{if(rotationTime&&t-rotationTime<33){rotationFrame=requestAnimationFrame(frame);return;}const dt=rotationTime?Math.min((t-rotationTime)/1000,.1):0;rotationTime=t;nv.setRenderAzimuthElevation(nv.scene.renderAzimuth+dt*10,nv.scene.renderElevation);rotationFrame=requestAnimationFrame(frame);};
  rotationFrame=requestAnimationFrame(frame);
}
function drawSource(){
  if(!current?.brain||!current.rawImg)return;
  const z=Math.max(0,Math.min(current.dims[2]-1,Math.round(nv.scene.crosshairPos[2]*(current.dims[2]-1))));
  $('previewSlice').max=current.dims[2]-1;$('previewSlice').value=z;$('previewValue').textContent=`${z+1} / ${current.dims[2]}`;
  if(current.previewZ===z)return;current.previewZ=z;
  const ctx=$('sourcePreview').getContext('2d'),pixels=ctx.createImageData(256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const n=current.dims[0],sy=Math.floor(y*n/256),sx=Math.floor(x*n/256),v=current.rawImg[z*n*n+(n-1-sy)*n+sx],i=(y*256+x)*4;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);
}

async function start(inputPackage,items=[]) {
  nv = new Niivue({backColor:[.03137,.05098,.07843,1],textHeight:0,isOrientationTextVisible:false,isOrientCube:false,isRuler:false,
    show3Dcrosshair:false,isColorbar:false,showLegend:false,dragAndDropEnabled:false,dragMode:0,multiplanarShowRender:1,
    crosshairColor:[.7,.86,.79,1],clipPlaneColor:[0,0,0,0],multiplanarLayout:2,crosshairWidth:1,forceDevicePixelRatio:Math.min(devicePixelRatio,1.5),loadingText:'',logLevel:'error'});
  await nv.attachToCanvas($('gl'));
  await nv.loadMatCapTexture(softLightMatcap());
  nv.addColormap('brainWarm',{I:[0,38,90,160,220,255],R:[0,70,154,219,246,255],G:[0,62,126,191,231,253],B:[0,65,120,175,214,243],A:[0,16,70,150,215,255]});
  $('settingsToggle').onclick=()=>setSettings($('settingsPanel').hidden);$('settingsClose').onclick=()=>setSettings(false);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')setSettings(false);});
  $('renderStyle').onchange=()=>guarded(()=>mode(activeMode));
  $('rotate').onclick=()=>rotationFrame?stopRotation():startRotation();
  $('gl').addEventListener('pointerdown',stopRotation);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRotation();});
  $('previewSlice').oninput=()=>{$('slice').value=$('previewSlice').value;slice();};
  $('gl').addEventListener('webglcontextlost',e=>{e.preventDefault();status('顯示中斷，請重新整理');$('empty').hidden=false;$('empty').textContent='Safari 顯示記憶體已釋放。請重新整理後載入較小的體積。';});
  $('dataset').addEventListener('change',()=>guarded(async()=>{
    if($('dataset').value==='phantom')return show(phantom());
    const item=catalog.get($('dataset').value);
    if(item.data)return show(await decodePackage(item.data));
    const response=await fetch(item.url,{cache:'no-store'});
    if(!response.ok)throw Error('影像服務未提供此檔案');
    const blob=await response.blob();if(blob.size>MAX_BYTES)throw Error('影像包超過 64 MiB');
    await show(await decodePackage(JSON.parse(await blob.text())));
  }));
  $('openFile').onclick=()=>$('file').click();
  $('file').onchange=()=>guarded(async()=>{
    const f=$('file').files[0];if(!f)return;
    if(f.size>MAX_BYTES)throw Error('第一版單檔上限 64 MiB');
    let data;
    if(f.name.toLowerCase().endsWith('.m3d'))data=await decodePackage(JSON.parse(await f.text()));
    else if(f.name.toLowerCase().endsWith('.nii'))data=inspectNifti(await f.arrayBuffer(),f.name);
    else throw Error('請選擇 .m3d 或未壓縮 .nii');
    await show(data);
    $('dataset').querySelector('option[value="local"]')?.remove();
    const local=document.createElement('option');local.value='local';local.textContent=data.label;local.disabled=true;
    $('dataset').append(local);$('dataset').value='local';$('file').value='';
  });
  $('modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(b)guarded(()=>mode(b.dataset.mode));};
  $('slice').oninput=()=>slice();$('sliceX').oninput=()=>slice('sliceX',0);$('sliceY').oninput=()=>slice('sliceY',1);$('contrast').oninput=windowing;$('ceiling').oninput=windowing;
  $('opacity').oninput=()=>{$('opacityValue').textContent=$('opacity').value+'%';if(nv.volumes.length){const alpha=Number($('opacity').value)/100;const surface=document.querySelector('[data-mode=brain]')?.classList.contains('active');nv.setOpacity(0,surface?0:alpha);if(current?.brainMesh)nv.setMeshProperty(current.brainMesh.id,'opacity',alpha);}};
  $('clipAxis').onchange=()=>{clipping();faceCut();};$('clip').oninput=clipping;$('faceCut').onclick=faceCut;$('reset').onclick=()=>guarded(reset);
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{stopRotation();nv.setRenderAzimuthElevation(...({front:[0,0],side:[90,0],top:[0,90]})[b.dataset.view]);});
  nv.onLocationChange=syncSlices;
  if(inputPackage){for(const d of items)catalog.set(d.id,d);await guarded(async()=>show(await decodePackage(inputPackage)));return;}
  const localHost=['localhost','127.0.0.1'].includes(location.hostname) || /^192\.168\./.test(location.hostname);
  let config;
  const r=await fetch(localHost?'./api/catalog':'./catalog.json',{cache:'no-store'});
  if(!r.ok)throw Error('無法取得影像清單');
  config=await r.json();
  function addDatasets(items){for(const d of items){catalog.set(d.id,d);const o=document.createElement('option');o.value=d.id;o.textContent=d.label;$('dataset').append(o);}}
  const enter=()=>{$('login').hidden=true;document.body.classList.remove('locked');window.dispatchEvent(new Event('resize'));};
  if(config.encrypted){
    $('loginForm').onsubmit=async e=>{
      e.preventDefault();$('unlock').disabled=true;$('loginStatus').textContent='下載並解鎖影像…';
      const password=$('password').value;$('password').value='';
      try{
        const items=await unlockVault(config.encrypted.url,$('username').value,password);
        addDatasets(items);enter();$('lock').hidden=false;$('dataset').value=items.at(-1).id;
        await guarded(async()=>show(await decodePackage(items.at(-1).data)));
      }catch(error){$('loginStatus').textContent=error.message;}
      finally{$('unlock').disabled=false;}
    };
    $('lock').onclick=()=>location.reload();
  }else{addDatasets(config.datasets||[]);enter();if(config.datasets?.length){$('dataset').value=config.datasets.at(-1).id;$('dataset').dispatchEvent(new Event('change'));}else await guarded(()=>show(phantom()));}
}
export async function openExplorer(p,items=[]){if(!nv)await start(p,items);else await guarded(async()=>show(await decodePackage(p)));}
