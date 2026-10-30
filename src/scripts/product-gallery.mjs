export function initProductGalleries(root) {
  for (const gallery of root.querySelectorAll('[data-product-gallery]')) {
    if (gallery.dataset.galleryReady) continue;
    const track = gallery.querySelector('.product-gallery-track');
    const links = [...gallery.querySelectorAll('[data-gallery-image]')];
    if (links.length < 2) continue;
    gallery.dataset.galleryReady = 'true';
    const select = () => {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      links.forEach((link, position) => {
        if (position === index) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    };
    links.forEach((link, index) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        track.scrollTo({
          left: index * track.clientWidth,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        });
      });
    });
    track.addEventListener('scroll', select, { passive: true });
    // Resizing can change the snapped slide as card columns change.
    new ResizeObserver(select).observe(track);
    select();
  }
}
