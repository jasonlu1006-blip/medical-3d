// Bounded packaging: exactly two selected display stacks, at most 16 MiB total.
// Credentials arrive on stdin with terminal echo disabled, never argv or files.
import {readFile, writeFile, stat} from 'node:fs/promises';
import {randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, createHash} from 'node:crypto';
const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length !== 2) throw Error('Expected output and two input paths');
let input = '';
process.stdout.write('Enter encryption password (hidden):\n');
for await (const chunk of process.stdin) { input += chunk; if (input.includes('\n')) break; }
const password = input.trimEnd();
if (!password) throw Error('Empty password');
const datasets = []; let total = 0;
for (const path of inputs) {
  total += (await stat(path)).size;
  if (total > 16 * 1024**2) throw Error('Package budget exceeded');
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (data.format !== 'medical-3d-display-stack-v1') throw Error('Invalid package');
  datasets.push({id:`demo-${datasets.length}`, label:data.label, data});
}
const clear = Buffer.from(JSON.stringify({datasets}));
const salt=randomBytes(16), iv=randomBytes(12);
const key=pbkdf2Sync(`JASON\0${password}`,salt,600000,32,'sha256');
const cipher=createCipheriv('aes-256-gcm',key,iv);
const encrypted=Buffer.concat([cipher.update(clear),cipher.final()]);
const tag=cipher.getAuthTag();
const check=createDecipheriv('aes-256-gcm',key,iv);check.setAuthTag(tag);
if (!Buffer.concat([check.update(encrypted),check.final()]).equals(clear)) throw Error('Roundtrip failed');
const out=Buffer.concat([Buffer.from('M3DE01'),salt,iv,encrypted,tag]);
await writeFile(output,out,{flag:'wx'});
key.fill(0);clear.fill(0);input='';
console.log(JSON.stringify({bytes:out.length,sha256:createHash('sha256').update(out).digest('hex'),datasets:datasets.length,roundtrip:true}));
