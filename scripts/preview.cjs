'use strict';
// Local static review only. No private database access, checkout, or deploy commands.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../site'),port=Number(process.env.PORT)||4173;
const redirects=new Map();
for(const line of fs.readFileSync(path.join(ROOT,'_redirects'),'utf8').split(/\r?\n/)){const [from,to,status]=line.trim().split(/\s+/);if(!from?.startsWith('/')||!to?.startsWith('/')||!/^30[12]!?$/.test(status||'')||/[*?:]/.test(from+to)||redirects.has(from))continue;redirects.set(from,{to,status:Number(status.replace('!',''))});}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{let pathname,search;try{const url=new URL(req.url,'http://preview');pathname=decodeURIComponent(url.pathname);search=url.search;}catch{res.writeHead(400);return res.end('Bad path');}
if(pathname.startsWith('/.netlify/functions/')){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({error:'Local UI preview only: no private database or payment service is connected. Use “Explore a sample report” to review the dashboard. Your live test site is unchanged.'}));}
const redirect=redirects.get(pathname);if(redirect){res.writeHead(redirect.status,{'Location':redirect.to+search,'Cache-Control':'no-store'});return res.end();}
let file=path.resolve(ROOT,'.'+pathname);if(!file.startsWith(ROOT+path.sep)&&file!==ROOT){res.writeHead(403);return res.end('Forbidden');}
if(fs.existsSync(file)&&fs.statSync(file).isDirectory()){const dirIndex=path.join(file,'index.html');file=fs.existsSync(dirIndex)?dirIndex:file+'.html';}if(!fs.existsSync(file)&&!path.extname(file)&&fs.existsSync(file+'.html'))file+='.html';if(!fs.existsSync(file))file=path.join(ROOT,'index.html');
res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});fs.createReadStream(file).pipe(res);});
server.listen(port,'0.0.0.0',()=>console.log(`Local product review available on port ${port}. Billing and remote job execution are disabled.`));
