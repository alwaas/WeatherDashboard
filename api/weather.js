import { fetchWeather, metrics, history, healthScore, analyze, learn, fix } from './lib/weather.js'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const latitude = parseFloat(searchParams.get('lat'))
  const longitude = parseFloat(searchParams.get('lon'))

  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return new Response(JSON.stringify({ message: 'Latitude and longitude are required.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const data = await fetchWeather(latitude, longitude)
    const report = {
      ...data,
      metrics: { ...metrics, healthScore: healthScore() },
      history: history.slice(-20)
    }
    const issues = analyze()
    learn()
    fix(issues)

    return new Response(JSON.stringify(report), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message || 'Weather fetch failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
  }
}
