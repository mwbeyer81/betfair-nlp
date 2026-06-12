const fs = require('fs');
const path = require('path');

const files = [
  'C:/Users/matth/betfair-nlp/client/src/components/AllRunnersScreen.tsx',
  'C:/Users/matth/betfair-nlp/client/src/utils/exportRunners.ts',
];

for (const f of files) {
  try {
    const content = fs.readFileSync(f, 'utf8');
    const before = fs.statSync(f).mtime;
    // Remove trailing space if present, or add one — ensures content changes
    const newContent = content.endsWith(' ') ? content.trimEnd() : content + ' ';
    fs.writeFileSync(f, newContent, 'utf8');
    const after = fs.statSync(f).mtime;
    console.log(f + '\n  before: ' + before + '\n  after:  ' + after);
  } catch (e) {
    console.error('Error touching ' + f + ': ' + e.message);
  }
}
