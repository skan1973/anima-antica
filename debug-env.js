const fs = require('fs');
const path = 'server/.env';
const buf = fs.readFileSync(path);
console.log('byteLength=', buf.length);
console.log('first4=', buf.slice(0,4).toJSON().data);
const text = buf.toString('utf8');
console.log('text length=', text.length);
const lines = text.split(/\r?\n/);
console.log('lines count=', lines.length);
for (let i = 0; i < lines.length; i++) {
  console.log('LINE', i, 'len', lines[i].length, JSON.stringify(lines[i]));
}
const line = lines.find(l => l.startsWith('MONGO_URI='));
if (!line) { console.log('No MONGO_URI line'); process.exit(1);} 
console.log('MONGO_URI line len', line.length);
const splitted = line.split('=', 2);
console.log('split len', splitted.length);
console.log('split[0]', JSON.stringify(splitted[0]));
console.log('split[1] len', splitted[1].length);
console.log('split[1] string=', JSON.stringify(splitted[1]));
for (let i = 0; i < splitted[1].length; i++) {
  if (i < 40 || (i >= splitted[1].indexOf('?') && i < splitted[1].indexOf('?') + 40)) {
    process.stdout.write(`${splitted[1][i]}(${splitted[1].charCodeAt(i)}) `);
  }
  if (i === 40 || i === splitted[1].indexOf('?') + 39) {
    process.stdout.write('\n');
  }
}
console.log('\n');
console.log('query=', splitted[1].slice(splitted[1].indexOf('?')));
