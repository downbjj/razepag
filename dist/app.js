'use strict';
// Este arquivo é commitado diretamente — não depende do tsc
// Hostinger roda: node dist/app.js

var path = require('path');
var fs   = require('fs');
var root = path.join(__dirname, '..');  // volta para a raiz do projeto

require('reflect-metadata');

var mainJs = path.join(__dirname, 'main.js');

if (fs.existsSync(mainJs)) {
  // tsc compilou com sucesso — usa JS puro
  require(mainJs);
} else {
  // tsc falhou ou não rodou — usa ts-node diretamente
  require('ts-node').register({
    project:       path.join(root, 'tsconfig.json'),
    transpileOnly: true,
    files:         true,
  });
  require(path.join(root, 'src', 'main'));
}
