import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
  trailingSlash: 'always',
  server: { allowedHosts: ['terminal.local'] },
  build: { inlineStylesheets: 'never' },
  vite: {
    build: { assetsInlineLimit: 0 },
    server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  },
});
