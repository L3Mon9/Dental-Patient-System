import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {syntheticDicom} from './dicom-fixture.mjs'
const dir=mkdtempSync(join(tmpdir(),'dentelle-test-'))
const proc=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3099',DENTELLE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']})
let output='';proc.stderr.on('data',d=>output+=d)
const base='http://127.0.0.1:3099/api/'
async function request(path,body,cookie='',method='POST'){const res=await fetch(base+path,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]}}
try{
 await new Promise((resolve,reject)=>{proc.stdout.once('data',resolve);proc.once('exit',()=>reject(new Error(output)));setTimeout(()=>reject(new Error('Server timeout')),10000).unref()})
 assert.equal((await request('records')).status,401)
 const devResponse=await fetch(base+'setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173'},body:'{}'})
 assert.equal(devResponse.status,403,'Public registration must be disabled on an empty database')
 const rejected=await fetch(base+'setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'})
 assert.equal(rejected.status,403,'Untrusted origins must remain blocked')
 const malformed=await fetch(base+'setup',{method:'POST',headers:{'Content-Type':'application/json',Origin:'null'},body:'{}'})
 assert.equal(malformed.status,403,'Invalid origins must be rejected cleanly')
 assert.equal((await request('setup',{name:'Owner',email:'owner@example.com',password:'Owner-Password-123'})).status,403)
 const provision = () => spawnSync(process.execPath,['server.mjs','--create-owner','--stdin-json'],{env:{...process.env,DENTELLE_DATA_DIR:dir},input:JSON.stringify({name:'Owner',email:'owner@example.com',password:'Owner-Password-123'}),encoding:'utf8'})
 const created=provision();assert.equal(created.status,0,created.stderr)
 assert.equal(provision().status,1,'Existing owner must not be overwritten')
 assert.equal((await request('setup',{})).status,403)
 assert.equal((await request('clinics',{clinicName:'Unauthorized'})).status,401)
 const owner=await request('login',{email:'owner@example.com',password:'Owner-Password-123'});assert.equal(owner.status,200)
 for(const n of [1,2])assert.equal((await request('clinics',{clinicName:`Clinic ${n}`,name:`Dentist ${n}`,email:`dentist${n}@example.com`,password:'Temporary-Password-123'},owner.cookie)).status,201)
 const d1=await request('login',{email:'dentist1@example.com',password:'Temporary-Password-123'})
 assert.equal((await request('records',undefined,d1.cookie)).status,403)
 assert.equal((await request('password',{current:'Temporary-Password-123',password:'Permanent-Password-123'},d1.cookie)).status,200)
 const upload=await fetch(base+'files',{method:'POST',headers:{Cookie:d1.cookie,'Content-Type':'application/dicom','X-File-Name':'test.dcm'},body:syntheticDicom()});assert.equal(upload.status,201);const attachment=await upload.json()
 assert.equal((await fetch(base+'files/'+attachment.id,{headers:{Cookie:d1.cookie}})).status,200)
 const badUpload=await fetch(base+'files',{method:'POST',headers:{Cookie:d1.cookie,'Content-Type':'application/dicom'},body:Buffer.alloc(140)});assert.equal(badUpload.status,400)
 const patients=[{id:'p1',name:'Test Patient',treatments:[{name:'Restoration',next:'2026-11-04'}],images:[{id:'i1',url:'data:image/png;base64,aGVsbG8='}],findings:{16:'Test finding'}}]
 assert.equal((await request('records',{patients,revision:0},d1.cookie,'PUT')).status,200)
 assert.equal((await request('records',undefined,d1.cookie)).data.patients[0].name,'Test Patient')
 assert.equal((await request('records',{patients,revision:0},d1.cookie,'PUT')).status,409)
 assert.equal((await request('clinics',undefined,d1.cookie)).status,403)
 const d2=await request('login',{email:'dentist2@example.com',password:'Temporary-Password-123'})
 await request('password',{current:'Temporary-Password-123',password:'Permanent-Password-123'},d2.cookie)
 assert.deepEqual((await request('records',undefined,d2.cookie)).data.patients,[])
 assert.equal((await fetch(base+'files/'+attachment.id,{headers:{Cookie:d2.cookie}})).status,404)
 assert.equal((await request('records',{patients:[{...patients[0],images:[{fileId:attachment.id}]}],revision:0},d2.cookie,'PUT')).status,403)
 assert.equal((await fetch(base+'files/'+attachment.id)).status,401)
 const clinics=(await request('clinics',undefined,owner.cookie)).data.clinics
 await request('clinics',{id:clinics.find(c=>c.email==='dentist1@example.com').id,active:false},owner.cookie,'PUT')
 assert.equal((await request('records',undefined,d1.cookie)).status,403)
 assert.equal((await request('records',undefined,owner.cookie)).status,403)
 await request('logout',{},d2.cookie)
 assert.equal((await request('records',undefined,d2.cookie)).status,401)
 console.log('PASS: owner provisioning, password changes, patient/image persistence, clinic isolation, stale-save conflict, suspension, logout.')
}finally{proc.kill();await new Promise(resolve=>proc.once('exit',resolve));rmSync(dir,{recursive:true,force:true})}

