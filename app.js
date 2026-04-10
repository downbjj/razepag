'use strict';

const path = require('path');
const fs   = require('fs');

// Log to file so we can debug even when Hostinger console shows nothing
const logFile = path.join(__dirname, 'startup.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(logFile, line); } catch(_) {}
}

// Catch unhandled errors
process.on('uncaughtException',  (err) => { log('uncaughtException: ' + err.stack); process.exit(1); });
process.on('unhandledRejection', (err) => { log('unhandledRejection: ' + err); process.exit(1); });

log('app.js starting — PORT=' + process.env.PORT + ' NODE_ENV=' + process.env.NODE_ENV);

// reflect-metadata MUST be loaded before any NestJS decorator
require('reflect-metadata');
log('reflect-metadata loaded');

const distMain = path.join(__dirname, 'dist', 'main.js');

if (fs.existsSync(distMain)) {
  log('Starting from dist/main.js');
  require(distMain);
} else {
  log('dist/main.js not found — starting via ts-node');
  try {
    require('ts-node').register({
      project:       path.join(__dirname, 'tsconfig.json'),
      transpileOnly: true,
      files:         true,
    });
    log('ts-node registered, loading src/main');
    require('./src/main');
  } catch (err) {
    log('FATAL: ' + err.stack);
    process.exit(1);
  }
}
