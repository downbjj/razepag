// Entry point para Hostinger Node.js hosting
require('reflect-metadata');

const path = require('path');
const fs   = require('fs');

const distMain = path.join(__dirname, 'dist', 'main.js');

if (fs.existsSync(distMain)) {
  // Compilação funcionou — usa JS puro (mais rápido)
  require(distMain);
} else {
  // Fallback: TypeScript direto via ts-node
  console.log('[app] dist/main.js não encontrado — iniciando via ts-node');
  require('ts-node').register({
    project: path.join(__dirname, 'tsconfig.json'),
    transpileOnly: true,
    files: true,
  });
  require('./src/main');
}
