export function initializeMusicVideos(root) {
  for (const card of root.querySelectorAll('[data-music-video]')) {
    if (card.dataset.videoInitialized === 'true') continue;
    const { videoId, videoTitle } = card.dataset;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
    const screen = card.querySelector('[data-video-screen]');
    const load = card.querySelector('[data-video-load]');
    const close = card.querySelector('[data-video-close]');
    if (!screen || !load || !close) continue;
    card.dataset.videoInitialized = 'true';
    let frame;
    load.hidden = false;
    load.addEventListener('click', () => {
      if (frame) return;
      frame = card.ownerDocument.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1`;
      frame.title = `${videoTitle} — YouTube music video`;
      frame.allow = 'encrypted-media; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      screen.append(frame);
      load.hidden = true;
      close.hidden = false;
      frame.focus();
    });
    close.addEventListener('click', () => {
      frame?.remove();
      frame = undefined;
      load.hidden = false;
      close.hidden = true;
      load.focus();
    });
  }
}
