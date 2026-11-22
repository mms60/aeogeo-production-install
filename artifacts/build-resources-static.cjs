const fs = require('fs');
const path = require('path');
const data = require('./resources-content.json');

const esc = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const stats = [
  { num: '1.2B', lbl: 'people use ChatGPT every week', src: 'OpenAI, Oct 5, 2026' },
  { num: '2.5B', lbl: 'monthly users of Google AI Overviews', src: 'Google I/O, 2026' },
  { num: '68%', lbl: 'of US Google searches end with no click', src: 'SparkToro, 2026' },
  { num: '+40%', lbl: 'max visibility lift from GEO methods', src: 'Aggarwal et al. (2024), GEO: Generative Engine Optimization, ACM KDD 2024' }
];

const hero = `<section class="pt-36 pb-10 text-center">
  <div style="opacity:1;transform:none">
    <span class="inline-block rounded-full border border-royal-500/20 bg-royal-500/10 px-4 py-1.5 font-display text-[0.78rem] font-semibold uppercase tracking-[0.14em] text-royal-400">${esc(data.meta.eyebrow)}</span>
    <h1 class="mx-auto mt-5 max-w-3xl font-display text-4xl font-extrabold leading-[1.12] tracking-tight text-white sm:text-5xl">AI Search Optimization <span class="text-gradient">Resources</span></h1>
    <div class="mt-9 grid grid-cols-2 gap-3.5 md:grid-cols-4">
      ${stats.map(stat => `<div style="opacity:1;transform:none"><div class="glass h-full rounded-2xl px-4 py-5 text-center"><div class="font-display text-2xl font-extrabold tracking-tight text-royal-400">${esc(stat.num)}</div><div class="mt-1.5 text-xs leading-snug text-ice-300/75">${esc(stat.lbl)}</div><div class="mt-2 text-[0.68rem] text-ice-300/40">${esc(stat.src)}</div></div></div>`).join('')}
    </div>
    ${data.meta.intro.map(paragraph => `<p class="mx-auto mt-5 max-w-3xl text-lg text-ice-300/80">${esc(paragraph)}</p>`).join('')}
  </div>
</section>`;

const sections = data.sections.map(section => `<section id="${esc(section.id)}" class="pt-12" style="scroll-margin-top:6rem">
  <div style="opacity:1;transform:none">
    <h2 class="font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">${esc(section.title)}</h2>
    <p class="mt-3 max-w-3xl text-base leading-relaxed text-ice-300/80">${esc(section.desc)}</p>
  </div>
  <div class="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    ${section.cards.map(card => `<a href=${esc(card.href)} class="group glass flex h-full flex-col rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-royal-400/50 hover:shadow-2xl hover:shadow-royal-600/20"><span class="inline-flex w-fit items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 font-display text-[0.62rem] font-bold uppercase tracking-[0.12em] text-emerald-300">Guide</span><h3 class="mt-4 font-display text-lg font-bold leading-snug tracking-tight text-white">${esc(card.title)}</h3><p class="mt-3 flex-1 text-sm leading-relaxed text-ice-300/70">${esc(card.desc)}</p><span class="mt-5 inline-flex text-sm font-semibold text-royal-400 group-hover:text-royal-300">${esc(card.cta)}</span></a>`).join('')}
  </div>
</section>`).join('');

const cta = `<div style="opacity:1;transform:none"><section class="my-14 rounded-3xl border border-royal-500/15 px-8 py-11 text-center" style="background:linear-gradient(120deg,rgba(43,79,192,.35),rgba(13,27,66,.6))">
  <h2 class="mx-auto max-w-2xl font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">${esc(data.cta.heading)}</h2>
  ${data.cta.paragraphs.map(paragraph => `<p class="mx-auto mt-4 max-w-2xl text-ice-300/80">${esc(paragraph)}</p>`).join('')}
  <h3 class="mx-auto mt-7 max-w-xl font-display text-xl font-bold text-white">${esc(data.cta.subheading)}</h3>
  <p class="mx-auto mt-2 max-w-xl text-ice-300/80">${esc(data.cta.subtext)}</p>
  <a href=/contact class="btn-primary mt-7 inline-flex items-center justify-center rounded-xl bg-royal-500 px-7 py-3.5 font-display text-sm font-semibold text-white shadow-xl shadow-royal-600/40 transition-all duration-300 hover:bg-royal-400">${esc(data.cta.button)}</a>
</section></div>`;

const faq = `<div style="opacity:1;transform:none"><section class="my-8 pb-4">
  <h2 class="text-center font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Frequently asked questions</h2>
  <div class="mt-7 grid gap-4 md:grid-cols-2">
    ${data.faqs.map(item => `<article class="glass rounded-2xl p-6"><h3 class="font-display text-base font-bold leading-snug text-white">${esc(item.question)}</h3><p class="mt-3 text-sm leading-relaxed text-ice-300/75">${esc(item.answer)}</p></article>`).join('')}
  </div>
</section></div>`;

const learn = `<p class="mb-16 text-center text-sm text-ice-300/70">${esc(data.learn.lead)} <a href=${esc(data.learn.href)} class="font-semibold text-royal-400 underline decoration-royal-400/40 underline-offset-2 hover:text-royal-300">${esc(data.learn.link)}</a> ${esc(data.learn.trail)}</p>`;

const breadcrumb = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://aeogeosearch.com/' },
    { '@type': 'ListItem', position: 2, name: 'Resources', item: 'https://aeogeosearch.com/resources' }
  ]
};
const cards = data.sections.flatMap(section => section.cards);
const collection = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  '@id': 'https://aeogeosearch.com/resources',
  name: 'AI Search Optimization Resources',
  description: data.meta.description,
  url: 'https://aeogeosearch.com/resources',
  dateModified: '2026-11-19',
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: cards.length,
    itemListElement: cards.map((card, index) => ({ '@type': 'ListItem', position: index + 1, name: card.title }))
  }
};
const faqLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: data.faqs.map(item => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer }
  }))
};

const inner = `<div class="relative bg-navy-950" data-aeogeo-resources-hub=true><div class="pointer-events-none absolute inset-0" aria-hidden=true style="background:radial-gradient(900px 500px at 85% -5%,rgba(79,125,249,.16),transparent 60%),radial-gradient(700px 420px at 0 8%,rgba(43,79,192,.14),transparent 60%)"></div><div class="relative mx-auto max-w-6xl px-5 sm:px-8">${hero}${sections}${cta}${faq}${learn}</div><script type=application/ld+json>${JSON.stringify(breadcrumb)}</script><script type=application/ld+json>${JSON.stringify(collection)}</script><script type=application/ld+json>${JSON.stringify(faqLd)}</script></div>`;

const pagePath = path.join(process.cwd(), 'site/resources.html');
let html = fs.readFileSync(pagePath, 'utf8');
const oldTitle = 'AI Search Resources: GEO, AEO, AIO & SEO Guides | AEOGEO Search';
const oldDescription = 'Data-backed guides to AI search optimization: GEO, AEO, AIO, SEO and AEOM. Get your business cited in ChatGPT, Perplexity and Google AI Overviews.';
const escapeAmp = value => String(value).replace(/&/g, '&amp;');
html = html.split(oldTitle).join(data.meta.title);
html = html.split(escapeAmp(oldTitle)).join(escapeAmp(data.meta.title));
html = html.split(oldDescription).join(data.meta.description);
html = html.replace(/Content updated: <time datetime=[^>]+>[^<]+<\/time>/, 'Content updated: <time datetime=2026-11-19>November 19, 2026</time>');

const mainStart = html.indexOf('<main class=flex-1>');
const mainEnd = html.indexOf('</main>', mainStart);
if (mainStart < 0 || mainEnd < 0) throw new Error('Could not locate resources main element');
html = html.slice(0, mainStart) + `<main class=flex-1>${inner}</main>` + html.slice(mainEnd + '</main>'.length);
fs.writeFileSync(pagePath, html);
console.log('Updated site/resources.html');
