const fs = require('fs');
const path = require('path');
const data = require('./resources-content.json');

const appPath = path.join(process.cwd(), 'site/assets/app.js');
let source = fs.readFileSync(appPath, 'utf8');

function replaceBetween(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start marker for ${label}: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Missing end marker for ${label}: ${endMarker}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

// Replace the public metadata for /resources.
{
  const start = source.indexOf('"/resources":{');
  if (start < 0) throw new Error('Missing /resources metadata');
  const end = source.indexOf('"/learn":{', start);
  if (end < 0) throw new Error('Missing end of /resources metadata');
  const metadata = {
    title: data.meta.title,
    description: data.meta.description,
    editMetadata: false,
    schema: null
  };
  source = source.slice(0, start) + '"/resources":' + JSON.stringify(metadata) + ',' + source.slice(end);
}

const hubLiteral = `const aeogeoResourceHub=${JSON.stringify(data)};`;
const component = `${hubLiteral}
function CT(){
  const resourceLocation=Aa();
  j.useEffect(()=>{
    if(!resourceLocation.hash)return;
    let id;
    try{id=decodeURIComponent(resourceLocation.hash.slice(1));}catch{return;}
    if(Co.some(a=>a.anchor===id))window.location.replace("/resources/"+id+"/");
  },[resourceLocation.hash]);
  const hub=aeogeoResourceHub;
  const resourceItems=hub.sections.flatMap(section=>section.cards);
  const collectionLd={"@context":"https://schema.org","@type":"CollectionPage","@id":"https://aeogeosearch.com/resources",name:"AI Search Optimization Resources",description:hub.meta.description,url:"https://aeogeosearch.com/resources",dateModified:GEO_CONTENT_DATES["/resources"],mainEntity:{"@type":"ItemList",numberOfItems:resourceItems.length,itemListElement:resourceItems.map((card,index)=>({"@type":"ListItem",position:index+1,name:card.title}))}};
  const faqLd={"@context":"https://schema.org","@type":"FAQPage",mainEntity:hub.faqs.map(faq=>({"@type":"Question",name:faq.question,acceptedAnswer:{"@type":"Answer",text:faq.answer}}))};
  return r.jsxs("div",{className:"relative bg-navy-950",children:[
    r.jsx(Xt,{title:hub.meta.title,description:hub.meta.description,path:"/resources"}),
    r.jsx("div",{className:"pointer-events-none absolute inset-0","aria-hidden":!0,style:{background:"radial-gradient(900px 500px at 85% -5%, rgba(79,125,249,.16), transparent 60%), radial-gradient(700px 420px at 0% 8%, rgba(43,79,192,.14), transparent 60%)"}}),
    r.jsxs("div",{className:"relative mx-auto max-w-6xl px-5 sm:px-8",children:[
      r.jsxs("section",{className:"pt-36 pb-10 text-center",children:[
        r.jsxs(K,{children:[
          r.jsx("span",{className:"inline-block rounded-full border border-royal-500/20 bg-royal-500/10 px-4 py-1.5 font-display text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-royal-400",children:hub.meta.eyebrow}),
          r.jsxs("h1",{className:"mx-auto mt-5 max-w-3xl font-display text-4xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-5xl",children:["AI Search Optimization ",r.jsx("span",{className:"text-gradient",children:"Resources"})]}),
          hub.meta.intro.map((paragraph,index)=>r.jsx("p",{className:"mx-auto mt-5 max-w-3xl text-lg text-ice-300/80",children:paragraph},index))
        ]}),
        r.jsx("div",{className:"mt-9 grid grid-cols-2 gap-3.5 md:grid-cols-4",children:wT.map((stat,index)=>r.jsx(K,{delay:index*.08,children:r.jsxs("div",{className:"glass h-full rounded-2xl px-4 py-5 text-center",children:[
          r.jsx("div",{className:"font-display text-2xl font-extrabold tracking-tight text-royal-400",children:stat.num}),
          r.jsx("div",{className:"mt-1.5 text-xs leading-snug text-ice-300/75",children:stat.lbl}),
          r.jsx("div",{className:"mt-2 text-[0.68rem] text-ice-300/40",children:stat.src})
        ]})},stat.lbl))})
      ]}),
      hub.sections.map(section=>r.jsxs("section",{id:section.id,className:"pt-12",style:{scrollMarginTop:"6rem"},children:[
        r.jsxs(K,{children:[
          r.jsx("h2",{className:"font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl",children:section.title}),
          r.jsx("p",{className:"mt-3 max-w-3xl text-base leading-relaxed text-ice-300/80",children:section.desc})
        ]}),
        r.jsx("div",{className:"mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3",children:section.cards.map(card=>r.jsxs("a",{href:card.href,className:"group glass flex h-full flex-col rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-royal-400/50 hover:shadow-2xl hover:shadow-royal-600/20",children:[
          r.jsx("span",{className:"inline-flex w-fit items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 font-display text-[0.62rem] font-bold uppercase tracking-[0.12em] text-emerald-300",children:"Guide"}),
          r.jsx("h3",{className:"mt-4 font-display text-lg font-bold leading-snug tracking-tight text-white",children:card.title}),
          r.jsx("p",{className:"mt-3 flex-1 text-sm leading-relaxed text-ice-300/70",children:card.desc}),
          r.jsx("span",{className:"mt-5 inline-flex text-sm font-semibold text-royal-400 group-hover:text-royal-300",children:card.cta})
        ]},card.title))})
      ]},section.id)),
      r.jsx(K,{children:r.jsxs("section",{className:"my-14 rounded-3xl border border-royal-500/15 px-8 py-11 text-center",style:{background:"linear-gradient(120deg, rgba(43,79,192,.35), rgba(13,27,66,.6))"},children:[
        r.jsx("h2",{className:"mx-auto max-w-2xl font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl",children:hub.cta.heading}),
        hub.cta.paragraphs.map((paragraph,index)=>r.jsx("p",{className:"mx-auto mt-4 max-w-2xl text-ice-300/80",children:paragraph},index)),
        r.jsx("h3",{className:"mx-auto mt-7 max-w-xl font-display text-xl font-bold text-white",children:hub.cta.subheading}),
        r.jsx("p",{className:"mx-auto mt-2 max-w-xl text-ice-300/80",children:hub.cta.subtext}),
        r.jsx(we,{to:"/contact",className:"btn-primary mt-7 inline-flex items-center justify-center rounded-xl bg-royal-500 px-7 py-3.5 font-display text-sm font-semibold text-white shadow-xl shadow-royal-600/40 transition-all duration-300 hover:bg-royal-400",children:hub.cta.button})
      ]})}),
      r.jsx(K,{children:r.jsxs("section",{className:"my-8 pb-4",children:[
        r.jsx("h2",{className:"text-center font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl",children:"Frequently asked questions"}),
        r.jsx("div",{className:"mt-7 grid gap-4 md:grid-cols-2",children:hub.faqs.map(faq=>r.jsxs("article",{className:"glass rounded-2xl p-6",children:[
          r.jsx("h3",{className:"font-display text-base font-bold leading-snug text-white",children:faq.question}),
          r.jsx("p",{className:"mt-3 text-sm leading-relaxed text-ice-300/75",children:faq.answer})
        ]},faq.question))})
      ]})}),
      r.jsxs("p",{className:"mb-16 text-center text-sm text-ice-300/70",children:[
        hub.learn.lead,
        " ",
        r.jsx(we,{to:hub.learn.href,className:"font-semibold text-royal-400 underline decoration-royal-400/40 underline-offset-2 hover:text-royal-300",children:hub.learn.link}),
        " ",
        hub.learn.trail
      ]})
    ]}),
    r.jsx("script",{type:"application/ld+json",dangerouslySetInnerHTML:{__html:JSON.stringify(AT)}}),
    r.jsx("script",{type:"application/ld+json",dangerouslySetInnerHTML:{__html:JSON.stringify(collectionLd)}}),
    r.jsx("script",{type:"application/ld+json",dangerouslySetInnerHTML:{__html:JSON.stringify(faqLd)}})
  ]});
}
`;

replaceBetween('function CT(){', 'const OT=', component, 'Resources component');
fs.writeFileSync(appPath, source);
console.log('Updated site/assets/app.js');
