import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = process.env.PORT || 4000
const dataDir = path.join(__dirname, '..', 'data')
const weatherPath = path.join(dataDir, 'weather-history.json')
const metricsPath = path.join(dataDir, 'metrics.json')

let cache = new Map()
let metrics = {
  latency: 0,
  apiErrors: 0,
  memoryUsage: 0,
  cacheHits: 0,
  lastUpdate: null
}
let history = []
let cacheTTL = 60
let lastFetch = 0

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
}

function loadFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (err) {
    console.error('Failed to load file', filePath, err)
  }
  return defaultValue
}

function saveFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save file', filePath, err)
  }
}

function reflect() {
  return {
    apiAlive: true,
    latency: metrics.latency,
    memory: process.memoryUsage(),
    weatherFreshness: metrics.lastUpdate
  }
}

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
  issues.forEach(issue => {
    if (issue === 'slow_api') cacheTTL = Math.min(cacheTTL + 60, 300)
    if (issue === 'api_errors') cacheTTL = Math.min(cacheTTL + 30, 180)
    if (issue === 'memory_leak') {
      cache.clear()
      global.gc?.()
    }
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

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'dist')))

app.get('/api/weather', async (req, res) => {
  const latitude = parseFloat(req.query.lat)
  const longitude = parseFloat(req.query.lon)
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return res.status(400).json({ message: 'Latitude and longitude are required.' })
  }

  try {
    const data = await fetchWeather(latitude, longitude)
    const report = {
      ...data,
      metrics: { ...metrics, healthScore: healthScore() },
      history: history.slice(-20)
    }
    ensureDataDir()
    saveFile(weatherPath, { timestamp: Date.now(), location: { latitude, longitude }, data })
    saveFile(metricsPath, { metrics, history: history.slice(-50), cacheTTL, lastFetch: Date.now() })
    const issues = analyze()
    learn()
    fix(issues)
    res.json(report)
  } catch (error) {
    res.status(502).json({ message: error.message || 'Weather fetch failed' })
  }
})

app.get('/api/health', (req, res) => {
  res.json({ ...reflect(), healthScore: healthScore(), cacheTTL, issues: analyze() })
})

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
