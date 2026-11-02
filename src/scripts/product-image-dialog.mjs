export function initProductImageDialogs(root) {
  for (const gallery of root.querySelectorAll('[data-product-gallery]')) {
    const dialog = gallery.querySelector('[data-product-image-dialog]');
    if (!dialog || typeof dialog.showModal !== 'function') continue;
    if (dialog.dataset.ready) continue;
    dialog.dataset.ready = 'true';
    const full = dialog.querySelector('[data-product-image-full]');
    const caption = dialog.querySelector('[data-product-image-caption]');
    const close = dialog.querySelector('[data-product-image-close]');
    const previous = dialog.querySelector('[data-product-image-prev]');
    const next = dialog.querySelector('[data-product-image-next]');
    const position = dialog.querySelector('[data-product-image-position]');
    const track = gallery.querySelector('.product-gallery-track');
    const links = [...gallery.querySelectorAll('[data-product-enlarge]')];
    let currentIndex = 0;
    let opener;
    let pointerStart;
    const showImage = (index) => {
      currentIndex = (index + links.length) % links.length;
      const link = links[currentIndex];
      const preview = link.closest('figure').querySelector('img');
      full.src = link.href;
      full.alt = preview.alt;
      caption.textContent = link.dataset.caption || '';
      position.textContent = link.dataset.position;
    };
    const move = (delta) => {
      if (dialog.open && links.length > 1) showImage(currentIndex + delta);
    };
    previous.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    links.forEach((link, index) => {
      link.addEventListener('pointerdown', (event) => {
        pointerStart = {
          x: event.clientX,
          y: event.clientY,
          scroll: track.scrollLeft,
        };
      });
      link.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
          return;
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
        showImage(index);
        opener = link;
        dialog.showModal();
        close.focus({ preventScroll: true });
      });
    });
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', (event) => {
      if (!dialog.open || event.ctrlKey || event.metaKey || event.altKey)
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const controls = [close, previous, next].filter(
          (control) => !control.hidden && !control.disabled,
        );
        const index = controls.indexOf(root.activeElement);
        const step = event.shiftKey ? -1 : 1;
        controls[(index + step + controls.length) % controls.length].focus({
          preventScroll: true,
        });
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
