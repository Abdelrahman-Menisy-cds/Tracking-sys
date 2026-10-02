import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The SPA now talks to Django. Proxying /api in dev means no CORS work at all:
    // the browser only ever sees this origin, and Django's session + CSRF cookies
    // work as first-party. (DJANGO_CSRF_TRUSTED_ORIGINS already lists :5173.)
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: false,
      },
    },
  },
  preview: {
    // Vite blocks requests whose Host header it does not recognise (DNS-rebinding
    // protection), which makes the preview server return 403 behind a tunnel.
    // The leading dot matches any subdomain, so ngrok's random free-tier hostname
    // works without editing this file on every restart.
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io', '.trycloudflare.com', 'localhost'],
  },
})
