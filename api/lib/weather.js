const cache = new Map()
let metrics = {
  latency: 0,
  apiErrors: 0,
  memoryUsage: 0,
  cacheHits: 0,
  lastUpdate: null
}
let history = []
let cacheTTL = 60

function analyze() {
  const issues = []
  if (metrics.latency > 1000) issues.push('slow_api')
  if (metrics.apiErrors > 0) issues.push('api_errors')
  if (metrics.memoryUsage > 200 * 1024 * 1024) issues.push('memory_leak')
  return issues
}

function learn() {
  const trend = { timestamp: Date.now(), latency: metrics.latency, apiErrors: metrics.apiErrors }
  history.push(trend)
  if (history.length > 200) history.shift()
}

function fix(issues) {
  issues.forEach((issue) => {
    if (issue === 'slow_api') cacheTTL = Math.min(cacheTTL + 60, 300)
    if (issue === 'api_errors') cacheTTL = Math.min(cacheTTL + 30, 180)
    if (issue === 'memory_leak') cache.clear()
  })
}

function healthScore() {
  let score = 100
  if (metrics.latency > 500) score -= 10
  if (metrics.apiErrors > 0) score -= 20
  const memoryMb = metrics.memoryUsage / 1024 / 1024
  if (memoryMb > 200) score -= 10
  return Math.max(0, Math.min(100, score))
}

function reflect() {
  return {
    apiAlive: true,
    latency: metrics.latency,
    memory: process.memoryUsage(),
    weatherFreshness: metrics.lastUpdate
  }
}

async function fetchWeather(latitude, longitude) {
  const cacheKey = `${latitude}:${longitude}`
  const now = Date.now()
  const cached = cache.get(cacheKey)
  if (cached && now - cached.timestamp < cacheTTL * 1000) {
    metrics.cacheHits += 1
    return cached.data
  }

  const start = Date.now()
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=temperature_2m,relative_humidity_2m&timezone=auto`
  const response = await fetch(url)
  const data = await response.json()
  metrics.latency = Date.now() - start
  metrics.lastUpdate = Date.now()
  metrics.memoryUsage = process.memoryUsage().heapUsed

  if (!response.ok) {
    metrics.apiErrors += 1
    throw new Error(data.reason || 'Open-Meteo request failed')
  }

  const result = {
    current: {
      temperature: data.current_weather.temperature,
      apparent_temperature: data.current_weather.temperature,
      relative_humidity: data.hourly.relative_humidity_2m[0],
      wind_speed: data.current_weather.windspeed
    },
    hourly: data.hourly.time.slice(0, 24).map((time, index) => ({
      time,
      temperature: data.hourly.temperature_2m[index],
      humidity: data.hourly.relative_humidity_2m[index]
    }))
  }

  cache.set(cacheKey, { timestamp: now, data: result })
  return result
}

export { fetchWeather, metrics, history, healthScore, analyze, reflect, learn, fix }
