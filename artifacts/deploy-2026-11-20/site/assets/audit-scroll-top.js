/* All pages: independent, accessible scroll-to-top control. */
(function () {
  'use strict';
  var id = 'geo-scroll-to-top';
  if (document.getElementById(id)) return;
  var styles = document.createElement('style');
  styles.id = 'geo-scroll-to-top-styles';
  styles.textContent = '#geo-scroll-to-top{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:90;display:none;place-items:center;box-sizing:border-box;width:48px;height:48px;min-width:48px;min-height:48px;padding:0;border:1px solid rgba(79,125,249,.4);border-radius:50%;background:#2b4fc0;color:#fff;box-shadow:0 16px 32px rgba(43,79,192,.4);cursor:pointer;transition:background-color .2s,transform .2s}#geo-scroll-to-top:hover{background:#4f7df9;transform:translateY(-3px)}#geo-scroll-to-top:focus-visible{outline:3px solid #a8c5ff;outline-offset:4px}#geo-scroll-to-top svg{display:block;pointer-events:none}@media(prefers-reduced-motion:reduce){#geo-scroll-to-top{transition:none}}@media print{#geo-scroll-to-top{display:none!important}}';
  document.head.appendChild(styles);
  var button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.hidden = true;
  button.setAttribute('aria-label', 'Scroll back to top');
  button.title = 'Back to top';
  button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12 7-7 7 7"></path><path d="M12 19V5"></path></svg>';
  document.body.appendChild(button);
  var frame = null;
  function update() {
    frame = null;
    var drawer = document.getElementById('page-drawer');
    var show = window.scrollY > 400 && (!drawer || drawer.hidden);
    button.hidden = !show;
    button.style.display = show ? 'grid' : 'none';
  }
  function schedule() {
    if (frame === null) frame = window.requestAnimationFrame(update);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  var drawer = document.getElementById('page-drawer');
  if (drawer) new MutationObserver(schedule).observe(drawer, { attributes: true, attributeFilter: ['hidden'] });
  button.addEventListener('click', function () {
    var heading = document.querySelector('main h1');
    if (heading) {
      var addedTabindex = !heading.hasAttribute('tabindex');
      if (addedTabindex) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      if (addedTabindex) heading.addEventListener('blur', function () { heading.removeAttribute('tabindex'); }, { once: true });
    }
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' });
  });
  update();
}());
