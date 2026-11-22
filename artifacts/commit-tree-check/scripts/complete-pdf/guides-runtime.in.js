/* Shared, deterministic implementation guidance for the isolated preview.
   Findings and scores still come from the report; this module does not crawl,
   change a score, submit data, or invent evidence. */
(function(root){
  'use strict';
  const GUIDES = __GUIDES_JSON__;
  const PLAYBOOK = __PLAYBOOK_JSON__;
  const PILLARS = {cq:'Content Quality',ai:'AI Readiness',tech:'Technical Basis',auth:'Authority & Trust'};
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function typeOf(metric){
    const kind=String(metric.method || metric.classification || '').toLowerCase();
    const status=String(metric.status || '').toLowerCase();
    if(kind==='not_applicable' || status==='not_applicable') return 'not_applicable';
    if(metric.score===null || metric.score===undefined || kind==='unavailable' || status==='unavailable') return 'unavailable';
    const numeric=Number(metric.score);
    if(typeof metric.score==='boolean' || String(metric.score).trim()==='' || !Number.isFinite(numeric) || numeric<0 || numeric>100) return 'unavailable';
    if(status==='pass') return 'pass';
    if(status==='review' || status==='fail') return 'review';
    return numeric<100 ? 'review' : 'pass';
  }
  function renderKnownGuide(id){
    const g=Object.prototype.hasOwnProperty.call(GUIDES,id) ? GUIDES[id] : null;
    if(!g) return '<div class="plain-guide guide-unavailable"><strong>Manual review needed.</strong> A detailed guide was not available for this older or unknown check. Do not guess at a fix; review the evidence with a suitable specialist.</div>';
    return `<div class="plain-guide guide-review"><strong>How to review and improve this</strong><p><b>Who:</b> ${esc(g.owner)}</p><p><b>Where:</b> ${esc(g.where)}</p><p><b>When:</b> ${esc(g.when)}</p><ol>${g.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><p><b>How to check your work:</b> ${esc(g.verify)}</p>${g.caution?`<p><b>Important:</b> ${esc(g.caution)}</p>`:''}</div>`;
  }
  function renderGuide(metric){
    const kind=typeOf(metric);
    if(kind==='unavailable') return '<div class="plain-guide guide-unavailable"><strong>Not evaluated.</strong> The audit did not establish a problem for this check. The observation above is not a failed result.</div>';
    if(kind==='not_applicable') return '<div class="plain-guide guide-unavailable"><strong>Not applicable.</strong> No change is suggested by this check.</div>';
    if(kind==='pass') return '<div class="plain-guide guide-pass"><strong>No change indicated by this check.</strong> Review the evidence above; a pass is not proof of rankings, citations, or overall quality.</div>';
    // Local findings have a UUID in id and a catalog identifier in rule_id;
    // live-shaped reports normally put the catalog identifier in id instead.
    const guideId=Object.prototype.hasOwnProperty.call(GUIDES,metric.rule_id) ? metric.rule_id : metric.id;
    return renderKnownGuide(guideId);
  }
  function scoreText(value){return value===null || value===undefined ? 'Not scored' : String(value)+'/100';}
  function renderEvidence(value){
    const list=Array.isArray(value)?value:[value];
    return list.filter(v=>v!==null && v!==undefined && String(v).trim()).map(v=>`<p class="pdf-evidence">${esc(v)}</p>`).join('') || '<p class="pdf-evidence">No additional evidence was captured.</p>';
  }
  function renderPlaybook(){
    const sections=PLAYBOOK.map(s=>`<section class="pdf-tutorial"><h3>${esc(s.title)}</h3><p><b>Who:</b> ${esc(s.owner)}</p><p><b>Where:</b> ${esc(s.where)}</p><p><b>When:</b> ${esc(s.when)}</p><ol>${s.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol>${s.example?`<div class="pdf-example"><h4>Illustrative example — replace every placeholder</h4><pre>${esc(s.example)}</pre></div>`:''}<p><b>How to check your work:</b> ${esc(s.verify)}</p><p><b>Important:</b> ${esc(s.caution)}</p></section>`).join('');
    return `<section id="pdf-playbook"><h2>Practical implementation tutorials</h2><p>Use these general tutorials with the page-specific evidence above. They do not assert that an unavailable issue exists.</p><p><a href="#pdf-page-index">Back to the page list</a></p>${sections}</section>`;
  }
  function renderAppendix(report, templateFn){
    const pages=Array.isArray(report && report.pages)?report.pages:[];
    const index=pages.map((p,i)=>`<li><a href="#pdf-site-page-${i+1}">${esc(p.title || p.path || p.url || 'Untitled page')} — ${esc(p.url || p.path || 'address not recorded')}</a></li>`).join('');
    const header=`<h1>Complete page-by-page analysis and implementation guide</h1><p>This section contains every page and every metric included in the saved report. The PDF can be longer than the number of website pages analyzed.</p><p>Measured checks are observations; heuristics are review cues. Not evaluated does not mean a page failed. Instructions are general guidance, not proof that a change is needed. Do not assume rankings or AI citations were measured.</p><nav id="pdf-page-index" aria-label="List of analyzed pages"><h2>Find an analyzed page</h2><p>Select a page to go directly to its full findings and instructions.</p><ol>${index}</ol><p><a href="#pdf-playbook">Go to the practical implementation tutorials</a></p></nav>`;
    const body=pages.map((p,i)=>{
      const metrics=Array.isArray(p.metrics)?p.metrics:[];
      const count=metrics.filter(m=>m.score!==null && m.score!==undefined).length;
      const pills=Array.isArray(p.pillars)?p.pillars:[];
      const pillarText=pills.map(x=>`${PILLARS[x.id] || x.name || x.id}: ${scoreText(x.score)}`).join(' | ');
      const cards=metrics.map(m=>`<article class="pdf-metric"><h3>${esc(m.name || m.id || 'Unnamed check')}</h3><p class="pdf-meta"><b>Pillar:</b> ${esc(PILLARS[m.pillar] || m.pillar || 'not supplied')} &nbsp; <b>Method:</b> ${esc(m.method || m.classification || 'not supplied')} &nbsp; <b>Result:</b> ${esc(scoreText(m.score))} &nbsp; <b>Status:</b> ${esc(m.status || typeOf(m))}${m.weight===null || m.weight===undefined?'':` &nbsp; <b>Framework weight:</b> ${esc(m.weight)}`}</p><p><b>What the audit observed:</b></p>${renderEvidence(m.evidence)}<p><b>Original recommendation:</b> ${esc(m.fix || m.next_step || 'No recommendation was recorded.')}</p>${renderGuide(m)}</article>`).join('');
      let example='';
      const worst=metrics.filter(m=>m.score!==null && m.score!==undefined && Number(m.score)<70).sort((a,b)=>Number(a.score)-Number(b.score))[0];
      if(worst && typeof templateFn==='function'){
        let value=''; try{value=templateFn(worst.id);}catch{}
        if(value) example=`<div class="pdf-example"><h3>Original page template</h3><p>This is an example only. Verify the facts and do not paste a fragment into a page without the correct surrounding code.</p><pre>${esc(value)}</pre></div>`;
      }
      return `<section class="pdf-site-page" id="pdf-site-page-${i+1}"><header class="pdf-page-heading"><h2>Website page ${i+1} of ${pages.length}: ${esc(p.title || p.path || p.url || 'Untitled page')}</h2><p><b>Page address:</b> ${esc(p.url || p.path || 'Not recorded')}</p><p><b>Page score:</b> ${esc(scoreText(p.score))} &nbsp; <b>Checks scored:</b> ${count} of ${metrics.length}</p><p><b>Four pillars:</b> ${esc(pillarText || 'Not recorded')}</p><p><a href="#pdf-page-index">Back to the page list</a></p></header>${cards || '<p>No page-level check details were recorded in this report.</p>'}${example}</section>`;
    }).join('');
    return `<section id="aeogeo-page-appendix" aria-label="Complete page-by-page report">${header}${body || '<p>No analyzed pages were included in this report.</p>'}${renderPlaybook()}</section>`;
  }
  function addAppendix(report,templateFn){
    if(!root.document) return;
    removeAppendix();
    const box=root.document.createElement('div');box.innerHTML=renderAppendix(report,templateFn);
    const appendix=box.firstElementChild,results=root.document.getElementById('results-panel');
    if(!appendix) return;
    // Keep navigation near the summary rather than dozens of pages later, and
    // keep the main appendix before the site's footer in print order.
    const index=appendix.querySelector('#pdf-page-index'),summary=root.document.getElementById('report-method-note');
    if(index && results && summary && results.contains(summary)) summary.insertAdjacentElement('afterend',index);
    (results || root.document.body).appendChild(appendix);
  }
  function removeAppendix(){root.document?.getElementById('pdf-page-index')?.remove();root.document?.getElementById('aeogeo-page-appendix')?.remove();}
  const api={guides:GUIDES,playbook:PLAYBOOK,typeOf,renderGuide,renderKnownGuide,renderPlaybook,renderAppendix,addAppendix,removeAppendix};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.AEOGEOReportGuides=api;
})(typeof window!=='undefined'?window:globalThis);
