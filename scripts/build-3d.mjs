#!/usr/bin/env node
// Development only. Distributed reports and skills use the already bundled, offline viewer.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),modules=process.argv[2];
if(!modules)throw new Error('Usage: node build-3d.mjs <node_modules containing three and esbuild>');
const root=resolve(modules),require=createRequire(import.meta.url),esbuild=require(join(root,'esbuild'));
const pkg=JSON.parse(readFileSync(join(root,'three/package.json'),'utf8'));
await esbuild.build({entryPoints:[join(here,'../assets/scene3d-source.mjs')],bundle:true,minify:true,format:'iife',platform:'browser',target:'es2020',nodePaths:[root],legalComments:'eof',outfile:join(here,'../assets/vendor/scene3d.bundle.js')});
copyFileSync(join(root,'three/LICENSE'),join(here,'../assets/vendor/THREE-LICENSE.txt'));
writeFileSync(join(here,'../assets/vendor/versions.json'),JSON.stringify({three:pkg.version,license:'MIT',usage:'Bundled locally, no CDN or runtime package installation.'},null,2)+'\n');
console.log('Built standalone 3D renderer with Three.js',pkg.version);
