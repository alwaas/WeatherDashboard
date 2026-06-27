import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend
} from 'recharts'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?url'
import markerIcon from 'leaflet/dist/images/marker-icon.png?url'
import markerShadow from 'leaflet/dist/images/marker-shadow.png?url'

const defaultLocation = {
  name: 'Bengaluru',
  label: 'Bengaluru, India',
  latitude: 12.97,
  longitude: 77.59
}

const popularPlaces = ['Bengaluru', 'Mysuru', 'Delhi', 'London', 'Tokyo', 'New York', 'Paris']
const storageKeys = {
  favorites: 'weather-dashboard-favorites',
  recent: 'weather-dashboard-recent',
  activity: 'weather-dashboard-activity'
}

const defaultMarkerIcon = new L.Icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
})

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function healthScore({ latency, apiErrors, memoryUsage, cacheHits }) {
  let score = 100
  if (latency > 500) score -= 10
  if (apiErrors > 0) score -= 20
  if (memoryUsage > 80) score -= 10
  if (cacheHits < 1) score -= 5
  return Math.max(0, Math.min(100, score))
}

function App() {
  const [location, setLocation] = useState(defaultLocation)
  const [current, setCurrent] = useState(null)
  const [hourly, setHourly] = useState([])
  const [compareData, setCompareData] = useState([])
  const [favorites, setFavorites] = useState([])
  const [recentSearches, setRecentSearches] = useState([])
  const [activity, setActivity] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [status, setStatus] = useState('Loading...')
  const [isFetching, setIsFetching] = useState(false)
  const [metrics, setMetrics] = useState({ latency: 0, apiErrors: 0, memoryUsage: 0, cacheHits: 0, lastUpdate: null, healthScore: 100 })
  const [ralfLogs, setRalfLogs] = useState([])
  const [lastFetchTrigger, setLastFetchTrigger] = useState(0)
  const [lastAction, setLastAction] = useState({ type: 'initial' })
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const mapContainerRef = useRef(null)

  useEffect(() => {
    const storedFavorites = JSON.parse(localStorage.getItem(storageKeys.favorites) || '[]')
    const storedRecent = JSON.parse(localStorage.getItem(storageKeys.recent) || '[]')
    const storedActivity = JSON.parse(localStorage.getItem(storageKeys.activity) || '[]')
    if (storedFavorites.length) setFavorites(storedFavorites)
    if (storedRecent.length) setRecentSearches(storedRecent)
    if (storedActivity.length) setActivity(storedActivity)
    setSearchQuery(defaultLocation.label)
    initBrowserLocation()
    preloadCompareCities()
  }, [])

  useEffect(() => {
    if (!mapRef.current && mapContainerRef.current) {
      const map = L.map(mapContainerRef.current, { center: [location.latitude, location.longitude], zoom: 5, minZoom: 2 })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map)

      const marker = L.marker([location.latitude, location.longitude], { icon: defaultMarkerIcon }).addTo(map)
      markerRef.current = marker
      map.on('click', (event) => {
        const { lat, lng } = event.latlng
        handleMapClick(lat, lng)
      })
      mapRef.current = map
    }
  }, [location.latitude, location.longitude])

  useEffect(() => {
    if (mapRef.current && markerRef.current) {
      mapRef.current.flyTo([location.latitude, location.longitude], 6, { duration: 1.2 })
      markerRef.current.setLatLng([location.latitude, location.longitude])
    }
  }, [location.latitude, location.longitude])

  useEffect(() => {
    fetchWeatherForLocation(location, lastAction)
  }, [lastFetchTrigger, lastAction])

  async function initBrowserLocation() {
    if (!navigator.geolocation) {
      addActivity('Browser does not support geolocation. Using default city.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        setLocation({ name: 'Your Location', label: 'Your Location', latitude, longitude })
        setSearchQuery('Your Location')
        addActivity('Detected your location automatically')
        setLastAction({ type: 'geo' })
        setLastFetchTrigger(Date.now())
      },
      () => {
        addActivity('Geolocation denied. Loaded default city.')
      },
      { timeout: 8000 }
    )
  }

  async function preloadCompareCities() {
    const compareCities = ['Bengaluru', 'Mumbai', 'Delhi', 'London', 'Tokyo']
    await Promise.all(
      compareCities.map(async (city) => {
        try {
          const geo = await geocodePlace(city)
          if (geo) {
            const weather = await fetchWeather(geo.latitude, geo.longitude)
            addCompareEntry({ id: `${geo.name}-${geo.latitude}-${geo.longitude}`, name: geo.name, latitude: geo.latitude, longitude: geo.longitude }, weather.current)
          }
        } catch (error) {
          console.warn('Compare preload failed for', city, error)
        }
      })
    )
  }

  async function geocodePlace(query) {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`)
    if (!response.ok) throw new Error('Geocoding request failed')
    const data = await response.json()
    if (!data.results || data.results.length === 0) return null
    const result = data.results[0]
    const name = [result.name, result.admin1, result.country].filter(Boolean).join(', ')
    return {
      name,
      latitude: result.latitude,
      longitude: result.longitude
    }
  }

  async function fetchWeather(latitude, longitude) {
    const response = await fetch(`/api/weather?lat=${latitude}&lon=${longitude}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'Failed to load weather')
    return data
  }

  async function fetchWeatherForLocation(targetLocation, action) {
    try {
      setStatus(`Fetching ${targetLocation.name}`)
      setIsFetching(true)
      const start = performance.now()
      const data = await fetchWeather(targetLocation.latitude, targetLocation.longitude)
      const duration = Math.round(performance.now() - start)

      setCurrent(data.current)
      setHourly(data.hourly)
      setMetrics(data.metrics)
      setStatus('Live')
      setSearchQuery(targetLocation.name)
      addCompareEntry(
        {
          id: `${targetLocation.name}-${targetLocation.latitude}-${targetLocation.longitude}`,
          name: targetLocation.name,
          latitude: targetLocation.latitude,
          longitude: targetLocation.longitude
        },
        data.current
      )

      if (action.type === 'search' || action.type === 'map') {
        appendRecentSearch(targetLocation)
        addActivity(`Searched ${targetLocation.name}`)
      }
      if (action.type === 'geo') {
        addActivity('Refreshed current location')
      }
      if (action.type === 'favorite') {
        addActivity(`Loaded favorite ${targetLocation.name}`)
      }

      setRalfLogs([
        `User searches ↓ ${targetLocation.name}`,
        `Reflect API Response: OK`,
        `Analyze search completed in ${duration} ms`,
        `Learn ${targetLocation.name} added to Recent Searches`,
        `FixCache ${targetLocation.name} weather for 5 minutes`
      ])
    } catch (error) {
      console.error(error)
      setStatus('Error')
      addActivity(`Failed to load ${targetLocation.name}`)
      setRalfLogs([`User searches ↓ ${targetLocation.name}`, `Reflect API Response: Error`, `Analyze search failed`, `Learn retry later`, `FixCache hold`])
    } finally {
      setIsFetching(false)
    }
  }

  function addCompareEntry(locationItem, currentData) {
    setCompareData((existing) => {
      const updated = existing.filter((entry) => entry.id !== locationItem.id)
      return [
        {
          ...locationItem,
          temperature: currentData.temperature,
          humidity: currentData.relative_humidity,
          wind: currentData.wind_speed
        },
        ...updated
      ].slice(0, 6)
    })
  }

  function saveFavorites(items) {
    setFavorites(items)
    localStorage.setItem(storageKeys.favorites, JSON.stringify(items))
  }

  function saveRecent(items) {
    setRecentSearches(items)
    localStorage.setItem(storageKeys.recent, JSON.stringify(items))
  }

  function saveActivity(items) {
    setActivity(items)
    localStorage.setItem(storageKeys.activity, JSON.stringify(items))
  }

  function appendRecentSearch(locationItem) {
    setRecentSearches((prev) => {
      const next = [locationItem, ...prev.filter((item) => item.name !== locationItem.name)].slice(0, 6)
      localStorage.setItem(storageKeys.recent, JSON.stringify(next))
      return next
    })
  }

  function addActivity(message) {
    setActivity((prev) => {
      const next = [{ message, timestamp: Date.now() }, ...prev].slice(0, 8)
      localStorage.setItem(storageKeys.activity, JSON.stringify(next))
      return next
    })
  }

  function handleSearch(event) {
    event?.preventDefault()
    if (!searchQuery) return
    setStatus('Resolving location...')
    geocodePlace(searchQuery)
      .then((geo) => {
        if (!geo) {
          setStatus('Location not found')
          return
        }
        setLocation({ name: geo.name, label: geo.name, latitude: geo.latitude, longitude: geo.longitude })
        setLastAction({ type: 'search' })
        setLastFetchTrigger(Date.now())
      })
      .catch((error) => {
        console.error(error)
        setStatus('Search failed')
      })
  }

  function handleFavorite(local) {
    const next = [
      { ...local, id: `${local.name}-${local.latitude}-${local.longitude}` },
      ...favorites.filter((item) => item.name !== local.name || item.latitude !== local.latitude || item.longitude !== local.longitude)
    ].slice(0, 8)
    saveFavorites(next)
    addActivity(`Added ${local.name} to Favorites`)
  }

  function removeFavorite(id) {
    saveFavorites(favorites.filter((item) => item.id !== id))
    addActivity('Removed a favorite location')
  }

  function handleLocationClick(locationItem, actionType = 'favorite') {
    setLocation({ ...locationItem, label: locationItem.name })
    setLastAction({ type: actionType })
    setLastFetchTrigger(Date.now())
  }

  function handleMapClick(lat, lon) {
    setStatus('Map selection detected')
    geocodePlace(`${lat},${lon}`)
      .then((geo) => {
        if (geo) {
          setLocation({ name: geo.name, label: geo.name, latitude: lat, longitude: lon })
        } else {
          setLocation({ name: 'Map point', label: 'Map point', latitude: lat, longitude: lon })
        }
        setLastAction({ type: 'map' })
        setLastFetchTrigger(Date.now())
      })
      .catch(() => {
        setLocation({ name: 'Map point', label: 'Map point', latitude: lat, longitude: lon })
        setLastFetchTrigger(Date.now())
      })
  }

  function refreshLocation() {
    if (!navigator.geolocation) {
      setStatus('Geolocation unavailable')
      return
    }
    setStatus('Refreshing location...')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        setLocation({ name: 'Your Location', label: 'Your Location', latitude, longitude })
        setSearchQuery('Your Location')
        setLastAction({ type: 'geo' })
        setLastFetchTrigger(Date.now())
      },
      () => {
        setStatus('Unable to refresh location')
      }
    )
  }

  const chartData = useMemo(
    () => hourly.map((item) => ({
      time: formatTime(item.time),
      temperature: item.temperature,
      humidity: item.humidity
    })),
    [hourly]
  )

  const score = healthScore(metrics)
  const statusColor = score >= 90 ? 'bg-emerald-500' : score >= 70 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/20">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <p className="text-sm uppercase tracking-[0.35em] text-sky-400">Free Weather Dashboard</p>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-4xl font-semibold">{location.name}</h1>
                <span className="rounded-full bg-slate-800/90 px-3 py-1 text-sm text-slate-300">{location.label}</span>
              </div>
              <p className="max-w-2xl text-slate-400">Search cities, save favorites, click the map, and compare weather across multiple locations with Open-Meteo.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:w-[360px]">
              <div className="rounded-3xl bg-slate-950/80 border border-slate-800 p-5">
                <p className="text-sm uppercase tracking-[0.25em] text-slate-400">RALF Status</p>
                <p className="mt-3 text-2xl font-semibold">{status}</p>
                <div className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-medium ${statusColor}`}>{score}% Health</div>
              </div>
              <div className="rounded-3xl bg-slate-950/80 border border-slate-800 p-5">
                <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Quick actions</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={refreshLocation} className="rounded-2xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400">Refresh Location</button>
                  <button type="button" onClick={() => handleFavorite(location)} className="rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500">Save Favorite</button>
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSearch} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="search">Search city, district, state, country</label>
            <input
              id="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search city, district, state, country..."
              className="min-w-0 flex-1 rounded-3xl border border-slate-800 bg-slate-950/90 px-5 py-4 text-slate-100 outline-none transition focus:border-sky-500"
            />
            <button
              type="submit"
              className="rounded-3xl bg-sky-500 px-6 py-4 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              Search
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-400">
            {popularPlaces.map((place) => (
              <button
                key={place}
                type="button"
                onClick={() => {
                  setSearchQuery(place)
                  handleSearch()
                }}
                className="rounded-full border border-slate-700 px-4 py-2 transition hover:border-slate-500"
              >
                {place}
              </button>
            ))}
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Current weather</p>
                  <h2 className="mt-3 text-3xl font-semibold">{current ? `${current.temperature}°C` : '--'}</h2>
                  <p className="mt-2 text-slate-400">Feels like {current?.apparent_temperature ?? '--'}°C · Humidity {current?.relative_humidity ?? '--'}% · Wind {current?.wind_speed ?? '--'} km/h</p>
                </div>
                <div className="space-y-2 text-sm text-slate-300">
                  <div className="rounded-2xl bg-slate-950/70 px-4 py-3">Latency: {metrics.latency} ms</div>
                  <div className="rounded-2xl bg-slate-950/70 px-4 py-3">Health score: {metrics.healthScore}%</div>
                  <div className="rounded-2xl bg-slate-950/70 px-4 py-3">Cache hits: {metrics.cacheHits}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                <h3 className="text-xl font-semibold">Favorites ⭐</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {favorites.length ? favorites.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setLocation(item)
                        setLastAction({ type: 'favorite' })
                        setLastFetchTrigger(Date.now())
                      }}
                      className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
                    >
                      {item.name}
                    </button>
                  )) : (
                    <p className="text-sm text-slate-500">Save a location to see it here.</p>
                  )}
                </div>
                {favorites.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-400">
                    {favorites.map((item) => (
                      <button
                        key={`remove-${item.id}`}
                        type="button"
                        onClick={() => removeFavorite(item.id)}
                        className="rounded-full border border-slate-700 px-3 py-1 hover:border-slate-500"
                      >
                        Remove {item.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                <h3 className="text-xl font-semibold">Recent Searches</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {recentSearches.length ? recentSearches.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => {
                        setLocation(item)
                        setLastFetchTrigger(Date.now())
                      }}
                      className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
                    >
                      {item.name}
                    </button>
                  )) : (
                    <p className="text-sm text-slate-500">Recent searches will appear here.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">Interactive map</h3>
                <p className="mt-1 text-slate-400">Click anywhere to load weather for that point.</p>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-300">OpenStreetMap</span>
            </div>
            <div ref={mapContainerRef} className="mt-5 h-96 rounded-3xl border border-slate-800 bg-slate-950" />
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Compare Cities</h2>
              <p className="mt-1 text-slate-400">View temperature, humidity, and wind side by side.</p>
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/80">
            <div className="grid grid-cols-4 gap-4 border-b border-slate-800 bg-slate-900/90 px-5 py-4 text-xs uppercase tracking-[0.25em] text-slate-500">
              <span>City</span>
              <span>Temp</span>
              <span>Humidity</span>
              <span>Wind</span>
            </div>
            {compareData.length ? compareData.map((entry) => (
              <div key={entry.id} className="grid grid-cols-4 gap-4 px-5 py-4 text-sm text-slate-200">
                <span>{entry.name}</span>
                <span>{entry.temperature}°C</span>
                <span>{entry.humidity}%</span>
                <span>{entry.wind} km/h</span>
              </div>
            )) : (
              <div className="px-5 py-6 text-sm text-slate-500">Loading comparison data...</div>
            )}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <h3 className="text-xl font-semibold">RALF Progress</h3>
            <p className="mt-2 text-slate-400">Every search is reflected, analyzed, learned, and fixed with live status details.</p>
            <div className="mt-5 space-y-3 text-slate-200">
              {ralfLogs.length ? ralfLogs.map((line, index) => (
                <div key={index} className="rounded-2xl bg-slate-950/70 px-4 py-3 text-sm">{line}</div>
              )) : (
                <p className="text-sm text-slate-500">Start a search to see RALF updates.</p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
            <h3 className="text-xl font-semibold">Recent Activity</h3>
            <div className="mt-5 space-y-3 text-slate-200">
              {activity.length ? activity.map((item, index) => (
                <div key={index} className="rounded-2xl bg-slate-950/70 px-4 py-3 text-sm">
                  <p>{item.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(item.timestamp).toLocaleTimeString()}</p>
                </div>
              )) : (
                <p className="text-sm text-slate-500">Activity logs appear after you use the dashboard.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

export default App
