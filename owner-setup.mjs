import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { randomBytes, scryptSync } from 'node:crypto'

export async function setupOwner(db) {
 let data
 if (process.argv.includes('--stdin-json')) {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  data = JSON.parse(input)
 } else {
  if (!process.stdin.isTTY) throw new Error('Run npm run owner:create in an interactive terminal.')
  let hidden = false
  const output = new Writable({ write(chunk, encoding, callback) {
   if (!hidden) process.stdout.write(chunk, encoding)
   callback()
  } })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  try {
   const name = await rl.question('Owner name: ')
   const email = await rl.question('Owner email: ')
   process.stdout.write('Password (12–128 characters; hidden): ')
   hidden = true
   const password = await rl.question('')
   process.stdout.write('\nConfirm password: ')
   const confirmation = await rl.question('')
   process.stdout.write('\n')
   if (password !== confirmation) throw new Error('Passwords do not match.')
   data = { name, email, password }
  } finally { hidden = false; rl.close() }
 }
 const name = typeof data.name === 'string' ? data.name.trim() : ''
 const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
 if (!name || name.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length >= 200 ||
     typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128) {
  throw new Error('Enter a name, valid email, and password of 12–128 characters.')
 }
 db.exec('BEGIN IMMEDIATE')
 try {
  if (db.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").get()) throw new Error('An owner already exists. Sign in with that account.')
  const id = randomBytes(16).toString('hex')
  const salt = randomBytes(16).toString('hex')
  const hash = salt + ':' + scryptSync(data.password, salt, 64).toString('hex')
  db.prepare('INSERT INTO users(id,email,name,hash,role) VALUES(?,?,?,?,?)').run(id, email, name, hash, 'owner')
  db.prepare('INSERT INTO audit(actor,event) VALUES(?,?)').run(id, 'owner.created')
  db.exec('COMMIT')
 } catch (error) { db.exec('ROLLBACK'); throw error }
 console.log('Owner account created. Sign in, then use Clinic administration > Add a clinic to create dentist accounts.')
}
