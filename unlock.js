export async function unlockVault(url, username, password) {
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw Error('無法下載影像，請稍後再試');
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength<50 || buffer.byteLength>16*1024**2)throw Error('影像包大小異常');
  const bytes=new Uint8Array(buffer);
  if(new TextDecoder().decode(bytes.slice(0,6))!=='M3DE01')throw Error('影像包版本不支援');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(`${username.trim().toUpperCase()}\0${password}`),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:bytes.slice(6,22),iterations:600000},material,{name:'AES-GCM',length:256},false,['decrypt']);
  let clear;
  try {clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(22,34)},key,bytes.slice(34));}
  catch {throw Error('帳號或密碼不正確');}
  const data=JSON.parse(new TextDecoder().decode(clear));
  new Uint8Array(clear).fill(0);
  if(!Array.isArray(data.datasets)||data.datasets.length>8)throw Error('影像清單異常');
  return data.datasets;
}
