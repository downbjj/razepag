'use strict';
var path     = require('path');
var fs       = require('fs');
var net      = require('net');
var execSync = require('child_process').execSync;
var root     = path.join(__dirname, '..');

// Log DATABASE_URL (hide password) to confirm env vars are loaded
var dbUrl  = process.env.DATABASE_URL || 'NOT SET';
var dbSafe = dbUrl.replace(/:([^@]+)@/, ':***@');
console.log('[app] NODE_ENV =', process.env.NODE_ENV);
console.log('[app] PORT     =', process.env.PORT);
console.log('[app] DATABASE =', dbSafe);
console.log('[app] DB_START =', dbUrl.substring(0, 8)); // should print "mysql://"

// Parse and validate the DATABASE_URL
try {
  var parsed   = new (require('url').URL)(dbUrl);
  console.log('[app] DB_HOST  =', parsed.hostname);
  console.log('[app] DB_PORT  =', parsed.port || '3306');
  console.log('[app] DB_USER  =', parsed.username);
  console.log('[app] DB_PASS_LEN =', parsed.password ? parsed.password.length : 0);
  console.log('[app] DB_NAME  =', parsed.pathname.slice(1));
  console.log('[app] DB_PASS_DECODED =', decodeURIComponent(parsed.password).length, 'chars');
} catch (parseErr) {
  console.error('[app] Failed to parse DATABASE_URL:', parseErr.message);
}

if (!process.env.DATABASE_URL) {
  console.error('[app] FATAL: DATABASE_URL is not set.');
  process.exit(1);
}

// Quick TCP reachability test before launching Prisma
function testTcp(host, port) {
  return new Promise(function(resolve) {
    var sock = new net.Socket();
    var done = false;
    sock.setTimeout(5000);
    sock.connect(port, host, function() {
      if (!done) { done = true; console.log('[app] TCP OK  -> ' + host + ':' + port); sock.destroy(); resolve(true); }
    });
    sock.on('error', function(e) {
      if (!done) { done = true; console.error('[app] TCP ERR -> ' + host + ':' + port + ' —', e.message); sock.destroy(); resolve(false); }
    });
    sock.on('timeout', function() {
      if (!done) { done = true; console.error('[app] TCP TIMEOUT -> ' + host + ':' + port); sock.destroy(); resolve(false); }
    });
  });
}

function startApp() {
  require(path.join(root, 'node_modules', 'reflect-metadata'));

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
}

// Run TCP test then start
var dbHost = 'localhost';
var dbPort = 3306;
try {
  var u = new (require('url').URL)(dbUrl);
  dbHost = u.hostname || 'localhost';
  dbPort = parseInt(u.port) || 3306;
} catch(e) {}

testTcp(dbHost, dbPort).then(function() {
  startApp();
});
