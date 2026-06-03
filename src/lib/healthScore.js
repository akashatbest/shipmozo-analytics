// Seller health score — 0–100. rto_rate stored as percentage (0–100 range).
// Green >= 70 | Amber 40–69 | Red < 40

export function computeHealthScore({ months }) {
  if (!months || months.length === 0) return { score: 0, status: 'red', breakdown: {} }

  // months is ordered newest-first (from seller_monthly query)
  const latest = months[0]
  const prev   = months[1]

  // Volume score (0–40)
  let volumeScore = 0
  if (!latest.orders || latest.orders === 0) {
    volumeScore = 0
  } else if (prev && prev.orders > 0) {
    const growth = (latest.orders - prev.orders) / prev.orders
    if (growth >  0.05) volumeScore = 40  // growing
    else if (growth >= -0.05) volumeScore = 25  // stable
    else volumeScore = 10                       // declining
  } else {
    volumeScore = 25 // only one month of data — neutral
  }

  // RTO score (0–30) — rto_rate is 0–100 percentage
  const rtoRate = latest.rto_rate ?? 0
  let rtoScore = 0
  if (rtoRate < 15)      rtoScore = 30
  else if (rtoRate < 25) rtoScore = 20
  else if (rtoRate < 35) rtoScore = 10
  else                   rtoScore = 0

  // Engagement score (0–20): % of tracked months with orders
  const activeMonths = months.filter(m => (m.orders || 0) > 0).length
  const engagementScore = Math.round((activeMonths / Math.max(months.length, 1)) * 20)

  // Tenure score (0–10): based on months_active or array length
  const monthsActive = months.length
  let tenureScore = 0
  if (monthsActive >= 6)      tenureScore = 10
  else if (monthsActive >= 3) tenureScore = 6
  else                        tenureScore = 3

  const score = volumeScore + rtoScore + engagementScore + tenureScore

  let status = 'red'
  if (score >= 70) status = 'green'
  else if (score >= 40) status = 'amber'

  return { score, status, breakdown: { volumeScore, rtoScore, engagementScore, tenureScore } }
}

export function computeVolumeTrend(months) {
  if (!months || months.length < 2) return 'new'
  const curr = months[0]?.orders ?? 0
  const prev = months[1]?.orders ?? 0
  if (prev === 0) return 'new'
  const pct = (curr - prev) / prev
  if (pct >  0.05) return 'growing'
  if (pct < -0.05) return 'declining'
  return 'stable'
}

export function computeRtoTrend(months) {
  if (!months || months.length < 2) return 'stable'
  const curr = months[0]?.rto_rate ?? 0
  const prev = months[1]?.rto_rate ?? 0
  const diff = curr - prev  // both are percentages
  if (diff < -2)  return 'improving'
  if (diff >  2)  return 'worsening'
  return 'stable'
}

export function statusColor(status) {
  return { green: '#22c55e', amber: '#f59e0b', red: '#ef4444' }[status] ?? '#6b7280'
}

export function statusBadgeClass(status) {
  return {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red:   'bg-red-100 text-red-700',
  }[status] ?? 'bg-gray-100 text-gray-600'
}
