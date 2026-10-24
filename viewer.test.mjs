import {chromium} from '@playwright/test'
import {spawn,spawnSync} from 'node:child_process'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import assert from 'node:assert/strict'
import {syntheticDicom} from './dicom-fixture.mjs'
const dir=mkdtempSync(join(tmpdir(),'jhon-viewer-'));const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3098',APP_ORIGINS:'http://127.0.0.1:5188',DENTELLE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let browser,devServer
try{
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('exit',()=>reject(new Error('Server failed')));setTimeout(()=>reject(new Error('Timeout')),10000).unref()})
 if(process.env.TEST_DEV==='1'){devServer=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5188'],{env:{...process.env,DENTELLE_API_URL:'http://127.0.0.1:3098'},stdio:['ignore','pipe','pipe']});devServer.stderr.on('data',d=>console.log(String(d)));await new Promise(resolve=>devServer.stdout.on('data',d=>{if(String(d).includes('http://'))resolve()}))}
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--enable-webgl','--use-angle=swiftshader']})
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const api=context.request;const base='http://127.0.0.1:3098'
 const post=async(path,data)=>{const r=await api.post(base+'/api/'+path,{data});assert.ok(r.ok(),await r.text());return r.json()}
 const loginPage=await context.newPage();await loginPage.goto(process.env.TEST_DEV==='1'?'http://127.0.0.1:5188':base)
 await loginPage.getByRole('heading',{name:'Welcome back.'}).waitFor()
 assert.equal(await loginPage.getByRole('button',{name:'Sign in →',exact:true}).count(),1)
 assert.equal(await loginPage.getByLabel('Your name',{exact:true}).count(),0)
 assert.equal(await loginPage.getByText('Create your owner account',{exact:true}).count(),0)
 await loginPage.close()
 const provision=spawnSync(process.execPath,['server.mjs','--create-owner','--stdin-json'],{env:{...process.env,DENTELLE_DATA_DIR:dir},input:JSON.stringify({name:'Owner',email:'owner@example.com',password:'Owner-Password-123'}),encoding:'utf8'});assert.equal(provision.status,0,provision.stderr);await post('login',{email:'owner@example.com',password:'Owner-Password-123'});await post('clinics',{clinicName:'Jhon Dental Clinic',name:'Test Dentist',email:'dentist@example.com',password:'Temporary-Password-123'});await post('logout',{});await post('login',{email:'dentist@example.com',password:'Temporary-Password-123'});await post('password',{current:'Temporary-Password-123',password:'Permanent-Password-123'})
 const upload=await api.post(base+'/api/files',{headers:{'Content-Type':'application/dicom','X-File-Name':'test.dcm'},data:syntheticDicom()});assert.equal(upload.status(),201);const file=await upload.json()
 const saved=await api.put(base+'/api/records',{data:{revision:0,patients:[{id:'p1',name:'Test Patient',phone:'',treatments:[],findings:{},images:[{id:'i1',fileId:file.id,name:'test.dcm',date:'2026-10-21',type:'DICOM study',dicom:{seriesUid:'1.2.826.0.1.100.2',frames:2,rows:32,columns:32,modality:'CT'}}]},{id:'p2',name:'Another Patient',phone:'09990000000',treatments:[],findings:{},images:[]}]}});assert.equal(saved.status(),200)
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR:',e.message)});page.on('console',m=>{if(m.type()==='error')console.log('BROWSER:',m.text())});await page.goto(process.env.TEST_DEV==='1'?'http://127.0.0.1:5188':base);await page.getByRole('heading',{name:'Patients',exact:true}).first().waitFor();
 assert.equal(await page.locator('.patient-directory').count(),1);
 await page.getByRole('button',{name:/Test Patient/}).click();
 assert.equal(await page.locator('.patient-directory').count(),0);
 assert.equal(await page.getByText('Another Patient',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Imaging',exact:true}).click();
 await page.getByLabel('Imaging category').selectOption('CBCT (DICOM)');
 assert.equal(await page.getByLabel('Import CBCT DICOM files').getAttribute('accept'),'.dcm,.dicom,application/dicom');
 await page.getByLabel('Import CBCT DICOM files').setInputFiles({name:'wrong.png',mimeType:'image/png',buffer:Buffer.from('not a dicom')});
 await page.getByRole('status').filter({hasText:'CBCT requires original DICOM files'}).waitFor();
 await page.getByRole('button',{name:'Viewer',exact:true}).click();try { await page.getByRole('button',{name:'Zoom +',exact:true}).waitFor({timeout:15000}) } catch(e) { console.log((await page.locator('body').innerText()).slice(-2500)); throw e }await page.waitForFunction(()=>!document.querySelector('.viewer-toolbar button')?.disabled,{timeout:30000});await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('2 / 2',{exact:true}).waitFor();await page.getByRole('button',{name:'Invert',exact:true}).click();await page.getByRole('button',{name:'Zoom +',exact:true}).click();await page.getByRole('button',{name:'Rotate 90°',exact:true}).click();await page.getByRole('button',{name:'Reset view',exact:true}).click();await page.getByLabel('Text size',{exact:true}).selectOption('20');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'20px');await page.reload();await page.getByRole('button',{name:/Test Patient/}).click();assert.equal(await page.getByLabel('Text size',{exact:true}).inputValue(),'20')
 await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Edit details'}).click();await page.getByRole('textbox',{name:'Phone number'}).fill('09123456789');await page.getByRole('button',{name:'Save patient',exact:true}).click();await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Patient records saved to the clinic database.'}).waitFor();await page.reload();await page.getByRole('button',{name:/Test Patient/}).click();await page.getByRole('heading',{name:'Test Patient',exact:true}).waitFor();assert.ok((await page.locator('body').innerText()).includes('09123456789'));await page.getByRole('button',{name:'Dental chart',exact:true}).click();
 await page.getByRole('button',{name:/^Tooth 16:/}).click();
 await page.getByRole('checkbox',{name:'Dental caries / cavity',exact:true}).check();
 await page.getByRole('checkbox',{name:'Tooth sensitivity',exact:true}).check();
 await page.getByRole('searchbox',{name:'Search common tooth findings'}).fill('fracture');
 await page.getByRole('textbox',{name:'Additional finding / treatment note'}).fill('Review symptoms at next visit.');
 await page.getByRole('button',{name:'Save finding',exact:true}).click();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Patient records saved to the clinic database.'}).waitFor();
 await page.reload();await page.getByRole('button',{name:/Test Patient/}).click();await page.getByRole('button',{name:'Dental chart',exact:true}).click();
 await page.getByRole('button',{name:/^Tooth 16:/}).click();
 assert.equal(await page.getByRole('checkbox',{name:'Dental caries / cavity',exact:true}).isChecked(),true);
 assert.equal(await page.getByRole('checkbox',{name:'Tooth sensitivity',exact:true}).isChecked(),true);
 assert.equal(await page.getByRole('textbox',{name:'Additional finding / treatment note'}).inputValue(),'Review symptoms at next visit.');
 assert.ok(await page.locator('.finding-options').evaluate(element=>element.scrollHeight>element.clientHeight));
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Overview',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page must fit viewport');mkdirSync('qa',{recursive:true});await page.screenshot({path:'qa/mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Viewer',exact:true}).click();await page.getByRole('button',{name:'Zoom +',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.viewer-toolbar button')?.disabled===false);await page.screenshot({path:'qa/viewer.png',fullPage:true});await page.getByRole('button',{name:'Back to patients',exact:false}).click();
 await page.getByRole('button',{name:'+ Add patient',exact:true}).click();
 await page.getByRole('textbox',{name:'Full name',exact:true}).fill('Kris Demo');
 await page.getByRole('button',{name:'Save patient',exact:true}).click();
 await page.getByRole('heading',{name:'Kris Demo',exact:true}).waitFor();
 assert.equal(await page.locator('.patient-directory').count(),0);
 assert.equal(await page.getByText('Another Patient',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Imaging',exact:true}).click();
 await page.getByLabel('Imaging category').selectOption('CBCT (DICOM)');
 page.on('dialog',()=>{throw new Error('Folder import must not use browser confirmation popups')});
 await page.getByLabel('Import CBCT DICOM files').setInputFiles({name:'cbct.dcm',mimeType:'application/dicom',buffer:syntheticDicom()});
 await page.getByRole('heading',{name:'Review scan import'}).waitFor();
 await page.getByRole('button',{name:'Import and open Viewer',exact:true}).click();
 await page.getByRole('status').filter({hasText:'1 file(s) attached to Kris Demo'}).waitFor();
 await page.getByRole('button',{name:'Zoom +',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.viewer-toolbar button')?.disabled===false);
 await page.getByRole('button',{name:'Imaging',exact:true}).click();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Patient records saved to the clinic database.'}).waitFor();
 const persisted=await (await api.get(base+'/api/records')).json();
 assert.equal(persisted.patients.find(p=>p.name==='Kris Demo').images[0].type,'CBCT (DICOM)');

 const folder=join(dir,'CBCT folder');mkdirSync(join(folder,'slices'),{recursive:true});
 writeFileSync(join(folder,'readme.txt'),'Scanner instructions');
 writeFileSync(join(folder,'DICOMDIR'),'Directory index');
 writeFileSync(join(folder,'existing.dcm'),syntheticDicom());
 const newSeries='1.2.826.0.1.100.99';
 const scanA=syntheticDicom({sopUid:'1.2.826.0.1.900.1',seriesUid:newSeries,instance:'1',charset:'ISO_IR 192',patientName:'José^Niño'});
 const scanB=syntheticDicom({sopUid:'1.2.826.0.1.900.2',seriesUid:newSeries,instance:'2',charset:'ISO_IR 192',patientName:'José^Niño'});
 writeFileSync(join(folder,'slices','001.dcm'),scanA);writeFileSync(join(folder,'slices','002'),scanB);writeFileSync(join(folder,'duplicate.dcm'),scanA);
 await page.getByLabel('Import CBCT folder',{exact:true}).setInputFiles(folder);
 await page.getByRole('heading',{name:'Review scan import'}).waitFor();
 assert.equal(await page.getByText('José Niño',{exact:true}).count(),1);
 await page.getByRole('button',{name:'Cancel import',exact:true}).click();
 assert.equal((await (await api.get(base+'/api/records')).json()).patients.find(p=>p.name==='Kris Demo').images.length,1);
 await page.getByLabel('Import CBCT folder',{exact:true}).setInputFiles(folder);
 await page.getByRole('heading',{name:'Review scan import'}).waitFor();
 await page.getByRole('button',{name:'Import and open Viewer',exact:true}).click();
 await page.getByRole('status').filter({hasText:'2 file(s) attached to Kris Demo'}).waitFor();
 await page.getByRole('button',{name:'Zoom +',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.viewer-toolbar button')?.disabled===false);
 assert.equal(await page.getByLabel('Study series',{exact:true}).inputValue(),newSeries);
 await page.getByText('1 / 4',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('2 / 4',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Patient records saved to the clinic database.'}).waitFor();
 const folderRecords=await (await api.get(base+'/api/records')).json();assert.equal(folderRecords.patients.find(p=>p.name==='Kris Demo').images.length,3);
 await page.getByRole('button',{name:'Imaging',exact:true}).click();
 assert.equal(await page.locator('.image-card').count(),2,'DICOM files must be grouped into series cards');
 const mixed=join(dir,'Mixed patients');mkdirSync(mixed);
 writeFileSync(join(mixed,'patient-a.dcm'),syntheticDicom({sopUid:'1.2.800.1',patientId:'A',patientName:'Patient^Alpha'}));
 writeFileSync(join(mixed,'patient-b.dcm'),syntheticDicom({sopUid:'1.2.800.2',patientId:'B',patientName:'Patient^Beta'}));
 await page.getByLabel('Import CBCT folder',{exact:true}).setInputFiles(mixed);
 await page.getByRole('heading',{name:'Review scan import'}).waitFor();
 assert.equal(await page.getByRole('radio').count(),2);
 assert.equal(await page.getByRole('button',{name:'Import and open Viewer',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Cancel import',exact:true}).click();
 await page.screenshot({path:'qa/patient-focused.png',fullPage:true});
 await page.getByRole('button',{name:'Toggle dark mode'}).click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.equal(await page.getByRole('button',{name:'Toggle dark mode'}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('.card').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(24, 36, 26)');
 await page.screenshot({path:'qa/dark-theme.png',fullPage:true});
 await page.getByRole('button',{name:'Dental chart',exact:true}).click();
 await page.getByRole('button',{name:/^Tooth 16:/}).click();
 assert.equal(await page.locator('.modal').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(24, 36, 26)');
 await page.screenshot({path:'qa/dark-finding.png',fullPage:true});
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Theme controls must fit mobile viewport');
 await page.screenshot({path:'qa/dark-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Toggle dark mode'}).click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'qa/light-green-theme.png',fullPage:true});
 await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 assert.deepEqual(errors,[]);console.log('PASS: browser renders multi-frame DICOM, changes slices, zooms, rotates, inverts; font size persists; mobile fits screen.')
}finally{devServer?.kill();await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(dir,{recursive:true,force:true})}


