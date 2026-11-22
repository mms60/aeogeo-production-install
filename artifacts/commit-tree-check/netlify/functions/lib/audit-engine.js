'use strict';
const cheerio=require('cheerio');
const {normalURL,getPage,robotsAllowed}=require('./crawler');
const {analyze,summarize}=require('./metrics');
async function crawlSite(target,options={}){
 const limit=Math.max(1,Math.min(25,Number(options.pageLimit)||25));
 let start=normalURL(target),robots='';
 async function readRobots(origin){const r=await getPage(origin+'/robots.txt');if(r.status===404)return '';if(r.status!==200)throw new Error('Cannot safely check robots.txt (HTTP '+r.status+').');return r.text;}
 robots=await readRobots(start.origin);
 if(!robotsAllowed(robots,start.pathname+start.search,'aeogeoauditbot'))throw new Error('This page is disallowed for the audit crawler.');
 const skipped=[],isOversized=e=>/Page exceeds the 1\.8 MB audit download limit\./.test(String(e?.message||''));
 const oversizedPages=()=>skipped.filter(p=>p.code==='page_too_large');
 let first=null;try{first=await getPage(start.href);}catch(e){if(!isOversized(e))throw e;skipped.push({url:start.href,reason:e.message,code:'page_too_large'});}
 if(first&&(first.status!==200||!/text\/html|application\/xhtml\+xml/i.test(first.type)))throw new Error('The starting URL did not return readable HTML (HTTP '+first.status+').');
 const origin=first?new URL(first.url).origin:start.origin;if(origin!==start.origin)robots=await readRobots(origin);
 const permitted=url=>robotsAllowed(robots,new URL(url).pathname+new URL(url).search,'aeogeoauditbot');
 if(first&&!permitted(first.url))throw new Error('The redirected page is disallowed for the audit crawler.');
 if(!first)await options.onProgress?.({analyzed:0,discovered:1,limit,oversizedPages:oversizedPages(),skipped:skipped.length});
 const sitemapURLs=new Set(),maps=[origin+'/sitemap.xml'];
 for(const m of robots.matchAll(/^sitemap:\s*(\S+)/gim))try{const u=normalURL(m[1]);if(u.origin===origin)maps.push(u.href);}catch{}
 const readMaps=new Set();
 while(maps.length&&readMaps.size<10&&sitemapURLs.size<10000){const url=maps.shift();if(readMaps.has(url))continue;readMaps.add(url);try{const r=await getPage(url);if(r.status!==200)continue;const $=cheerio.load(r.text,{xmlMode:true});$('url > loc').each((_,e)=>{try{const u=normalURL($(e).text().trim());if(u.origin===origin&&!u.search)sitemapURLs.add(u.href);}catch{}});$('sitemap > loc').each((_,e)=>{try{const u=normalURL($(e).text().trim());if(u.origin===origin)maps.push(u.href);}catch{}});}catch{}}
 const process=p=>analyze(p.text,p.url,{inSitemap:sitemapURLs.has(p.url),botAllowed:robotsAllowed(robots,new URL(p.url).pathname,'oai-searchbot')&&robotsAllowed(robots,new URL(p.url).pathname,'perplexitybot')});
 const pages=first?[process(first)]:[],queue=[...new Set([...sitemapURLs,...(pages[0]?.internalLinks||[])])].slice(0,10000),enqueued=new Set(queue),seen=new Set([first?first.url:start.href]);const deadline=Date.now()+650000;let rounds=0;
 const progress=()=>({analyzed:pages.length,discovered:seen.size+queue.length,limit,oversizedPages:oversizedPages(),skipped:skipped.length});
 await options.onProgress?.(progress());
 while(queue.length&&pages.length<limit&&seen.size<limit*3&&Date.now()<deadline){
  const batch=[];
  while(queue.length&&batch.length<3&&pages.length+batch.length<limit&&seen.size<limit*3){let u;try{u=normalURL(queue.shift());}catch{continue;}if(u.origin!==origin||u.search||seen.has(u.href)||/\.(pdf|zip|png|jpe?g|gif|webp|svg|mp4|css|js|xml)$/i.test(u.pathname))continue;seen.add(u.href);if(!permitted(u.href)){skipped.push({url:u.href,reason:'Disallowed by robots.txt'});continue;}batch.push(u.href);}
  if(!batch.length)continue;
  const oversizedBefore=oversizedPages().length;
  const results=await Promise.all(batch.map(async url=>{try{const p=await getPage(url);if(new URL(p.url).origin!==origin||!permitted(p.url))return {skip:{url,reason:'Redirected outside this site or into a disallowed path'}};if(p.status!==200||!/text\/html|application\/xhtml\+xml/i.test(p.type))return{skip:{url,reason:'No readable HTML; HTTP '+p.status}};return{page:process(p)};}catch(e){return{skip:{url,reason:e.message,...(isOversized(e)?{code:'page_too_large'}:{})}};}}));
  for(const r of results){if(r.page&&!pages.some(p=>p.url===r.page.url)){pages.push(r.page);for(const link of r.page.internalLinks)if(!enqueued.has(link)&&enqueued.size<10000){enqueued.add(link);queue.push(link);}}else if(r.skip)skipped.push(r.skip);}
  if(++rounds%5===0||oversizedPages().length!==oversizedBefore)await options.onProgress?.(progress());
  await new Promise(r=>setTimeout(r,700));
 }
 await options.onProgress?.(progress());
 if(!pages.length)throw new Error(oversizedPages().length?'No pages could be analyzed. '+oversizedPages().length+' page(s) exceeded the 1.8 MB per-file limit and were skipped. No other eligible pages could be analyzed within the scan limits. An audit can include up to 25 eligible pages, not oversized files.':'No readable, permitted pages were available to analyze. An audit can include up to 25 eligible pages.');
 return summarize(pages.map(({internalLinks,...p})=>p),start.href,{pageLimit:limit,skipped,sitemap:{documents:readMaps.size,urls:sitemapURLs.size},partial:queue.length>0||skipped.length>0,source:'Live HTTPS fetch; initial HTML only'});
}
module.exports={crawlSite};
