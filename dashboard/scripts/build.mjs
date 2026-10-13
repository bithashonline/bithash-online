import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {extname} from 'node:path';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
const assets={};
for(const name of readdirSync('public')){
 if(!types[extname(name)])throw Error('Unexpected public asset');
 assets['/'+name]={type:types[extname(name)],data:readFileSync('public/'+name).toString('base64')};
}
const source=readFileSync('worker/gateway.mjs','utf8').replace('/*ASSETS*/ {}',JSON.stringify(assets)).replace('/*TELEMETRY*/',readFileSync('worker/telemetry.mjs','utf8')).replace("/*GATE*/ ''",JSON.stringify(readFileSync('worker/gate.html','utf8')));
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js',source);writeFileSync('dist/.openai/hosting.json',readFileSync('.openai/hosting.json'));
console.log(JSON.stringify({assets:Object.keys(assets).length,workerBytes:Buffer.byteLength(source),staticBypass:false}));
