import fs from 'fs';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(file);
    }
  });
  return results;
}

const files = walk('./src');
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf-8');
  content = content.replace(/text-gray-800/g, 'text-brand-navy');
  content = content.replace(/text-gray-900/g, 'text-brand-navy');
  content = content.replace(/text-\[#0E5C56\]/g, 'text-brand-teal');
  content = content.replace(/bg-\[#0E5C56\]/g, 'bg-brand-teal');
  content = content.replace(/border-\[#0E5C56\]/g, 'border-brand-teal');
  content = content.replace(/text-\[#E85D4C\]/g, 'text-brand-terracotta');
  content = content.replace(/bg-\[#E85D4C\]/g, 'bg-brand-terracotta');
  fs.writeFileSync(f, content);
});
console.log('done');
