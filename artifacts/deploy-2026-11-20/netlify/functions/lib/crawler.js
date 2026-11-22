'use strict';
const https=require('node:https');
const dns=require('node:dns').promises;
const ipaddr=require('ipaddr.js');
const cheerio=require('cheerio');
const USER_AGENT='AEOGEOAuditBot/1.0 (+https://aeogeosearch.com; user-requested technical audit)';
const MAX_BYTES=1800000;
function normalURL(value){
 let s=String(value||'').trim(); if(!/^https?:\/\//i.test(s))s='https://'+s;
 let u;try{u=new URL(s);}catch{throw new Error('Enter a valid public website address.');}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))throw new Error('Use an HTTPS website on the standard port, without embedded passwords.');
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(ipaddr.isValid(host)||!host.includes('.')||host.endsWith('.local')||host.endsWith('.localhost')||host.endsWith('.internal')||host==='localhost')throw new Error('Only public website domain names are allowed.');
 if(s.length>2048)throw new Error('That website address is too long.');
 u.hash='';return u;
}
function isPublicIP(value){try{const a=ipaddr.process(value);return a.range()==='unicast';}catch{return false;}}
async function resolvePublic(host){
 const addresses=await Promise.race([dns.lookup(host,{all:true,verbatim:true}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Website DNS timed out.')),5000);t.unref();})]);
 if(!addresses.length||addresses.some(a=>!isPublicIP(a.address)))throw new Error('This address does not resolve exclusively to public internet addresses.');
 return addresses[0];
}
async function getPage(value,redirects=0){
 const u=normalURL(value);if(redirects>5)throw new Error('Too many website redirects.');
 const resolved=await resolvePublic(u.hostname);
 const result=await new Promise((resolve,reject)=>{
  // Pin the connection to the validated IP; preserve hostname for TLS and Host header.
  const req=https.request(u,{method:'GET',agent:false,servername:u.hostname,lookup:(_host,opts,cb)=>{if(opts?.all)cb(null,[resolved]);else cb(null,resolved.address,resolved.family);},headers:{'User-Agent':USER_AGENT,Accept:'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.8','Accept-Encoding':'identity'}},res=>{
   if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();resolve({redirect:new URL(res.headers.location,u).href});return;}
   let bytes=0;const chunks=[];
   res.on('data',c=>{bytes+=c.length;if(bytes>MAX_BYTES){res.destroy(new Error('Page exceeds the 1.8 MB audit download limit.'));return;}chunks.push(c);});
   res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,type:String(res.headers['content-type']||''),text:Buffer.concat(chunks).toString('utf8'),url:u.href}));
  });
  req.setTimeout(6500,()=>req.destroy(new Error('Website response timed out.')));
  const hard=setTimeout(()=>req.destroy(new Error('Website download timed out.')),10000);hard.unref();
  req.on('close',()=>clearTimeout(hard));req.on('error',reject);req.end();
 });
 return result.redirect?getPage(result.redirect,redirects+1):result;
}
function robotsGroups(text){
 const groups=[];let group=null,sawRule=false;
 for(let line of text.split(/\r?\n/)){line=line.split('#')[0].trim();if(!line)continue;const i=line.indexOf(':');if(i<0)continue;const k=line.slice(0,i).trim().toLowerCase(),v=line.slice(i+1).trim();
 if(k==='user-agent'){if(!group||sawRule){group={agents:[],rules:[]};groups.push(group);sawRule=false;}group.agents.push(v.toLowerCase());}
 else if(group&&(k==='allow'||k==='disallow')){group.rules.push({allow:k==='allow',path:v});sawRule=true;}}
 return groups;
}
function robotsAllowed(text,path,agent='aeogeo auditbot'){
 const groups=robotsGroups(text);let selected=[],specificity=-1;
 for(const g of groups){const names=g.agents.filter(a=>a==='*'||agent.toLowerCase().includes(a));if(!names.length)continue;const n=Math.max(...names.map(a=>a==='*'?0:a.length));if(n>specificity){selected=[g];specificity=n;}else if(n===specificity)selected.push(g);}
 let best={length:-1,allow:true};
 for(const g of selected)for(const rule of g.rules){if(!rule.path)continue;let expr=rule.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');if(expr.endsWith('\\$'))expr=expr.slice(0,-2)+'$';
 if(new RegExp('^'+expr).test(path)){const length=rule.path.replace(/\*/g,'').length;if(length>best.length||(length===best.length&&rule.allow))best={length,allow:rule.allow};}}
 return best.allow;
}
function analyzeHTML(html,url){
 const $=cheerio.load(html);
 const title=$('title').first().text().trim();const description=$('meta[name="description" i]').attr('content')?.trim()||'';
 const h1=$('h1').length;const headings=$('h1,h2,h3,h4,h5,h6').toArray().map(e=>Number(e.tagName.slice(1)));
 let hierarchy=true;for(let i=1;i<headings.length;i++)if(headings[i]>headings[i-1]+1)hierarchy=false;
 const images=$('img').toArray();const missingAlt=images.filter(e=>$(e).attr('alt')===undefined).length;
 const scripts=$('script[type="application/ld+json"]').toArray();let validJSON=0;for(const e of scripts)try{const v=JSON.parse($(e).text());if(v&&typeof v==='object')validJSON++;}catch{}
 const canonical=$('link[rel="canonical"]').attr('href')||'';
 const answerHeadings=$('h2,h3').toArray().filter(e=>/\?|\b(faq|frequently asked)\b/i.test($(e).text())).length;
 const links=[];let external=0;const origin=new URL(url).origin;
 $('a[href]').each((_,e)=>{try{const u=new URL($(e).attr('href'),url);u.hash='';if(u.protocol==='https:'){if(u.origin===origin){if(!u.search)links.push(u.href);}else external++;}}catch{}});
 $('script,style,noscript,nav,footer,header,svg').remove();const text=$('body').text().replace(/\s+/g,' ').trim();const words=text?text.split(/\s+/).length:0;
 const checks=[
 {name:'Page title',pass:title.length>0,detail:title?title.slice(0,180):'No title element found in fetched HTML.',fix:'Add a unique, descriptive title.'},
 {name:'Meta description',pass:description.length>0,detail:description?description.slice(0,220):'No non-empty meta description found.',fix:'Add an accurate summary in a meta description.'},
 {name:'Single H1',pass:h1===1,detail:h1+' H1 heading(s) found.',fix:'Use one clear main heading that identifies the page topic.'},
 {name:'Heading sequence',pass:headings.length?hierarchy:null,detail:headings.length?'Heading levels: '+headings.join(', '):'No headings found.',fix:'Use a clear heading outline without skipping levels.'},
 {name:'Image alt attributes',pass:images.length?missingAlt===0:null,detail:images.length?missingAlt+' of '+images.length+' images lack an alt attribute. Empty alt may be appropriate for decorative images.':'No images in fetched HTML; not scored.',fix:'Describe meaningful images and use empty alt for decorative images.'},
 {name:'Parseable JSON-LD',pass:validJSON>0,detail:validJSON+' of '+scripts.length+' JSON-LD blocks parse as JSON objects. This does not validate Schema.org eligibility or accuracy.',fix:'Add relevant, accurate structured data and validate it with an appropriate schema tool.'},
 {name:'Canonical declaration',pass:Boolean(canonical),detail:canonical?canonical.slice(0,240):'No canonical link declaration found.',fix:'Declare the intended canonical URL where appropriate.'},
 {name:'Answer-oriented headings',pass:answerHeadings>0,detail:answerHeadings+' question/FAQ heading(s) detected by a simple text heuristic. This is not proof of answer quality.',fix:'Where useful, answer real customer questions under clear headings. Not every page needs an FAQ.'},
 {name:'Text in initial HTML',pass:words>=100,detail:words+' approximate whitespace-separated words after navigation and scripts were removed. No browser JavaScript rendering was performed.',fix:'Make the page’s useful main content available in initial HTML. Short utility pages may legitimately have less text.'}
 ];
 const applicable=checks.filter(c=>c.pass!==null);const score=Math.round(100*applicable.filter(c=>c.pass).length/applicable.length);
 return {url,title:title||url,score,words,checks,internalLinks:[...new Set(links)].slice(0,100),externalLinkCount:external};
}
async function crawl(target){
 const initial=normalURL(target);let robots='',robotsStatus='Unknown';
 try{const r=await getPage(initial.origin+'/robots.txt');if(r.status===200){robots=r.text;robotsStatus='Fetched';}else if(r.status===404){robotsStatus='Not found (404)';}else throw new Error('Robots rules could not be checked.');}catch(e){throw new Error('Could not safely check robots.txt: '+e.message);}
 if(!robotsAllowed(robots,initial.pathname+initial.search,'aeogeoauditbot'))throw new Error('This website’s robots.txt does not permit our audit crawler at that address.');
 const home=await getPage(initial.href);
 if(home.status!==200||!/text\/html|application\/xhtml\+xml/i.test(home.type))throw new Error('The website did not return a readable HTML page (HTTP '+home.status+').');
 const origin=new URL(home.url).origin;
 if(origin!==initial.origin){const r=await getPage(origin+'/robots.txt');if(r.status===200)robots=r.text;else if(r.status===404)robots='';else throw new Error('Could not check the redirected website’s robots.txt.');robotsStatus=r.status===200?'Fetched':'Not found (404)';}
 if(!robotsAllowed(robots,new URL(home.url).pathname,'aeogeoauditbot'))throw new Error('The redirected page is disallowed for our crawler.');
 const pages=[analyzeHTML(home.text,home.url)], skipped=[];let sitemapStatus='Not found or unavailable';let sitemapURLs=[];
 try{const sm=await getPage(origin+'/sitemap.xml');if(sm.status===200){const $=cheerio.load(sm.text,{xmlMode:true});sitemapURLs=$('url > loc').toArray().map(e=>$(e).text().trim());sitemapStatus=$('sitemapindex').length?'Sitemap index found; child sitemaps are not expanded in this version.':sitemapURLs.length+' URL(s) read from /sitemap.xml';}}catch{}
 const queue=[...sitemapURLs,...pages[0].internalLinks],seen=new Set([home.url]);const deadline=Date.now()+105000;
 while(queue.length&&pages.length<25&&seen.size<60&&Date.now()<deadline){
  const batch=[];while(queue.length&&batch.length<3&&pages.length+batch.length<25&&seen.size<60){let u;try{u=normalURL(queue.shift());}catch{continue;}if(u.origin!==origin||u.search||/\.(pdf|zip|png|jpe?g|gif|webp|svg|mp4|css|js|xml)$/i.test(u.pathname)||seen.has(u.href))continue;seen.add(u.href);if(!robotsAllowed(robots,u.pathname,'aeogeoauditbot')){skipped.push({url:u.href,reason:'Disallowed by robots.txt'});continue;}batch.push(u.href);}
  if(!batch.length)continue;
  const results=await Promise.all(batch.map(async url=>{try{const p=await getPage(url);if(new URL(p.url).origin!==origin)return {skip:{url,reason:'Redirected outside audited origin'}};if(!robotsAllowed(robots,new URL(p.url).pathname,'aeogeoauditbot'))return {skip:{url,reason:'Redirect destination disallowed by robots.txt'}};if(p.status!==200||!/text\/html|application\/xhtml\+xml/i.test(p.type))return {skip:{url,reason:'Not readable HTML; HTTP '+p.status}};return {page:analyzeHTML(p.text,p.url)};}catch(e){return {skip:{url,reason:e.message}};}}));
  for(const r of results){if(r.page){if(!pages.some(p=>p.url===r.page.url)){pages.push(r.page);queue.push(...r.page.internalLinks);}}else skipped.push(r.skip);}
  await new Promise(r=>setTimeout(r,500));
 }
 const score=Math.round(pages.reduce((a,p)=>a+p.score,0)/pages.length);
 const fixes=new Map();for(const p of pages)for(const c of p.checks)if(c.pass===false){const key=c.name;const item=fixes.get(key)||{name:key,recommendation:c.fix,pages:[]};item.pages.push(p.url);fixes.set(key,item);}
 return {version:1,createdAt:new Date().toISOString(),target:initial.href,score,pageCount:pages.length,pageLimit:25,pages:pages.map(({internalLinks,...p})=>p),skipped,robots:{status:robotsStatus,chatGPTSearch:robotsAllowed(robots,'/','oai-searchbot'),perplexitySearch:robotsAllowed(robots,'/','perplexitybot'),note:'Robots interpretation at / only. Training and search agents differ. Permission is not a guarantee of crawling, indexing, or citation.'},sitemapStatus,fixes:[...fixes.values()].sort((a,b)=>b.pages.length-a.pages.length),limitations:['This is an equal-weight technical HTML readiness checklist, not a validated AI visibility score or ranking prediction.','Up to 25 discoverable pages on one HTTPS origin. Sitemap indexes, JavaScript rendering, search results, actual AI answers, backlinks, citation frequency, and Core Web Vitals are not measured.','Unknown or not-applicable checks are excluded from the page score. Heuristic recommendations need human review.','A partial scan may omit blocked, failed, large, slow, or undiscovered pages. See the skipped list.']};
}
module.exports={normalURL,isPublicIP,getPage,robotsAllowed,analyzeHTML,crawl};
