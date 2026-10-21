import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(process.env.DENTELLE_DATA_DIR || resolve(root, 'data'))
mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(resolve(dataDir, 'dentelle.sqlite'))
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS clinics(id TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL,clinic TEXT REFERENCES clinics(id),reset INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(clinic TEXT PRIMARY KEY REFERENCES clinics(id),body TEXT NOT NULL DEFAULT '[]',revision INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,clinic TEXT NOT NULL REFERENCES clinics(id),name TEXT NOT NULL,body BLOB NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT,event TEXT,clinic TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);`)
const uid=()=>randomBytes(16).toString('hex')
const hash=p=>{const salt=uid();return salt+':'+scryptSync(p,salt,64).toString('hex')}
const verify=(p,h)=>{const [salt,key]=h.split(':');return timingSafeEqual(scryptSync(p,salt,64),Buffer.from(key,'hex'))}
const digest=t=>createHash('sha256').update(t).digest('hex')
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})}
const email=v=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<200
const password=v=>typeof v==='string'&&v.length>=12&&v.length<=128
const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,clinic:u.clinic,reset:!!u.reset})
const audit=(actor,event,clinic=null)=>db.prepare('INSERT INTO audit(actor,event,clinic) VALUES(?,?,?)').run(actor,event,clinic)
const attempts=new Map()
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY')
 const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
 try {
 const path=new URL(req.url,'http://localhost').pathname
 if(!path.startsWith('/api/')) {const file=resolve(root,'dist','.'+decodeURIComponent(path));const base=resolve(root,'dist');const target=file.startsWith(base+'/')||file.startsWith(base+'\\')?file:resolve(base,'index.html');const chosen=existsSync(target)&&extname(target)?target:resolve(base,'index.html');if(!existsSync(chosen)){res.writeHead(404);return res.end('Run npm run build first, or open the Vite development server.')}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png'})[extname(chosen)]||'application/octet-stream');return res.end(readFileSync(chosen))}
 if(!['GET','POST','PUT'].includes(req.method))fail('Method not allowed',405)
 if(req.method!=='GET' && req.headers.origin) {
   let origin
   try { origin = new URL(req.headers.origin) } catch { fail('Invalid request origin',403) }
   const allowedOrigins = new Set(['http://localhost:5173','http://127.0.0.1:5173', ...(process.env.APP_ORIGINS || '').split(',').map(value=>value.trim()).filter(Boolean)])
   const sameOrigin = ['http:','https:'].includes(origin.protocol) && origin.host === req.headers.host
   if(!sameOrigin && !allowedOrigins.has(origin.origin)) fail('Invalid request origin',403)
 }
 let body={};if(req.method!=='GET'&&path!=='/api/files'){if(!req.headers['content-type']?.startsWith('application/json'))fail('JSON content required',415);let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24*1024*1024)fail('Request too large',413);chunks.push(chunk)}try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{fail('Invalid JSON')}}
 const setupNeeded=!db.prepare('SELECT id FROM users LIMIT 1').get()
 if(path==='/api/status'&&req.method==='GET')return send(200,{setupNeeded})
 if(path==='/api/setup'&&req.method==='POST'){if(!setupNeeded)fail('Owner is already configured',409);if(!email(body.email)||!password(body.password)||!body.name?.trim())fail('Enter a name, valid email, and password of 12–128 characters');const id=uid();db.prepare('INSERT INTO users(id,email,name,hash,role) VALUES(?,?,?,?,?)').run(id,body.email.toLowerCase().trim(),body.name.trim(),hash(body.password),'owner');audit(id,'owner.created');return send(201,{ok:true})}
 if(path==='/api/login'&&req.method==='POST'){const key=req.socket.remoteAddress;const attempt=attempts.get(key);if(attempt&&attempt.until>Date.now()&&attempt.count>=10)fail('Too many attempts. Try again in 15 minutes.',429);if(!attempt||attempt.until<Date.now())attempts.set(key,{count:0,until:Date.now()+900000});attempts.get(key).count++;if(typeof body.password!=='string'||body.password.length>128)fail('Invalid credentials',401);const u=db.prepare('SELECT * FROM users WHERE email=?').get(String(body.email).toLowerCase().trim());if(!u||!verify(body.password,u.hash))fail('Invalid email or password',401);if(u.clinic&&!db.prepare('SELECT active FROM clinics WHERE id=?').get(u.clinic)?.active)fail('Clinic access is suspended',403);attempts.delete(key);const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),u.id,Date.now()+8*3600000);res.setHeader('Set-Cookie',`dentelle=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);audit(u.id,'login',u.clinic);return send(200,{user:publicUser(u)})}
 const token=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('dentelle='))?.slice(9)
 const user=token?db.prepare('SELECT u.* FROM sessions s JOIN users u ON s.user=u.id WHERE s.token=? AND s.expires>?').get(digest(token),Date.now()):null
 if(!user)fail('Please sign in',401)
 if(user.clinic&&!db.prepare('SELECT active FROM clinics WHERE id=?').get(user.clinic)?.active)fail('Clinic access is suspended',403)
 if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie','dentelle=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true})}
 if(path==='/api/me'&&req.method==='GET'){const clinic=user.clinic?db.prepare('SELECT name FROM clinics WHERE id=?').get(user.clinic):null;return send(200,{user:publicUser(user),clinicName:clinic?.name})}
 if(path==='/api/password'&&req.method==='POST'){if(!password(body.password)||!verify(String(body.current||''),user.hash))fail('Enter the current password and a new password of 12–128 characters');db.prepare('UPDATE users SET hash=?,reset=0 WHERE id=?').run(hash(body.password),user.id);db.prepare('DELETE FROM sessions WHERE user=? AND token<>?').run(user.id,digest(token));audit(user.id,'password.changed',user.clinic);return send(200,{ok:true})}
 if(user.reset)fail('Change your temporary password first',403)

 if(path==='/api/files' && req.method==='POST') {
   if(!user.clinic)fail('Dentist access required',403)
   if(!req.headers['content-type']?.startsWith('application/dicom'))fail('DICOM content required',415)
   let size=0;const chunks=[]
   for await(const chunk of req){size+=chunk.length;if(size>128*1024*1024)fail('DICOM files must be 128 MB or smaller',413);chunks.push(chunk)}
   const bytes=Buffer.concat(chunks)
   if(bytes.length<132||bytes.toString('ascii',128,132)!=='DICM')fail('Choose a DICOM Part 10 file with a valid DICM header')
   const id=uid();let name;try{name=decodeURIComponent(req.headers['x-file-name']||'scan.dcm').slice(0,200)}catch{fail('Invalid file name')}
   db.prepare('INSERT INTO files(id,clinic,name,body) VALUES(?,?,?,?)').run(id,user.clinic,name,bytes)
   audit(user.id,'dicom.uploaded',user.clinic)
   return send(201,{id,name,size})
 }
 if(path.startsWith('/api/files/') && req.method==='GET') {
   if(!user.clinic)fail('Dentist access required',403)
   const file=db.prepare('SELECT * FROM files WHERE id=? AND clinic=?').get(path.slice('/api/files/'.length),user.clinic)
   if(!file)fail('File not found',404)
   res.writeHead(200,{'Content-Type':'application/dicom','Content-Length':file.body.length,'Cache-Control':'no-store','Content-Disposition':'inline'})
   return res.end(Buffer.from(file.body))
 }
 if(path==='/api/clinics'){if(user.role!=='owner')fail('Owner access required',403);if(req.method==='GET')return send(200,{clinics:db.prepare('SELECT c.*,u.email,u.name AS dentist FROM clinics c LEFT JOIN users u ON u.clinic=c.id ORDER BY c.name').all()});if(req.method==='POST'){if(!body.clinicName?.trim()||!body.name?.trim()||!email(body.email)||!password(body.password))fail('Complete all fields; password needs at least 12 characters');const clinic=uid();db.exec('BEGIN');try{db.prepare('INSERT INTO clinics(id,name) VALUES(?,?)').run(clinic,body.clinicName.trim());db.prepare('INSERT INTO users(id,email,name,hash,role,clinic,reset) VALUES(?,?,?,?,?,?,1)').run(uid(),body.email.toLowerCase().trim(),body.name.trim(),hash(body.password),'dentist',clinic);db.prepare('INSERT INTO records(clinic) VALUES(?)').run(clinic);audit(user.id,'clinic.created',clinic);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');if(String(e).includes('UNIQUE'))fail('This email already has an account');throw e}return send(201,{ok:true})}if(req.method==='PUT'){db.prepare('UPDATE clinics SET active=? WHERE id=?').run(body.active?1:0,body.id);audit(user.id,'clinic.access.changed',body.id);return send(200,{ok:true})}}
 if(path==='/api/records'){if(!user.clinic)fail('Sign in with a dentist account to access patient records',403);if(req.method==='GET'){const row=db.prepare('SELECT * FROM records WHERE clinic=?').get(user.clinic);return send(200,{patients:JSON.parse(row.body),revision:row.revision})}if(req.method==='PUT'){if(!Array.isArray(body.patients)||body.patients.length>10000)fail('Invalid patient list');const ids=new Set();for(const p of body.patients){if(!p.id||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||!Array.isArray(p.treatments)||!Array.isArray(p.images)||!p.findings||typeof p.findings!=='object')fail('Invalid patient record');ids.add(p.id);for(const img of p.images){if(img.fileId){if(!db.prepare('SELECT id FROM files WHERE id=? AND clinic=?').get(img.fileId,user.clinic))fail('Invalid file reference',403);continue}if(typeof img.url!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(img.url)||img.url.length>3000000)fail('Unsupported image')}}const result=db.prepare('UPDATE records SET body=?,revision=revision+1 WHERE clinic=? AND revision=?').run(JSON.stringify(body.patients),user.clinic,body.revision);if(!result.changes)fail('Records changed in another window. Reload to get the latest version before editing again.',409);audit(user.id,'records.saved',user.clinic);return send(200,{revision:body.revision+1})}}
 fail('Not found',404)
 }catch(e){if(!res.headersSent)send(e.status||500,{error:e.status?e.message:'Server error. Check the server console.'});if(!e.status)console.error(e)}
})
server.listen(Number(process.env.PORT||3001),process.env.HOST||'127.0.0.1',()=>console.log('Jhon Dental Clinic server: http://127.0.0.1:'+(process.env.PORT||3001)))


