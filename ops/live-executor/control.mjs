import http from 'node:http';
let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>8192)throw Error('input_too_large');}
const req=http.request({socketPath:'/run/bithash-executor/control.sock',path:'/command',method:'POST',headers:{'Content-Type':'application/json'},timeout:20000},res=>{let body='';res.on('data',x=>{body+=x;if(body.length>1000000)res.destroy();});res.on('end',()=>{process.stdout.write(body);if(res.statusCode!==200)process.exitCode=1;});res.on('error',()=>{process.exitCode=1;});});
req.on('timeout',()=>req.destroy());req.on('error',()=>{console.error('executor_unavailable');process.exitCode=1;});req.end(input);
