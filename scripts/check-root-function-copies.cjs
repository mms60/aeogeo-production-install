'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), functions = path.join(root, 'netlify/functions');

function functionNames(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return functionNames(full);
    return entry.name.endsWith('.js') ? [entry.name] : [];
  });
}

const deployed = new Set(functionNames(functions));
const copies = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
  .map(entry => entry.name)
  .filter(name => deployed.has(name))
  .sort();

if (copies.length) {
  console.error('Root-level JavaScript duplicates a deployed Netlify function. Edit netlify/functions only and delete the root copy:');
  for (const name of copies) console.error('  ' + name);
  process.exit(1);
}

console.log(`No root-level .js duplicates ${deployed.size} deployed Netlify function files.`);
