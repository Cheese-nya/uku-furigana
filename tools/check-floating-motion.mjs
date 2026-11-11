// Trusted Chromium touch input, not mouse dragging or synthetic PointerEvents.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const text = Array.from({length:40}, (_,i)=>`第${i}行。今日はいい天気です。日本語の文章を読みます。`).join('\n');
const book={bookId:'book:touch-qa',title:'长标题测试：雨后街角与放课后的约定、远方的来信',author:'QA',content:text,fingerprint:`sha256:${createHash('sha256').update(text).digest('hex')}`,category:'script',format:'txt',coverTheme:'indigo',sourceOverrides:[],chapters:[],readingProgress:{chapterIndex:0,lineIndex:0,percentage:0,updatedAt:Date.now()},bookmarks:[],favorite:false,createdAt:Date.now(),updatedAt:Date.now(),lastReadAt:0};
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
 for (const scenario of ['light', 'dark', 'reduced-motion', 'reduced-transparency']) {
  await page.emulateMedia({colorScheme:scenario==='dark'?'dark':'light',reducedMotion:scenario==='reduced-motion'?'reduce':'no-preference'});
  await page.goto((process.env.FURIGANA_TEST_URL||'http://127.0.0.1:8765/')+`?motion=${scenario}#library`);
  await page.getByRole('button',{name:book.title,exact:true}).tap();
  const control=page.locator('.ft-button');await control.waitFor(); await page.waitForTimeout(700);
  if(scenario==='reduced-transparency') await page.addStyleTag({content:'.ft-face { background:var(--bg) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important; }'});
  const initial=await control.boundingBox();const hx=initial.x+22,hy=initial.y+22;
  const read=()=>page.evaluate(()=>{
   const cap=document.querySelector('.reader-capsule').getBoundingClientRect();
   const title=document.querySelector('.reader-capsule-title').getBoundingClientRect();
   const aa=document.querySelector('.reader-tools-right > button:last-child').getBoundingClientRect();
   return {width:document.querySelector('.ft-slot').getBoundingClientRect().width,titleCenter:title.x+title.width/2,capCenter:cap.x+cap.width/2,titleWidth:title.width,aa:aa.x};
  });
  const start=await read();
  await touch('touchStart',hx,hy);await page.waitForTimeout(500);
  await touch('touchMove',hx,hy-160);await page.waitForTimeout(80);
  const detached=await read();
  assert.equal(detached.aa,start.aa,'Aa remains pinned while detached');
  assert.ok(Math.abs(detached.titleCenter-detached.capCenter)<1);
  assert.ok(detached.titleWidth>start.titleWidth && detached.titleWidth<=start.titleWidth+37,'long title gains at most the freed slot width');
  const widths=[];
  for(const d of [50,38,24]) {await touch('touchMove',hx,hy-d);await page.waitForTimeout(50);widths.push((await read()).width);}
  assert.ok(widths[0]>0&&widths[0]<widths[1]&&widths[1]<widths[2]&&widths[2]<36,'continuous proximity drives width');
  await touch('touchMove',hx,hy-45);await page.waitForTimeout(60);
  assert.ok((await read()).width<widths[1],'retreat reverses width without waiting');
  await page.screenshot({path:`/tmp/ft-motion-${scenario}-approach.png`});
  await touch('touchMove',hx,hy-20);await touch('touchEnd');await page.waitForTimeout(460);
  assert.equal(await page.locator('.ft-floating').count(),0,'bottom drop docks');
  assert.equal(await control.getAttribute('aria-pressed'),'false');
  const end=await read();assert.equal(end.width,36);assert.equal(end.aa,start.aa);
  assert.ok(Math.abs(end.titleCenter-end.capCenter)<1,'title centered');
  assert.equal(await page.locator('.ft-recycle').count(),0);
  assert.ok(Math.abs(end.titleWidth-start.titleWidth)<1,'long title returns to original width');
  await page.screenshot({path:`/tmp/ft-motion-${scenario}.png`});
  // Settings must close before the shared float/dock motion starts.
  await page.locator('.reader-tools-right > button:last-child').tap();
  await page.getByRole('button',{name:'悬浮翻译按钮',exact:true}).tap();await page.waitForTimeout(500);
  assert.equal(await page.locator('.ft-floating').count(),1,'settings float');
  await page.locator('.reader-tools-right > button:last-child').tap();
  await page.getByRole('button',{name:'收回翻译按钮到工具栏',exact:true}).tap();await page.waitForTimeout(500);
  assert.equal(await page.locator('.ft-floating').count(),0,'settings return');
  console.log('PASS',scenario,'distance reflow, reverse, bottom return, centered title, fixed Aa, settings');
 }
} finally {await browser.close();}
