import fs from 'fs';

const files = [
  'docs/css/cards.css',
  'docs/js/cards.js',
  'docs/js/charts.js',
  'docs/js/app.js',
  'docs/js/volume-studies.js',
  'docs/js/volume-profile.js'
];

const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;

console.log('=== SCANNING FOR EMOJIS AND DOUBLE DASHES ===');

let emojiIssues = 0;
let dashIssues = 0;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    // Check emoji
    if (emojiRegex.test(line)) {
      console.log(`[EMOJI] ${f}:${lineNum} -> ${line.trim()}`);
      emojiIssues++;
    }

    // Check double-dash '--' in comments, user-facing text, DOM
    // Filter out CSS variable declarations and usages: e.g. --var-name or var(--var-name)
    // Also ignore JS decrement operators like `i--`
    if (line.includes('--')) {
      // Let's inspect where '--' appears
      let cleaned = line;
      // remove var(--xxx)
      cleaned = cleaned.replace(/var\(--[a-zA-Z0-9_-]+\)/g, '');
      // remove CSS property definitions: --xxx:
      cleaned = cleaned.replace(/--[a-zA-Z0-9_-]+\s*:/g, '');
      // remove JS decrement operators: \w-- or --\w
      cleaned = cleaned.replace(/[a-zA-Z0-9_]\s*--/g, '');
      cleaned = cleaned.replace(/--\s*[a-zA-Z0-9_]/g, '');

      if (cleaned.includes('--')) {
        console.log(`[DOUBLE-DASH] ${f}:${lineNum} -> ${line.trim()}`);
        dashIssues++;
      }
    }
  });
}

console.log(`Total emoji issues: ${emojiIssues}`);
console.log(`Total double-dash issues: ${dashIssues}`);
