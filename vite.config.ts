import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Note: GEMINI_API_KEY is read server-side only, directly from process.env in
// server.ts (see getGeminiClient()) for the Quill AI feature. It is never
// referenced by client-side code (src/**), so it does not need to be
// injected into the client bundle here. An earlier version of this file
// defined 'process.env.GEMINI_API_KEY' for the client via loadEnv(); that
// was dead configuration and has been removed -- the Quill feature itself
// is untouched.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    // PERF: without this, React, Framer Motion, every lucide icon, the QR
    // renderer and the confetti library are bundled into the same single
    // chunk as the app itself. That one file has to be downloaded and
    // parsed before anything appears, and any change to app code
    // invalidates the whole thing for returning readers. Split out, the
    // vendor halves are cached across deploys and the browser fetches
    // them in parallel with the app chunk.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-motion': ['motion/react'],
          'vendor-ui': ['lucide-react', 'qrcode.react', 'canvas-confetti'],
        },
      },
    },
    // The app is large enough that the default 500KB warning fires on
    // every build and stopped carrying information.
    chunkSizeWarningLimit: 1200,
    // Nothing reads the production source maps and they are a large,
    // slow part of the build output.
    sourcemap: false,
  },
  server: {
    // Lets a DISABLE_HMR=true env var turn off the HMR overlay for
    // environments where live file-watching causes flicker.
    hmr: process.env.DISABLE_HMR !== 'true' ? true : {
      overlay: false,
    },
  },
});
