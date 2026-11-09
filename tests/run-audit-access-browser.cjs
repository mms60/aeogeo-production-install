'use strict';
// One-shot local test harness. The server closes when the checks finish.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../site');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/.netlify/functions/')){res.writeHead(503,{'Content-Type':'application/json'});return res.end('{"error":"Local test only"}');}
 let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)&&!path.extname(file)&&fs.existsSync(file+'.html'))file+='.html';
 if(!fs.existsSync(file)){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
(async()=>{try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4173,'0.0.0.0',resolve);});for(const name of ['audit-access-browser.cjs'])await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,name)],{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(name+' failed with '+code)));});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}})().catch(e=>{console.error(e);process.exitCode=1;});
