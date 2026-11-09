'use strict';
const cheerio=require('cheerio');
const PILLARS=[{id:'cq',name:'Content Quality',weight:35},{id:'ai',name:'AI Readiness',weight:30},{id:'tech',name:'Technical Basis',weight:15},{id:'auth',name:'Authority & Trust',weight:20}];
// Within-pillar weights are normalized; global pillar weights sum to 100.
const SPECS=[
 ['readability','Readability & sentence length','cq',8,'heuristic'],['comprehensiveness','Content depth & coverage','cq',6,'heuristic'],['flow','Paragraph transitions','cq',4,'heuristic'],['lsi_keywords','Related-topic coverage','cq',5,'unavailable'],['answer_completeness','Standalone answer passages','cq',7,'heuristic'],['factual_density','Numeric detail','cq',5,'heuristic'],['citability','Non-promotional tone','cq',5,'heuristic'],
 ['structure','Heading hierarchy','ai',7,'measured'],['ai_optimization','Q&A and definition signals','ai',8,'heuristic'],['image_alt','Image alt attributes','ai',3,'measured'],['platform_specificity','Cross-platform extraction testing','ai',5,'unavailable'],['content_type','Structured content formats','ai',4,'measured'],['semantic_clarity','Sentence clarity signals','ai',3,'heuristic'],
 ['ai_bot_access','Search-crawler robots permission','tech',5,'measured'],['schema_validator','Parseable JSON-LD','tech',5,'measured'],['sitemap_depth','Sitemap membership','tech',2,'measured'],['page_speed','Initial HTML text availability','tech',2,'measured'],['freshness','Declared update date','tech',1,'measured'],
 ['citations','External source links','auth',6,'measured'],['eeat_signals','Author and organization declarations','auth',6,'heuristic'],['knowledge_graph','sameAs entity declarations','auth',4,'measured'],['topical_authority','Internal topic linking signals','auth',4,'heuristic']
].map(([id,name,pillar,weight,method])=>({id,name,pillar,weight,method}));
function syllables(word){let w=word.toLowerCase().replace(/[^a-z]/g,'');if(w.length<4)return w?1:0;w=w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').replace(/^y/,'');return Math.max(1,(w.match(/[aeiouy]{1,2}/g)||[]).length);}
function analyze(html,url,context={}){
 const $=cheerio.load(html),origin=new URL(url).origin;
 const title=$('title').first().text().trim()||new URL(url).pathname;
 const headings=$('h1,h2,h3,h4,h5,h6').toArray().map(e=>({level:Number(e.tagName.slice(1)),text:$(e).text().trim()}));
 const paragraphs=$('main p,article p').length?$('main p,article p'):$('body p');
 const passageWords=paragraphs.toArray().map(e=>$(e).text().trim().split(/\s+/).filter(Boolean).length);
 const img=$('img').toArray(),missingAlt=img.filter(e=>$(e).attr('alt')===undefined).length;
 const jsonBlocks=[];let invalidJSON=0;
 $('script[type="application/ld+json"]').each((_,e)=>{try{const v=JSON.parse($(e).text());if(v&&typeof v==='object')jsonBlocks.push(v);else invalidJSON++;}catch{invalidJSON++;}});
 const schemaText=JSON.stringify(jsonBlocks);const sameAs=(schemaText.match(/"sameAs"/g)||[]).length;
 const links=[],external=[]; $('a[href]').each((_,e)=>{try{const u=new URL($(e).attr('href'),url);u.hash='';if(u.protocol==='https:'){if(u.origin===origin&&!u.search)links.push(u.href);else if(u.origin!==origin)external.push(u.href);}}catch{}});
 const date=$('meta[property="article:modified_time"]').attr('content')||$('time[datetime]').first().attr('datetime')||schemaText.match(/"dateModified":"([^"]+)"/)?.[1];
 const hasAuthor=Boolean($('meta[name="author"],a[rel="author"],[itemprop="author"]').length||/"@type":"(?:Person|Organization)"/.test(schemaText));
 const structured=$('ol,ul,table').length;
 $('script,style,noscript,nav,footer,header,svg').remove();
 const body=$('main,article').first().length?$('main,article').first().text():$('body').text();
 const text=body.replace(/\s+/g,' ').trim();const words=text.match(/\b[A-Za-z][A-Za-z'’-]*\b/g)||[];
 const sentences=text.split(/[.!?]+(?:\s|$)/).filter(x=>x.trim().length>2);const wc=words.length,avg=wc/Math.max(1,sentences.length);
 const flesch=wc>=30?Math.round(206.835-1.015*avg-84.6*words.reduce((n,w)=>n+syllables(w),0)/wc):null;
 const num=(text.match(/\b\d+(?:[.,]\d+)*(?:%|\b)/g)||[]).length;
 const hype=(text.match(/\b(best|unparalleled|world.class|revolutionary|guaranteed|leading)\b/gi)||[]).length;
 const transitions=(text.match(/\b(however|therefore|for example|in addition|as a result|in contrast|because)\b/gi)||[]).length;
 const qa=headings.filter(h=>/\?|\b(faq|frequently asked)\b/i.test(h.text)).length;
 const outline=headings.length>0&&headings.filter(h=>h.level===1).length===1&&headings.every((h,i)=>!i||h.level<=headings[i-1].level+1);
 const observations={
 readability:[flesch===null?null:Math.max(0,Math.min(100,flesch)),flesch===null?'Too little English text for this heuristic.':`Approximate English Flesch score ${flesch}; ${Math.round(avg)} words per sentence.`,`Split difficult sentences where clarity improves; confirm with editorial review.`],
 comprehensiveness:[wc<30?null:Math.min(100,Math.round(wc/6)),`${wc} approximate English words in fetched main text. Length alone does not establish topic completeness.`,`Review whether the page answers its intended audience’s questions; do not pad short utility pages.`],
 flow:[wc<30?null:Math.min(100,Math.round(transitions/Math.max(1,passageWords.length)*200)),`${transitions} transition phrase matches. This is not a model behavior measurement.`,`Use transitions where they clarify the argument, not to satisfy a keyword quota.`],
 lsi_keywords:[null,'Not measured. Requires a defined topic/reference corpus or a configured semantic evaluator.','Use a topic-specific editorial review. No semantic coverage claim is made.'],
 answer_completeness:[wc<30?null:passageWords.some(n=>n>=40&&n<=250)?100:30,`${passageWords.filter(n=>n>=40&&n<=250).length} paragraphs contain 40–250 whitespace-separated words. Completeness is not verified.`,`Write self-contained answers appropriate to the question; no universal word-count sweet spot is assumed.`],
 factual_density:[wc<30?null:Math.min(100,Math.round(num/Math.max(1,wc)*2000)),`${num} numeric strings found. Their accuracy and sources were not verified.`,`Support meaningful statistics with evidence; avoid adding numbers solely for scoring.`],
 citability:[wc<30?null:Math.max(0,100-hype*15),`${hype} promotional-word matches. Neutral tone does not guarantee citations.`,`Replace unsupported superlatives with specific, substantiated statements.`],
 structure:[headings.length?outline?100:35:0,`${headings.length} headings; ${headings.filter(h=>h.level===1).length} H1(s). ${outline?'No skipped levels detected.':'Outline needs review.'}`,`Use a clear main heading and coherent heading structure.`],
 ai_optimization:[wc<30?null:qa?100:/\bis (?:a|an|the)\b/i.test(text)?60:20,`${qa} question/FAQ heading(s). Definition detection is a text heuristic.`,`Answer genuine customer questions directly where it suits the page.`],
 image_alt:[img.length?Math.round(100*(img.length-missingAlt)/img.length):null,`${missingAlt} of ${img.length} images lack an alt attribute. Empty alt may be correct for decorative images.`,`Provide useful alternative text for meaningful images; manually review descriptive quality.`],
 platform_specificity:[null,'Not measured. No live ChatGPT, Perplexity or Gemini response tests were run.','Use a separately configured, repeatable prompt-monitoring system for actual answer/citation measurements.'],
 content_type:[structured?100:30,`${structured} list/table element(s) found; suitability for page intent is not verified.`,`Use lists, steps and tables only where they help readers.`],
 semantic_clarity:[wc<30?null:avg<=25?100:Math.max(10,Math.round(100-(avg-25)*3)),`Average ${Math.round(avg)} English words per sentence. Active voice and entity ambiguity are not measured.`,`Review long sentences and ambiguous references manually.`],
 ai_bot_access:[context.botAllowed===undefined?null:context.botAllowed?100:0,context.botAllowed===undefined?'Robots check unavailable.':context.botAllowed?'OAI-SearchBot and PerplexityBot are not disallowed for this path.':'At least one search crawler is disallowed for this path. Training agents are separate.',`Review search-bot permissions against your publishing policy; never blindly allow training or private paths.`],
 schema_validator:[jsonBlocks.length?invalidJSON?65:100:0,`${jsonBlocks.length} parseable JSON-LD block(s), ${invalidJSON} invalid. Schema.org compliance and truthfulness are not validated.`,`Use accurate markup matching visible content, then validate it with the relevant schema tools.`],
 sitemap_depth:[context.inSitemap===undefined?null:context.inSitemap?100:30,context.inSitemap===undefined?'Sitemap membership unknown.':context.inSitemap?'URL found in the discovered sitemap set.':'URL not found in the discovered sitemap set. Crawl depth was not measured.',`Include canonical public URLs in a valid sitemap; inspect navigation depth separately.`],
 page_speed:[wc>=50?100:20,`${wc} English words in initial HTML. Browser rendering, loading speed and Core Web Vitals were not tested.`,`Ensure useful content is accessible to relevant crawlers; use a performance tool for speed measurements.`],
 freshness:[date?100:30,date?`Declared date: ${String(date).slice(0,80)}. Accuracy and relevance were not verified.`:'No supported explicit update-date declaration found. Not every page requires a date.',`Declare truthful update dates when relevant; never change dates without substantive updates.`],
 citations:[external.length?100:25,`${new Set(external).size} unique external HTTPS link(s). Source authority and claim support were not verified.`,`Cite relevant primary evidence where claims need support; domain suffix alone is not proof of authority.`],
 eeat_signals:[hasAuthor?100:30,hasAuthor?'An author/organization declaration is present; identity and credentials are not independently verified.':'No supported author/organization declaration found.',`Identify responsible authors or organizations and use genuine credentials.`],
 knowledge_graph:[sameAs?100:30,`${sameAs} sameAs declaration(s). Entity accuracy and external identities are not verified.`,`Link only genuine matching official profiles in relevant structured data.`],
 topical_authority:[links.length?Math.min(100,links.length*15):10,`${new Set(links).size} unique internal HTTPS links. Topical authority and relevance are not established.`,`Connect genuinely related resources with descriptive links; do not overlink for a score.`]
 };
 const metrics=SPECS.map(s=>{const [score,evidence,fix]=observations[s.id];return {...s,score,status:score===null?'unavailable':score>=70?'pass':score>=40?'review':'fail',evidence,fix};});
 const pillars=PILLARS.map(p=>{const applicable=metrics.filter(m=>m.pillar===p.id&&m.score!==null);const weights=applicable.reduce((n,m)=>n+m.weight,0);return{...p,score:weights?Math.round(applicable.reduce((n,m)=>n+m.score*m.weight,0)/weights):null};});
 const measured=pillars.filter(p=>p.score!==null),weight=measured.reduce((n,p)=>n+p.weight,0);
 const score=weight?Math.round(measured.reduce((n,p)=>n+p.score*p.weight,0)/weight):null;
 return {url,path:new URL(url).pathname,title:title.slice(0,180),words:wc,score,pillars,metrics,internalLinks:[...new Set(links)].slice(0,300),coverage:metrics.filter(m=>m.score!==null).length};
}
function summarize(pages,target,extra={}){
 const pillars=PILLARS.map(p=>{const values=pages.map(x=>x.pillars.find(y=>y.id===p.id)?.score).filter(x=>x!==null&&x!==undefined);return {...p,score:values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null};});
 const valid=pillars.filter(p=>p.score!==null);const score=valid.length?Math.round(valid.reduce((a,p)=>a+p.score*p.weight,0)/valid.reduce((a,p)=>a+p.weight,0)):null;
 const fixes=SPECS.map(spec=>{const affected=pages.filter(p=>p.metrics.some(m=>m.id===spec.id&&m.score!==null&&m.score<70));const metric=affected[0]?.metrics.find(m=>m.id===spec.id);return metric?{id:spec.id,title:spec.name,pillar:spec.pillar,priority:metric.score<40?'High':'Medium',fix:metric.fix,affected:affected.map(p=>p.url),weight:spec.weight}:null;}).filter(Boolean).sort((a,b)=>b.affected.length-a.affected.length);
 return {version:3,createdAt:new Date().toISOString(),target,score,pillars,pages,fixes,pageCount:pages.length,framework:'AEOGEO 22-point framework, version 1; not a university certification or validated AI visibility measure.',limitations:['Scores combine measured HTML checks with explicitly labeled editorial heuristics. Unknown checks are excluded, not marked Pass.','Related-topic coverage and cross-platform AI extraction are not measured in this build. No actual assistant citations or ranking positions are collected.','Initial HTML only. JavaScript is not rendered. English readability heuristics are not reliable for other languages.','The simulator changes this checklist score under stated assumptions; it does not forecast citations, rankings, traffic or revenue.'],...extra};
}
module.exports={PILLARS,SPECS,analyze,summarize};
