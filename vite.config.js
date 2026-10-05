import {defineConfig} from 'vite';
export default defineConfig({server:{proxy:{'/api/security':'http://127.0.0.1:4174'}},build:{chunkSizeWarningLimit:1800,rollupOptions:{output:{manualChunks(id){if(id.includes('pdfjs-dist'))return 'pdf-viewer';if(id.includes('pdf-lib'))return 'pdf-engine';if(id.includes('lucide'))return 'icons';}}}}});
