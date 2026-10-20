# Primary references checked 2026-10-20

- HLS.js official README and releases: https://github.com/video-dev/hls.js/ and https://github.com/video-dev/hls.js/releases/tag/v1.7.3 . Version 1.7.3 pinned with npm integrity lock; light build supports the single audio fMP4 stream and omits alternate-audio/subtitle/DRM overhead. Local minified module is approximately 363 KiB uncompressed; lazy-loaded only in non-native browsers after a play request.
- Apple HLS authoring specification: https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/ . Audio may be elementary streams or fragmented MP4; native HLS is preferred when available.
- Apple deployment overview: https://developer.apple.com/documentation/http-live-streaming/deploying-a-basic-http-live-streaming-hls-stream . HLS can be VOD and uses a manifest and media fragments.
- FFmpeg HLS muxer: https://ffmpeg.org/ffmpeg-formats.html#hls-2 . Single continuous AAC encoding is packaged as HLS fMP4 with target 4-second chunks, not separately encoded MP3 snippets. That preserves continuous timestamps at chunk boundaries.
- Docker Compose secrets reference: https://docs.docker.com/reference/compose-file/services/#secrets . Local file-backed secrets do not honor UID/GID/mode remapping.
- Docker Compose interpolation: https://docs.docker.com/reference/compose-file/interpolation/ . Optional-profile interpolation needs safe non-secret defaults or a separate optional file.
