import { defineConfig } from 'astro/config';
import { siteOrigin } from './src/data/urls.mjs';

export default defineConfig({
  site: siteOrigin,
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
