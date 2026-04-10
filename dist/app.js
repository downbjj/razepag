'use strict';
var path     = require('path');
var fs       = require('fs');
var execSync = require('child_process').execSync;
var root     = path.join(__dirname, '..');

// Log DATABASE_URL (hide password) to confirm env vars are loaded
var dbUrl  = process.env.DATABASE_URL || 'NOT SET';
var dbSafe = dbUrl.replace(/:([^@]+)@/, ':***@');
console.log('[app] NODE_ENV =', process.env.NODE_ENV);
console.log('[app] PORT     =', process.env.PORT);
console.log('[app] DATABASE =', dbSafe);

if (!process.env.DATABASE_URL) {
  console.error('[app] FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

require('reflect-metadata');

// Run prisma db push to ensure all tables exist
try {
  console.log('[app] Running prisma db push...');
  execSync('node ./node_modules/prisma/build/index.js db push --accept-data-loss --skip-generate', {
    cwd:     root,
    stdio:   'inherit',
    timeout: 120000,
    env:     Object.assign({}, process.env),
  });
  console.log('[app] Tables ready.');
} catch (e) {
  console.error('[app] prisma db push failed:', e.message);
}

var mainJs = path.join(__dirname, 'main.js');
if (fs.existsSync(mainJs)) {
  console.log('[app] Loading dist/main.js');
  require(mainJs);
} else {
  console.log('[app] dist/main.js not found — using ts-node');
  require('ts-node').register({
    project:       path.join(root, 'tsconfig.json'),
    transpileOnly: true,
    files:         true,
  });
  require(path.join(root, 'src', 'main'));
}
