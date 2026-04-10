// Entry point — Hostinger Node.js hosting
'use strict';

const path = require('path');
const fs   = require('fs');

// reflect-metadata MUST be loaded before any NestJS decorator
require('reflect-metadata');

const distMain = path.join(__dirname, 'dist', 'main.js');

if (fs.existsSync(distMain)) {
  console.log('[app] Starting from dist/main.js');
  require(distMain);
} else {
  console.log('[app] dist/main.js not found — starting via ts-node');
  try {
    require('ts-node').register({
      project:      path.join(__dirname, 'tsconfig.json'),
      transpileOnly: true,
      files:        true,
    });
    require('./src/main');
  } catch (err) {
    console.error('[app] ts-node failed:', err.message);
    process.exit(1);
  }
}
