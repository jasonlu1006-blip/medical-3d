import {unlockVault} from './unlock.js';
import {showFamily,configureFamily,setFamilyVisible} from './family.js?v=20261001-family1';
const $=id=>document.getElementById(id);let items=[],busy=false,viewer;
const wait=document.createElement('div');wait.className='family-loading';wait.hidden=true;wait.setAttribute('role','status');wait.textContent='正在開啟影像解說…';document.body.append(wait);
const errorBox=document.createElement('div');errorBox.id='familyError';errorBox.hidden=true;errorBox.setAttribute('role','alert');document.body.append(errorBox);
async function load(id){const item=items.find(x=>x.id===id);if(!item)throw Error('找不到這次檢查');if(!item.data){const r=await fetch(item.url,{cache:'no-store'});if(!r.ok)throw Error('無法讀取影像');const b=await r.blob();if(b.size>64*1024**2)throw Error('影像超過限制');item.data=JSON.parse(await b.text());}return item.data;}
async function task(fn){if(busy)return;busy=true;wait.hidden=false;errorBox.hidden=true;try{await fn();}catch(e){errorBox.textContent='無法開啟：'+e.message;errorBox.hidden=false;}finally{busy=false;wait.hidden=true;}}
function add(all){items=all;for(const item of items){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;$('dataset').append(option);}}
async function selectStudy(id){await task(async()=>{$('dataset').value=id;showFamily(await load(id));});}
configureFamily({onStudy:selectStudy,onExplore:p=>task(async()=>{wait.textContent='正在準備進階 3D 影像…';viewer??=await import('./app.js?v=20261001-family1');await viewer.openExplorer(p,items);setFamilyVisible(false);wait.textContent='正在開啟影像解說…';})});
function enter(){document.body.classList.remove('locked');$('login').hidden=true;}
async function start(){
 const local=['localhost','127.0.0.1'].includes(location.hostname)||/^192\.168\./.test(location.hostname);
 const r=await fetch(local?'./api/catalog':'./catalog.json',{cache:'no-store'});if(!r.ok)throw Error('無法載入解說清單');const config=await r.json();
 if(config.encrypted){$('loginForm').onsubmit=async e=>{e.preventDefault();$('unlock').disabled=true;$('loginStatus').textContent='正在解鎖影像與說明…';const password=$('password').value;$('password').value='';try{const all=await unlockVault(config.encrypted.url,$('username').value,password);add(all);$('lock').hidden=false;$('lock').onclick=()=>location.reload();await selectStudy(items.at(-1).id);enter();}catch(e){$('loginStatus').textContent=e.message;}finally{$('unlock').disabled=false;}};}
 else{add(config.datasets||[]);if(items.length){await selectStudy(items.at(-1).id);enter();}else{await task(async()=>{viewer??=await import('./app.js?v=20261001-family1');await viewer.openExplorer(null,[]);enter();});}}
}
start().catch(e=>{$('loginStatus').textContent=e.message;});
