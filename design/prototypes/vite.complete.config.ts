import {defineConfig} from 'vite';
export default defineConfig({build:{rollupOptions:{input:{historical:'index.html',privateTechnology:'private.html',final:'final.html',complete:'complete.html'}}}});
