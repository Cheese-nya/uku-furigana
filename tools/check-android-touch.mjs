// Uses actual Android input injection on a disposable emulator. Install a debuggable
// copy of the APK first; the deliverable APK remains non-debuggable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const serial=process.env.UKU_TOUCH_EMULATOR||'emulator-5554';
assert.ok(serial.startsWith('emulator-'),'refuse to seed a personal physical device');
const adb=(...args)=>execFileSync('adb',['-s',serial,...args],{encoding:'utf8'}).trim();
let pid='';
for(let i=0;i<40;i++){try{pid=adb('shell','pidof','com.cheese.uku');}catch{}if(pid)break;await new Promise(resolve=>setTimeout(resolve,150));}
assert.ok(pid,'start the APK activity before testing');
adb('forward','tcp:9231',`localabstract:webview_devtools_remote_${pid}`);
const target=(await (await fetch('http://127.0.0.1:9231/json')).json()).find(t=>t.type==='page'&&t.url.startsWith('https://localhost'));
assert.ok(target,'install the internal debug APK for inspection');
const native=JSON.parse(target.description);
const socket=new WebSocket(target.webSocketDebuggerUrl);const pending=new Map();let sequence=0;
await new Promise(resolve=>socket.addEventListener('open',resolve));
socket.addEventListener('message',event=>{const result=JSON.parse(event.data);if(result.id&&pending.has(result.id)){const {resolve,reject}=pending.get(result.id);pending.delete(result.id);if(result.error)reject(Error(JSON.stringify(result.error)));else resolve(result.result);}});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
 await evaluate(`(async()=>{
 const content=Array.from({length:40},(_,i)=>'第'+i+'行。今日はいい天気です。日本語を読みます。').join('\\n');
 const book={bookId:'book:android-touch-qa',title:'Android触摸测试',author:'QA',content,fingerprint:'sha256:'+('a'.repeat(64)),category:'script',format:'txt',coverTheme:'indigo',sourceOverrides:[],chapters:[],readingProgress:{chapterIndex:0,lineIndex:0,percentage:0,updatedAt:Date.now()},bookmarks:[],favorite:false,createdAt:Date.now(),updatedAt:Date.now(),lastReadAt:0};
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('furigana-library-db',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('library'))r.result.createObjectStore('library');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction('library','readwrite'),store=tx.objectStore('library');const r=store.get('database');r.onsuccess=()=>{const old=r.result||{version:2,books:{},folders:{}};store.put({...old,books:{...old.books,[book.bookId]:book}},'database');};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
 localStorage.removeItem('furigana_floating_translation_v1');localStorage.setItem('furigana_active_tab','library');
 setTimeout(()=>{location.href='https://localhost/index.html#library';location.reload();},100);return true;
 })()`);
 await pause(700);
 for(let i=0;i<80;i++){
  const opened=await evaluate(`(()=>{const el=[...document.querySelectorAll('button,[role=button]')].find(b=>b.getAttribute('aria-label')==='Android触摸测试');if(!el)return false;el.click();return true;})()`);
  if(opened)break;await pause(200);
 }
 let state;
 for(let i=0;i<80;i++){
  state=await evaluate(`(()=>{const b=document.querySelector('.ft-button:not(.ft-floating)');if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,dpr:devicePixelRatio,action:getComputedStyle(b).touchAction};})()`);
  if(state)break;await pause(200);
 }
 assert.ok(state,'reader toolbar rendered'); await pause(650);
 await evaluate(`window.nativeTouchTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','click'])document.addEventListener(type,event=>{if(event.target.closest?.('.ft-button'))window.nativeTouchTrace.push({type,trusted:event.isTrusted,pointerType:event.pointerType});});`);
 const point=(x,y)=>[Math.round(native.screenX+x*state.dpr),Math.round(native.screenY+y*state.dpr)];
 const start=point(state.x,state.y),end=point(190,350);
 const commands=[`input touchscreen motionevent DOWN ${start.join(' ')}`,'sleep 0.65'];
 for(let i=1;i<=10;i++)commands.push(`input touchscreen motionevent MOVE ${Math.round(start[0]+(end[0]-start[0])*i/10)} ${Math.round(start[1]+(end[1]-start[1])*i/10)}`,'sleep 0.04');
 commands.push(`input touchscreen motionevent UP ${end.join(' ')}`);
 adb('shell',commands.join('; '));await pause(450);
 const result=await evaluate(`({floating:!!document.querySelector('.ft-floating'),trace:window.nativeTouchTrace,stored:localStorage.getItem('furigana_floating_translation_v1')})`);
 console.log(JSON.stringify({action:state.action,...result}));
 if(process.env.EXPECT_DRAG_FAILURE==='1'){
  assert.equal(result.floating,false);assert.ok(result.trace.some(e=>e.type==='pointercancel'));console.log('REPRODUCED: original APK cancels native touch drag');
 }else{
  assert.equal(state.action,'none');assert.equal(result.floating,true);assert.equal(result.trace.some(e=>e.type==='pointercancel'),false);assert.ok(result.trace.some(e=>e.type==='pointerup'&&e.trusted));console.log('PASS: native Android long-press and drag');
  const drag=async(selector,x,y)=>{
   const box=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   assert.ok(box,`draggable control exists: ${selector}`);
   const from=point(box.x,box.y),to=point(x,y);
   const commands=[`input touchscreen motionevent DOWN ${from.join(' ')}`,'sleep 0.65'];
   for(let i=1;i<=10;i++)commands.push(`input touchscreen motionevent MOVE ${Math.round(from[0]+(to[0]-from[0])*i/10)} ${Math.round(from[1]+(to[1]-from[1])*i/10)}`,'sleep 0.04');
   commands.push(`input touchscreen motionevent UP ${to.join(' ')}`);
   adb('shell',commands.join('; '));await pause(450);
  };
  const tapBox=await evaluate(`(()=>{const el=document.querySelector('.ft-floating'),r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,pressed:el.getAttribute('aria-pressed')};})()`);
  const tapPoint=point(tapBox.x,tapBox.y);adb('shell',`input touchscreen tap ${tapPoint.join(' ')}`);await pause(350);
  const pressed=await evaluate(`document.querySelector('.ft-floating')?.getAttribute('aria-pressed')`);
  console.log('Native short tap',JSON.stringify({before:tapBox.pressed,after:pressed}));
  assert.notEqual(pressed,tapBox.pressed,'native short touch must toggle');
  const tapAgain=point(...Object.values(await evaluate(`(()=>{const r=document.querySelector('.ft-floating').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];})()`)));
  adb('shell',`input touchscreen tap ${tapAgain.join(' ')}`);await pause(350);
  assert.equal(await evaluate(`document.querySelector('.ft-floating')?.getAttribute('aria-pressed')`),tapBox.pressed,'second native short touch toggles back');
  await drag('.ft-floating',300,430);
  const moved=await evaluate(`(()=>{const r=document.querySelector('.ft-floating').getBoundingClientRect();return {x:r.x,y:r.y,stored:localStorage.getItem('furigana_floating_translation_v1')};})()`);
  assert.ok(Math.abs(moved.x+22-300)<10&&Math.abs(moved.y+22-430)<10,'floating control follows a second native drag');
  console.log('PASS: native Android repositions and persists the floating control',JSON.stringify(moved));
  const recycle=await evaluate(`(()=>{const el=document.querySelector('.ft-recycle');return !!el;})()`);
  assert.equal(recycle,false,'recycle area is hidden between gestures');
  const held=await evaluate(`(()=>{const r=document.querySelector('.ft-floating').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];})()`);
  const heldPoint=point(...held);adb('shell',`input touchscreen motionevent DOWN ${heldPoint.join(' ')}; sleep 0.65`);await pause(100);
  const dockTarget=await evaluate(`(()=>{const r=document.querySelector('.reader-tools-right > button:last-child').getBoundingClientRect();return [r.x-20,r.y+r.height/2];})()`);
  const endPoint=point(...dockTarget);
  const docking=[];for(let i=1;i<=10;i++)docking.push(`input touchscreen motionevent MOVE ${Math.round(heldPoint[0]+(endPoint[0]-heldPoint[0])*i/10)} ${Math.round(heldPoint[1]+(endPoint[1]-heldPoint[1])*i/10)}`,'sleep 0.04');
  docking.push(`input touchscreen motionevent UP ${endPoint.join(' ')}`);adb('shell',docking.join('; '));await pause(450);
  assert.equal(await evaluate(`!!document.querySelector('.ft-floating')`),false,'drag to original slot removes floating control');
  assert.equal(await evaluate(`document.querySelector('.ft-button:not(.ft-floating)')?.getAttribute('aria-pressed')`),tapBox.pressed,'docking does not toggle translation');
  const stored=JSON.parse(await evaluate(`localStorage.getItem('furigana_floating_translation_v1')`));assert.equal(stored.floating,false);
  console.log('PASS: native Android drag-to-dock; all native touch checks passed');
 }
} finally {socket.close();}
