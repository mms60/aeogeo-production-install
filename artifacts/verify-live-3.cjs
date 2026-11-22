(async () => {
  const html = await (await fetch('https://aeogeosearch.com/quiz/?cb=' + Date.now(), { headers: { 'cache-control': 'no-cache' } })).text();
  const at = s => html.indexOf(s);
  const marks = {
    'H1 headline': 'How Much of Your Website',
    'Before You Pay section': 'Before You Pay',
    'URL form': 'id=content-analysis-form',
    'URL input': 'id=website-url',
    'type=url': 'type=url',
    'quiz screen': 'id=screen-quiz',
    'article': 'waste-article" aria-labelledby',
    'CTA Analyze My Website': 'Analyze My Website',
    'CTA Find My Content Opportunities': 'Find My Content Opportunities'
  };
  const pos = {};
  for (const [k, v] of Object.entries(marks)) pos[k] = at(v);
  Object.entries(pos).forEach(([k, v]) => console.log((v > -1 ? 'OK   ' : 'MISS ') + k + ' @' + v));
  const seq = ['H1 headline', 'Before You Pay section', 'URL form', 'quiz screen', 'article'];
  const ordered = seq.every((k, i) => pos[k] > -1 && (i === 0 || pos[k] > pos[seq[i - 1]]));
  console.log('order (' + seq.join(' -> ') + '): ' + ordered);
  console.log('old start panel removed: ' + !html.includes('screen-start'));
  console.log('all checks pass: ' + (ordered && Object.values(pos).every(v => v > -1)));
})();
