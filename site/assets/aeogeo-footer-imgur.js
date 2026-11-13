/* Sitewide footer embed for the AEOGEO Search Imgur post. */
(() => {
  'use strict';
  if (window.__aeogeoFooterImgurV1) return;
  window.__aeogeoFooterImgurV1 = true;

  const EMBED_MARKER = 'data-aeogeo-footer-imgur';
  const IMAGE_URL = 'https://i.imgur.com/ZuGr7kYl.jpg';
  const POST_URL = 'https://imgur.com/ZuGr7kY';
  let queued = false;

  function createEmbed() {
    const embed = document.createElement('div');
    embed.className = 'footer-imgur-embed';
    embed.setAttribute(EMBED_MARKER, 'v1');

    const imageLink = document.createElement('a');
    imageLink.className = 'footer-imgur-image-link';
    imageLink.href = POST_URL;
    imageLink.target = '_blank';
    imageLink.rel = 'noopener noreferrer';
    imageLink.setAttribute('aria-label', 'View this post on Imgur');

    const image = document.createElement('img');
    image.src = IMAGE_URL;
    image.alt = 'Digital network and data visualization';
    image.width = '640';
    image.height = '358';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    imageLink.appendChild(image);
    embed.appendChild(imageLink);

    const fallback = document.createElement('blockquote');
    fallback.className = 'imgur-embed-pub';
    fallback.lang = 'en';
    fallback.setAttribute('data-id', 'ZuGr7kY');
    const link = document.createElement('a');
    link.href = POST_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View post on imgur.com';
    fallback.appendChild(link);
    embed.appendChild(fallback);

    return embed;
  }

  function syncFooter() {
    queued = false;
    if (!document.body) return;
    const footer = Array.from(document.querySelectorAll('footer')).at(-1);
    if (!footer || footer.querySelector('[' + EMBED_MARKER + '="v1"]')) return;

    const embed = createEmbed();
    const legal = footer.querySelector('.geo-legal-links');
    if (legal && legal.parentElement) legal.insertAdjacentElement('afterend', embed);
    else footer.appendChild(embed);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    if (window.requestAnimationFrame) window.requestAnimationFrame(syncFooter);
    else window.setTimeout(syncFooter, 16);
  }

  function start() {
    syncFooter();
    new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true});
  }

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, {once: true});
})();
