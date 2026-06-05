import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
  defaults,
} from 'chart.js'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend, Filler,
)

// ── Global Chart.js defaults ──────────────────────────────────────────────────
defaults.font.family = "'Inter', system-ui, sans-serif"
defaults.font.size   = 12
defaults.color       = '#94a3b8'
defaults.plugins.legend.labels.boxWidth  = 10
defaults.plugins.legend.labels.padding   = 16
defaults.plugins.legend.labels.usePointStyle = true
defaults.plugins.tooltip.backgroundColor  = '#0f172a'
defaults.plugins.tooltip.titleColor       = '#f8fafc'
defaults.plugins.tooltip.bodyColor        = '#cbd5e1'
defaults.plugins.tooltip.borderColor      = '#1e293b'
defaults.plugins.tooltip.borderWidth      = 1
defaults.plugins.tooltip.padding          = 10
defaults.plugins.tooltip.cornerRadius     = 8
defaults.plugins.tooltip.titleFont        = { family: "'Inter'", weight: '600', size: 12 }
defaults.plugins.tooltip.bodyFont         = { family: "'Inter'", size: 12 }
defaults.animation.duration               = 400

// ── Consistent courier colour palette ────────────────────────────────────────
export const COURIER_COLORS = {
  'Delhivery':     '#3b82f6',
  'Bluedart':      '#ef4444',
  'Amazon':        '#f97316',
  'XpressBees':    '#8b5cf6',
  'Ekart':         '#10b981',
  'DTDC':          '#f59e0b',
  'Shadow Fax':    '#06b6d4',
  'Delhivery B2B': '#6366f1',
  'Bluedart B2B':  '#ec4899',
}

export function courierColor(name, alpha = 1) {
  const hex = COURIER_COLORS[name] ?? '#64748b'
  if (alpha === 1) return hex
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Chart option factories ────────────────────────────────────────────────────
const BASE_SCALES = {
  x: {
    grid: { display: false },
    ticks: { font: { family: "'Inter'", size: 11 }, color: '#94a3b8', maxRotation: 0 },
    border: { display: false },
  },
  y: {
    grid: { color: '#f1f5f9', drawBorder: false },
    ticks: { font: { family: "'Inter'", size: 11 }, color: '#94a3b8', padding: 8 },
    border: { display: false },
  },
}

export const barOpts = (overrides = {}) => ({
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: { display: false },
    ...overrides.plugins,
  },
  scales: {
    x: { ...BASE_SCALES.x, ...overrides.scales?.x },
    y: { ...BASE_SCALES.y, ...overrides.scales?.y },
  },
  ...overrides,
})

export const lineOpts = (overrides = {}) => ({
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: { display: false },
    ...overrides.plugins,
  },
  scales: {
    x: { ...BASE_SCALES.x, ...overrides.scales?.x },
    y: { ...BASE_SCALES.y, ...overrides.scales?.y },
  },
  elements: {
    line: { borderWidth: 2 },
    point: { radius: 3, hoverRadius: 5 },
  },
  ...overrides,
})

export const doughnutOpts = (overrides = {}) => ({
  responsive: true,
  maintainAspectRatio: true,
  cutout: '68%',
  plugins: {
    legend: {
      position: 'right',
      labels: { font: { family: "'Inter'", size: 11 }, color: '#374151', boxWidth: 10, padding: 14 },
    },
    ...overrides.plugins,
  },
  ...overrides,
})

// ── Format helpers ────────────────────────────────────────────────────────────
// Smart currency formatter: shows ₹, ₹K, or ₹L based on magnitude
// so small amounts like ₹2,580 don't show as the misleading "₹0.0L"
export const fmtINR = n => {
  const val = n ?? 0
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`
  if (abs >= 1000)   return `${sign}₹${(abs / 1000).toFixed(1)}K`
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`
}
export const fmtPct   = n => `${(n ?? 0).toFixed(1)}%`
export const fmtNum   = n => (n ?? 0).toLocaleString('en-IN')
export const fmtMonth = m => {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' })
}
