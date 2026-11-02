export function initProductImageDialogs(root) {
  for (const gallery of root.querySelectorAll('[data-product-gallery]')) {
    const dialog = gallery.querySelector('[data-product-image-dialog]');
    if (!dialog || typeof dialog.showModal !== 'function') continue;
    if (dialog.dataset.ready) continue;
    dialog.dataset.ready = 'true';
    const full = dialog.querySelector('[data-product-image-full]');
    const caption = dialog.querySelector('[data-product-image-caption]');
    const close = dialog.querySelector('[data-product-image-close]');
    const track = gallery.querySelector('.product-gallery-track');
    let opener;
    let pointerStart;
    for (const link of gallery.querySelectorAll('[data-product-enlarge]')) {
      link.addEventListener('pointerdown', (event) => {
        pointerStart = {
          x: event.clientX,
          y: event.clientY,
          scroll: track.scrollLeft,
        };
      });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const start = pointerStart;
        pointerStart = undefined;
        // A horizontal swipe or vertical page scroll must not also open a photo.
        if (
          event.detail !== 0 &&
          start &&
          (Math.abs(event.clientX - start.x) > 10 ||
            Math.abs(event.clientY - start.y) > 10 ||
            Math.abs(track.scrollLeft - start.scroll) > 10)
        )
          return;
        if (dialog.open) return;
        const preview = link.closest('figure').querySelector('img');
        full.src = link.href;
        full.alt = preview.alt;
        caption.textContent = link.dataset.caption;
        opener = link;
        dialog.showModal();
        close.focus({ preventScroll: true });
      });
    }
    close.addEventListener('click', () => dialog.close());
    // The close button is the viewer's only interactive control.
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        close.focus({ preventScroll: true });
      }
    });
    const outside = (event) => {
      const box = dialog.getBoundingClientRect();
      return (
        event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
      );
    };
    let backdropStart = false;
    dialog.addEventListener('pointerdown', (event) => {
      backdropStart = event.target === dialog && outside(event);
    });
    dialog.addEventListener('click', (event) => {
      if (backdropStart && event.target === dialog && outside(event))
        dialog.close();
      backdropStart = false;
    });
    // Escape uses the native dialog cancel behavior.
    dialog.addEventListener('close', () => {
      backdropStart = false;
      opener?.focus({ preventScroll: true });
    });
  }
}
