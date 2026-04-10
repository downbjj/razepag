// Entry point para Hostinger Node.js hosting
// Executa TypeScript diretamente via ts-node (sem necessidade de compilar)

// reflect-metadata deve ser carregado ANTES de qualquer decorator NestJS
require('reflect-metadata');

require('ts-node').register({
  project: require('path').join(__dirname, 'tsconfig.json'),
  transpileOnly: true,   // pula checagem de tipos — mais rápido e sem erros de build
  files: true,
});

require('./src/main');
