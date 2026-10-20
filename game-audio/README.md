# Optional game audio

This implementation is disabled by default. No media, packaged chunks or signing keys belong in Git or images. Source files live in the ignored assets/music directory. Run the offline packager after adding supported files; the sidecar serves only validated .hls output.

The optional Compose file is installed relative to the existing bouncer project. Verify actual host paths before activation. The media mount is read-only and restricted to the audio sidecar; Nginx never mounts originals. The existing updater does not install Compose changes or update this sidecar. Never enable checkout services as part of audio activation.

A separate server-only signing key and approved deployment are required. No persistent key is included or generated. Cookies and manifests expire; active sessions renew. Original files are not routed. This is download friction, not DRM or private-user authentication: authorized playback can be captured or reconstructed.

Native HLS is preferred; other supported browsers lazy-load the local version-pinned hls.js light module. One audio element is preserved across scenes. Explicit tap-start, pause/resume, visibility pause, playlist, volume, mute, seeking and error recovery are implemented. Missing media never blocks gameplay.

Tests: run node --test tests/audio-streaming.test.mjs from the website root. FFmpeg/FFprobe are required for synthetic packaging tests. Actual Docker, browser audio playback and real-device Safari/Android acceptance remain pending and must be completed before activation.

Retain the existing third-party licence notices and public/game-test/src/vendor/HLS-LICENSE.txt.
