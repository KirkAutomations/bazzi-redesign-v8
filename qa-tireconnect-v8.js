const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const mime={'.html':'text/html; charset=utf-8','.webp':'image/webp','.js':'text/javascript'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const file=path.resolve(root,'.'+p);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('not found')}res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res)});
(async()=>{
  const report={desktop:{},mobile:{},failures:[]};
  await new Promise(r=>server.listen(8912,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  for(const mode of [{name:'desktop',viewport:{width:1440,height:1000}},{name:'mobile',viewport:{width:390,height:844}}]){
    const context=await browser.newContext({viewport:mode.viewport});
    const page=await context.newPage();
    const errors=[];
    page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push(m.text())});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8912/index.html',{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForFunction(()=>document.querySelector('#tireconnect_v8')?.dataset.status==='initialized',{timeout:15000});
    await page.waitForSelector('#tireconnect_v8 select',{timeout:15000});
    await page.locator('#live-fitment').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    const initial=await page.evaluate(()=>({
      status:document.querySelector('#tireconnect_v8')?.dataset.status,
      sectionIndex:[...document.querySelectorAll('main > *')].findIndex(x=>x.id==='live-fitment'),
      selectCount:document.querySelectorAll('#tireconnect_v8 select').length,
      controls:[...document.querySelectorAll('#tireconnect_v8 select')].map((s,i)=>({i,name:s.name,id:s.id,disabled:s.disabled,options:[...s.options].slice(0,5).map(o=>({text:o.textContent.trim(),value:o.value}))})),
      hostBox:(()=>{const r=document.querySelector('#tireconnect_v8').getBoundingClientRect();return {width:r.width,height:r.height}})(),
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      font:getComputedStyle(document.querySelector('#tireconnect_v8 select')).fontFamily
    }));
    const selections=[];
    for(let step=0;step<8;step++){
      const candidates=page.locator('#tireconnect_v8 select:not(:disabled)');
      const count=await candidates.count();
      let changed=false;
      for(let i=0;i<count;i++){
        const sel=candidates.nth(i);
        const value=await sel.inputValue();
        const options=await sel.locator('option').evaluateAll(os=>os.map(o=>({value:o.value,text:o.textContent.trim(),disabled:o.disabled})).filter(o=>o.value&&!o.disabled));
        if(!value&&options.length){
          await sel.selectOption(options[0].value);
          selections.push({step,index:i,text:options[0].text,value:options[0].value});
          await page.waitForTimeout(900);
          changed=true;
          break;
        }
      }
      if(!changed)break;
    }
    const final=await page.evaluate(()=>({
      hash:location.hash,
      selectCount:document.querySelectorAll('#tireconnect_v8 select').length,
      populated:[...document.querySelectorAll('#tireconnect_v8 select')].map(s=>({name:s.name,id:s.id,value:s.value,disabled:s.disabled,optionCount:s.options.length})),
      locationText:[...document.querySelectorAll('#tireconnect_v8 *')].map(x=>x.textContent?.trim()).filter(Boolean).find(t=>/location|Schaefer|Detroit|Redford/i.test(t)&&t.length<240)||'',
      buttonTexts:[...document.querySelectorAll('#tireconnect_v8 button')].map(b=>b.textContent.trim()).filter(Boolean),
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    }));
    report[mode.name]={initial,selections,final,errors};
    if(initial.status!=='initialized'||initial.selectCount<3||initial.hostBox.width<300||initial.hostBox.height<300||initial.overflow>2||final.overflow>2||errors.length)report.failures.push(`${mode.name}: ${JSON.stringify(report[mode.name])}`);
    if(selections.length<4)report.failures.push(`${mode.name}: fitment flow advanced only ${selections.length} selectors`);
    await page.locator('#live-fitment').screenshot({path:path.join(root,`qa-v8-tireconnect-${mode.name}.png`)});
    await page.screenshot({path:path.join(root,`qa-v8-home-${mode.name}.png`),fullPage:true});
    await context.close();
  }
  await browser.close();server.closeAllConnections?.();server.close();
  fs.writeFileSync(path.join(root,'qa-tireconnect-v8-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.failures.length)process.exit(1);
})().catch(e=>{console.error(e);server.close();process.exit(1)});
