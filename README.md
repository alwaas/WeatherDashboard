# WeatherDashboard

Free weather dashboard built with React, Vite, TailwindCSS, Express, and Open-Meteo.

## Features

- Free Open-Meteo weather API (no API key required)
- Open-Meteo Geocoding search for cities, districts, states, and countries
- Browser GPS detection for "Your Location"
- Refresh current location with one click
- Favorites saved in `localStorage`
- Recent searches stored in `localStorage`
- Interactive Leaflet map with OpenStreetMap tiles
- Click anywhere on the map to load weather for that point
- Compare multiple cities with temperature, humidity, and wind
- Recharts hourly forecast visualization
- Express backend service with caching and health metrics
- Built-in health loop: reflect, analyze, learn, fix
- Free hosting-friendly stack for Cloudflare Pages / GitHub Pages / Vercel

## Getting Started

Install dependencies:

```bash
npm install
```

Run the app locally:

```bash
npm run dev
```

Open http://localhost:5173

## Deployment

This project can be deployed to Vercel.

1. Install the Vercel CLI globally or use `npx vercel`.
2. Run:

```bash
npx vercel
```

3. When prompted, select the project folder and confirm the defaults.

The `vercel.json` config includes:

- `api/` serverless routes for weather and health endpoints
- static build output from `dist`
- redirect rules for SPA routing

## Backend API

- `GET /api/weather?lat=<latitude>&lon=<longitude>`
- `GET /api/health`

## Project Structure

- `src/` — React application
- `server/` — Express backend
- `data/` — persisted JSON metrics and weather history

## Free Stack

- Frontend: React + Vite + TailwindCSS
- Weather: Open-Meteo (no key)
- Geocoding: Open-Meteo Geocoding API
- Maps: Leaflet + OpenStreetMap
- Storage: Browser `localStorage`
- Charts: Recharts
- Monitoring: built-in metrics, health score

## Notes

- The backend caches Open-Meteo responses and adapts TTL based on latency.
- The health score adjusts for latency, API errors, and memory usage.
- Favorites and recent searches persist in the browser, so no database is required.
