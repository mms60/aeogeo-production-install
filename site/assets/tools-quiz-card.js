(() => {
  // The tools route is server-rendered and then hydrated by the React bundle,
  // which removes DOM nodes that are not part of the route component. Keep the
  // quiz card in the static HTML for no-JS, then restore it after hydration.
  if (location.pathname !== '/tools' && location.pathname !== '/tools/') return;

  const CARD_ID = 'content-waste-quiz-title';
  const CARD_HTML = `<section class="mt-10" data-aeogeo-tools-quiz-card="v1" aria-labelledby="content-waste-quiz-title"><a href="/quiz/" class="group flex flex-col gap-6 rounded-3xl border border-royal-400/30 bg-gradient-to-br from-royal-500/25 to-navy-950 p-6 shadow-2xl transition-colors sm:p-8 sm:flex-row sm:items-center justify-between" data-discover="true"><div class="flex min-w-0 items-start gap-4"><span class="grid size-12 shrink-0 place-items-center rounded-2xl bg-royal-500/15 text-royal-400 ring-1 ring-royal-400/25"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-6" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"></path><path d="M20 2v4"></path><path d="M22 4h-4"></path><circle cx="4" cy="20" r="2"></circle></svg></span><div class="min-w-0"><p class="font-display text-[11px] font-bold uppercase tracking-widest text-royal-400">Free 2-minute quiz</p><h2 id="content-waste-quiz-title" class="mt-2 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">How Much Content Are You Wasting?</h2><p class="mt-2 max-w-2xl text-sm leading-relaxed text-ice-300/70 sm:text-base">Take the Content Waste Quiz to see how many of your published pages are silently leaking revenue — and where to start turning one asset into many.</p></div></div><span class="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-royal-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-royal-600/30 transition-colors hover:bg-royal-400">Take the quiz<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></span></a></section>`;

  function insertQuizCard() {
    if (document.getElementById(CARD_ID)) return;
    const main = document.querySelector('main');
    if (!main) return;
    const guideHeading = [...main.querySelectorAll('h2')]
      .find((heading) => heading.textContent.trim() === 'Robots.txt, without the guesswork');
    const guideSection = guideHeading && guideHeading.closest('section');
    const holder = document.createElement('div');
    holder.innerHTML = CARD_HTML.trim();
    const card = holder.firstElementChild;
    if (!card) return;

    // The guide heading is nested inside layout wrappers. Walk up to the
    // direct child of main so insertBefore gets a valid reference node.
    let anchor = guideSection;
    while (anchor && anchor.parentElement !== main) anchor = anchor.parentElement;
    if (anchor) main.insertBefore(card, anchor);
    else main.appendChild(card);
  }

  insertQuizCard();
  const observer = new MutationObserver(insertQuizCard);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', insertQuizCard, { once: true });
})();
