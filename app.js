import { unlockVault } from './unlock.js';
import { Niivue } from './vendor/niivue-0.58.0.js';

const $ = id => document.getElementById(id);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_VOXELS = 256 ** 3;
let nv, current, loading = false;
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

async function decodePackage(p) {
  if (p.format !== 'medical-3d-display-stack-v1' || p.calibrated !== false || p.orientationKnown !== false)
    throw Error('不支援的影像包格式');
  if (!Array.isArray(p.framesBase64) || p.framesBase64.length < 8 || p.framesBase64.length > 256)
    throw Error('影像包需包含 8–256 張圖片');
  if (p.dimensions?.[0] !== 256 || p.dimensions?.[1] !== 256 || p.dimensions?.[2] !== p.framesBase64.length)
    throw Error('影像尺寸與張數不符');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const voxels = new Uint8Array(256 * 256 * p.framesBase64.length);
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
      ctx.drawImage(bitmap, 0, 0, 256, 256);
      const rgba = ctx.getImageData(0, 0, 256, 256).data;
      // Raster row 0 is the screen top; NIfTI's displayed Y increases upward.
      // This preserves the original 2D display, without assigning patient directions.
      for (let v = 0; v < 256 * 256; v++) {
        const target=i*256*256+(255-Math.floor(v/256))*256+v%256;
        voxels[target] = Math.round(.299 * rgba[v*4] + .587 * rgba[v*4+1] + .114 * rgba[v*4+2]);
      }
    } finally { bitmap.close(); }
  }
  return {buffer:nifti(voxels, p.dimensions, [1,1,4]), dims:p.dimensions,
    label:String(p.label || '本機顯示影像').slice(0,100), kind:'JPEG 堆疊',
    notice:'PACS 顯示圖片堆疊。Z 軸 4× 僅為展示比例；方向、切片間距與毫米尺度未校準，不可用於距離或手術路徑判斷。',
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
  await nv.loadFromArrayBuffer(data.buffer, 'volume.nii');
  // NiiVue appends by default. Keep one study only, never silently fuse datasets.
  previous.forEach(volume => nv.removeVolume(volume));
  if(nv.volumes.length!==1)throw Error('影像切換未完成');
  current = data;
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
  reset();
  document.title = 'Medical 3D · 影像工作台';
  document.body.dataset.ready = 'true';
  status('已載入 · 本機顯示');
}

async function guarded(work) {
  if (loading) return;
  loading=true; $('dataset').disabled=true; $('openFile').disabled=true;
  const controls=[...document.querySelectorAll('aside input, aside button, .quick-views button')];
  controls.forEach(c=>c.disabled=true);
  try { await work(); } catch(e) { failure(e); }
  finally {loading=false;$('dataset').disabled=false;$('openFile').disabled=false;controls.forEach(c=>c.disabled=false);$('clip').disabled=!$('clipEnabled').checked;}
}

function mode(value) {
  nv.setSliceType(value);
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',Number(b.dataset.mode)===value));
  $('viewLabel').textContent=({4:'3D VOLUME',0:'SLICE STACK',3:'MULTIPLANAR + 3D'})[value];
}
function slice() {
  if(!current)return;
  nv.scene.crosshairPos[2]=Number($('slice').value)/Math.max(1,current.dims[2]-1);
  $('sliceValue').textContent=`${Number($('slice').value)+1} / ${current.dims[2]}`;
  nv.drawScene();
}
function windowing() {
  if(!nv.volumes.length)return;
  let low=Number($('contrast').value),high=Number($('ceiling').value);
  const step=Number($('contrast').step);
  if(high<=low){low=Math.max(Number($('contrast').min),high-step);$('contrast').value=low;}
  $('contrastValue').textContent=Number(low.toFixed(2));$('ceilingValue').textContent=Number(high.toFixed(2));
  nv.volumes[0].cal_min=low;nv.volumes[0].cal_max=high;nv.updateGLVolume();
}
function clipping() { $('clip').disabled=!$('clipEnabled').checked;nv.setClipPlane([$ ('clipEnabled').checked?Number($('clip').value)/100:2,0,0]); }
function reset() {
  $('contrast').value=current.window[0];$('ceiling').value=current.window[1];$('opacity').value=100;$('opacityValue').textContent='100%';
  $('clipEnabled').checked=false;$('clip').value=0;
  nv.scene.crosshairPos=[.5,.5,.5]; nv.setScale(1);nv.setRenderAzimuthElevation(135,15);
  nv.setOpacity(0,1);windowing();clipping();slice();mode(4);
}

async function start() {
  nv = new Niivue({backColor:[.031,.059,.075,1],textHeight:0,isOrientationTextVisible:false,isOrientCube:false,isRuler:false,
    show3Dcrosshair:false,isColorbar:false,showLegend:false,dragAndDropEnabled:false,dragMode:0,multiplanarShowRender:1,
    crosshairColor:[.7,.86,.79,1],clipPlaneColor:[.5,.7,.6,.12],multiplanarLayout:2,crosshairWidth:1,forceDevicePixelRatio:1,loadingText:'',logLevel:'error'});
  await nv.attachToCanvas($('gl'));
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
  $('modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(b)mode(Number(b.dataset.mode));};
  $('slice').oninput=slice;$('contrast').oninput=windowing;$('ceiling').oninput=windowing;
  $('opacity').oninput=()=>{$('opacityValue').textContent=$('opacity').value+'%';if(nv.volumes.length)nv.setOpacity(0,Number($('opacity').value)/100);};
  $('clipEnabled').onchange=clipping;$('clip').oninput=clipping;$('reset').onclick=reset;
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{mode(4);nv.setRenderAzimuthElevation(...({front:[0,0],side:[90,0],top:[0,90]})[b.dataset.view]);});
  nv.onLocationChange=()=>{if(current){const z=Math.round(nv.scene.crosshairPos[2]*(current.dims[2]-1));$('slice').value=z;$('sliceValue').textContent=`${z+1} / ${current.dims[2]}`;}};
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
        addDatasets(items);enter();$('lock').hidden=false;$('dataset').value=items[0].id;
        await guarded(async()=>show(await decodePackage(items[0].data)));
      }catch(error){$('loginStatus').textContent=error.message;}
      finally{$('unlock').disabled=false;}
    };
    $('lock').onclick=()=>location.reload();
  }else{addDatasets(config.datasets||[]);enter();await guarded(()=>show(phantom()));}
}
start().catch(e=>{$('loginStatus').textContent=e.message;$('empty').hidden=false;$('empty').textContent='無法啟動 3D 顯示。請使用支援 WebGL2 的 Safari／Chrome。';failure(e);});
