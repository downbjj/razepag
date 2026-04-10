'use strict';
var path = require('path');
var fs   = require('fs');
var root = path.join(__dirname, '..');

require('reflect-metadata');

// Run prisma db push before starting the app
try {
  var execSync = require('child_process').execSync;
  console.log('[app] Running prisma db push...');
  execSync('npx prisma db push --accept-data-loss --skip-generate', {
    cwd: root,
    stdio: 'inherit',
    timeout: 60000,
  });
  console.log('[app] prisma db push done.');
} catch (e) {
  console.error('[app] prisma db push failed:', e.message);
  // Continue anyway — tables may already exist
}

var mainJs = path.join(__dirname, 'main.js');

if (fs.existsSync(mainJs)) {
  require(mainJs);
} else {
  require('ts-node').register({
    project:       path.join(root, 'tsconfig.json'),
    transpileOnly: true,
    files:         true,
  });
  require(path.join(root, 'src', 'main'));
}
