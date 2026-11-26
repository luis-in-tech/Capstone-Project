import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  let supabaseOrigin: string | null = null;
  try {
    if (env.VITE_SUPABASE_URL) {
      const parsed = new URL(env.VITE_SUPABASE_URL.trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        supabaseOrigin = parsed.origin;
      }
    }
  } catch {
    supabaseOrigin = null;
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(supabaseOrigin
        ? [
            {
              name: 'supabase-preconnect',
              transformIndexHtml(html: string) {
                return html.replace(
                  '<title>',
                  `<link rel="preconnect" href="${supabaseOrigin}" crossorigin />\n    <title>`,
                );
              },
            },
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replaceAll('\\', '/');
            if (!normalized.includes('/node_modules/')) return undefined;
            if (
              normalized.includes('/node_modules/react/') ||
              normalized.includes('/node_modules/react-dom/') ||
              normalized.includes('/node_modules/react-router-dom/') ||
              normalized.includes('/node_modules/scheduler/')
            ) {
              return 'react-vendor';
            }
            if (normalized.includes('/node_modules/@supabase/')) {
              return 'supabase-vendor';
            }
            if (normalized.includes('/node_modules/xlsx/')) {
              return 'xlsx';
            }
            if (
              normalized.includes('/node_modules/recharts/') ||
              normalized.includes('/node_modules/d3-') ||
              normalized.includes('/node_modules/victory-vendor/')
            ) {
              return 'charts-vendor';
            }
            if (
              normalized.includes('/node_modules/motion/') ||
              normalized.includes('/node_modules/framer-motion/')
            ) {
              return 'motion-vendor';
            }
            if (normalized.includes('/node_modules/date-fns/')) {
              return 'date-vendor';
            }
            if (
              normalized.includes('/node_modules/@base-ui/') ||
              normalized.includes('/node_modules/sonner/') ||
              normalized.includes('/node_modules/react-day-picker/') ||
              normalized.includes('/node_modules/class-variance-authority/') ||
              normalized.includes('/node_modules/clsx/') ||
              normalized.includes('/node_modules/tailwind-merge/')
            ) {
              return 'ui-vendor';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'unsafe-none',
        'Cross-Origin-Embedder-Policy': 'unsafe-none'
      }
    },
  };
});
