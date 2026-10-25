# Optional game audio

Music is part of the existing bouncer deployment, not a separate stack. The only deployment configuration is [`deploy/bouncer/docker-compose.yml`](../deploy/bouncer/docker-compose.yml). Use the [guided setup command](../deploy/bouncer/README.md#guided-setup) and [canonical activation and update guide](../deploy/bouncer/README.md#optional-game-audio); do not install another Compose file or Nginx overlay. `Dockerfile.game-audio` builds the serving and one-shot packaging targets for that same release pipeline.

The feature is off by default. Once explicitly configured, the normal bouncer updater discovers supported files in `~/bouncer/gyaruinthemix/assets/music`, prepares cached segments serially in a bounded one-shot Docker container, and updates the audio image alongside the web image. The sidecar reads the source-library mount read-only and serves only validated `.hls` output. The packager has read-only originals and writable generated output only, with no network or signing key. Host Node/FFmpeg are not required. Nginx never mounts originals. Source media, segments and signing keys are excluded from Git and all images.

The radio displays the title tag from each file’s metadata, never its filename. Files without a nonblank title tag are skipped and are not packaged or listed. Only the title is retained as descriptive metadata in the stream; other editable tags are removed. Original files are not modified, and filenames and paths stay private. Required codec/container fields remain. The first library refresh with this version rebuilds older cached audio once; subsequent refreshes reuse unchanged packages.

A separate server-only signing key is required. No persistent key is bundled. When explicitly confirmed by the operator, the local guided setup can create a missing key outside Git; it reuses an existing valid key without replacing it. Browser sessions and manifests expire and active sessions renew. Original files have no public route. This limits casual downloading, not recording or reconstruction: it is not DRM or private-user authentication.

The game discovers enabled audio through its same-origin configuration endpoint. Missing or disabled audio never blocks gameplay. Native HLS is preferred; other supported browsers lazy-load the locally bundled, version-pinned hls.js light module. The player requires explicit tap-start and supports pause/resume, background playback, playlist, volume, mute, seeking and error recovery.

Retain the existing third-party licence notices and `public/game/src/vendor/HLS-LICENSE.txt`.

Switching to another browser tab does not pause the radio. Returning refreshes its playback session if needed, without overriding a manual pause. Closing or navigating away from the game page ends playback; browsers and operating systems may still suspend background media.
