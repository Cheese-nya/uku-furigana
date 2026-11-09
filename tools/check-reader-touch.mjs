// Trusted Chromium touch input, not mouse dragging or synthetic PointerEvents.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const text = Array.from({length:40}, (_,i)=>`第${i}行。今日はいい天気です。日本語の文章を読みます。`).join('\n');
const book={bookId:'book:touch-qa',title:'触摸拖动测试',author:'QA',content:text,fingerprint:`sha256:${createHash('sha256').update(text).digest('hex')}`,category:'script',format:'txt',coverTheme:'indigo',sourceOverrides:[],chapters:[],readingProgress:{chapterIndex:0,lineIndex:0,percentage:0,updatedAt:Date.now()},bookmarks:[],favorite:false,createdAt:Date.now(),updatedAt:Date.now(),lastReadAt:0};
await page.addInitScript(book=>{
 localStorage.setItem('furigana-library-v1',JSON.stringify({version:2,books:{[book.bookId]:book},folders:{}}));
 localStorage.removeItem('furigana_floating_translation_v1');
 localStorage.setItem('furigana_active_tab','library');
 window.touchTrace=[];
 for (const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','contextmenu','click']) document.addEventListener(type,event=>{
  if(event.target.closest?.('.ft-button')) window.touchTrace.push({type,trusted:event.isTrusted,pointerType:event.pointerType,button:event.button,detail:event.detail,action:getComputedStyle(event.target.closest('.ft-button')).touchAction});
 });
},book);
await page.route('https://**/*',route=>route.abort());
const cdp=await context.newCDPSession(page);
const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1,radiusX:5,radiusY:5,force:1}]});
try {
 await page.goto((process.env.FURIGANA_TEST_URL||'http://127.0.0.1:8765/')+'#library');
 await page.getByRole('button',{name:book.title,exact:true}).tap();
 const source=page.locator('.ft-button:not(.ft-floating)'); await source.waitFor();
 await page.waitForTimeout(650);
 const box=await source.boundingBox();
 console.log('computed touch-action:',await source.evaluate(el=>getComputedStyle(el).touchAction));
 await touch('touchStart',box.x+box.width/2,box.y+box.height/2);
 await page.waitForTimeout(550);
 console.log('ready preview count:',await page.locator('.ft-floating').count());
 for(let i=1;i<=12;i++) { await touch('touchMove',box.x+box.width/2+(190-box.x-box.width/2)*i/12,box.y+box.height/2+(350-box.y-box.height/2)*i/12); await page.waitForTimeout(24); }
 await touch('touchEnd'); await page.waitForTimeout(100);
 const trace=await page.evaluate(()=>window.touchTrace);
 console.log(JSON.stringify(trace));
 const floating=page.locator('.ft-floating');
 assert.equal(await floating.count(),1,'held touch must detach the translation control');
 assert.equal(await floating.getAttribute('aria-pressed'),'false','drag release must not toggle translation');
 assert.equal(trace.some(e=>e.type==='pointercancel'),false,'browser must not cancel the touch drag');
 const b=await floating.boundingBox(); assert.ok(b.y<500,'button follows touch away from toolbar');
 // Reposition the detached control with the same trusted touch path.
 const moveGesture=async(box,x,y)=>{
  const sx=box.x+box.width/2,sy=box.y+box.height/2;
  await touch('touchStart',sx,sy);await page.waitForTimeout(550);
  for(let i=1;i<=10;i++){await touch('touchMove',sx+(x-sx)*i/10,sy+(y-sy)*i/10);await page.waitForTimeout(24);}
  await touch('touchEnd');await page.waitForTimeout(80);
 };
 await moveGesture(b,300,430);
 const moved=await floating.boundingBox();assert.ok(moved.x>b.x+60&&moved.y>b.y+30);
 await page.waitForTimeout(400);
 const cx=moved.x+moved.width/2,cy=moved.y+moved.height/2;
 await touch('touchStart',cx,cy);await page.waitForTimeout(80);await touch('touchEnd');await page.waitForTimeout(350);
 assert.equal(await floating.getAttribute('aria-pressed'),'true','a short touch toggles after dragging');
 await touch('touchStart',cx,cy);await page.waitForTimeout(80);await touch('touchEnd');await page.waitForTimeout(350);
 assert.equal(await floating.getAttribute('aria-pressed'),'false');
 await touch('touchStart',cx,cy);await page.waitForTimeout(550);
 const aa=await page.locator('.reader-tools-right > button:last-child').boundingBox();
 const rx=aa.x-20,ry=aa.y+aa.height/2;
 for(let i=1;i<=10;i++){await touch('touchMove',cx+(rx-cx)*i/10,cy+(ry-cy)*i/10);await page.waitForTimeout(24);}
 await touch('touchEnd');await page.waitForTimeout(450);
 assert.equal(await floating.count(),0,'touch drag back to original slot docks the control');
 assert.equal(await source.getAttribute('aria-pressed'),'false','touch docking does not toggle');
 assert.equal(await source.evaluate(el=>getComputedStyle(el).touchAction),'none');
 console.log('PASS: trusted touch detach, reposition, short-tap toggle, and drag-to-dock');
} catch(error) {console.log('Failure trace', JSON.stringify(await page.evaluate(()=>window.touchTrace)));throw error;} finally {await browser.close();}
