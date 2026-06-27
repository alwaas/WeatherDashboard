import { reflect, healthScore, analyze } from './lib/weather.js'

export async function GET() {
  return new Response(JSON.stringify({ ...reflect(), healthScore: healthScore(), issues: analyze() }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
