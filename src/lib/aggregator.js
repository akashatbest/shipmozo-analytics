// CSV aggregation engine — single pass over all rows, produces objects ready for Supabase upsert

export const EXPECTED_COLUMNS = [
  'User Id', 'Name', 'Company Name', 'Order Date', 'Order Id', 'AWB Number',
  'Courier', 'Courier Company Service Type', 'Picked Date', 'Courier Invoice Weight',
  'Total Shipping chargers', 'Total Courier Shipping Charge', 'Total Costing Shipping Charge',
  'Charged Weight', 'Courier Weight', 'Credit Note Reason', 'Credit Note Amount',
  'Price Card Id', 'Zone', 'Courier Zone', 'Invoice Weight Uploaded', 'Rto',
]

export function validateColumns(headers) {
  const missing = EXPECTED_COLUMNS.filter(col => !headers.includes(col))
  return { valid: missing.length === 0, missing }
}

// Detect the month with the most rows
export function detectTargetMonth(rows) {
  const counts = {}
  for (const row of rows) {
    const d = parseOrderDate(row['Order Date'])
    if (d) {
      const m = toMonth(d)
      counts[m] = (counts[m] || 0) + 1
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return sorted[0]?.[0] ?? null
}

// How many rows would be captured vs dropped for a given month
export function getMonthCoverage(rows, targetMonth) {
  let included = 0, excluded = 0, unparseable = 0
  for (const row of rows) {
    const d = parseOrderDate(row['Order Date'])
    if (!d) { unparseable++; continue }
    if (toMonth(d) === targetMonth) included++
    else excluded++
  }
  return { included, excluded, unparseable, total: rows.length }
}

export function aggregateCSV(rows, targetMonth) {
  let totalOrders = 0, totalRevenue = 0, totalCost = 0, totalRto = 0
  let totalCreditNotes = 0, totalWeightDisc = 0, totalZoneMismatch = 0
  const sellerSet = new Set()

  const courierMap = {}
  const sellerMap = {}
  const zoneMap = {}
  const stMap = {}      // service type: key = "courier|||service_type"
  const dailyMap = {}
  const cnMap = {}      // credit notes: key = reason
  const waMap = {}      // weight audit: key = courier
  const pcMap = {}      // price card: key = price_card_id
  const sellerZones = {}
  const sellerCouriers = {}
  const sellerPriceCards = {}

  for (const row of rows) {
    // Parse date — skip only if completely unparseable (blank cell etc.)
    // All rows are included regardless of which month their date falls in;
    // the user explicitly chose this month by uploading this file.
    const d = parseOrderDate(row['Order Date'])

    const userId = parseInt(String(row['User Id'] ?? '').trim(), 10)
    if (isNaN(userId)) continue

    const revenue     = num(row['Total Shipping chargers'])
    const cost        = num(row['Total Courier Shipping Charge'])
    const courier     = str(row['Courier'])
    const serviceType = str(row['Courier Company Service Type'])
    const priceCardId = str(row['Price Card Id'])
    const zone        = str(row['Zone'])
    const courierZone = str(row['Courier Zone'])
    const usedZone    = courierZone || zone
    const isRto       = str(row['Rto']).toUpperCase() === 'YES'
    const charged     = num(row['Charged Weight'])
    const courierW    = num(row['Courier Weight'])
    const cnReason    = str(row['Credit Note Reason'])
    const cnAmount    = num(row['Credit Note Amount'])
    const dateStr     = d ? toDateStr(d) : null
    const dow         = d ? DAYS[d.getDay()] : null

    const hasWeightDisc  = charged > 0 && courierW > 0 && Math.abs(charged - courierW) > 0.1
    const hasZoneMismatch = zone && courierZone && zone !== courierZone

    // ── Overview ──────────────────────────────────────────────────────────
    totalOrders++
    totalRevenue += revenue
    totalCost    += cost
    if (isRto)          totalRto++
    if (cnAmount > 0)   totalCreditNotes  += cnAmount
    if (hasWeightDisc)  totalWeightDisc++
    if (hasZoneMismatch) totalZoneMismatch++
    sellerSet.add(userId)

    // ── Couriers ──────────────────────────────────────────────────────────
    if (!courierMap[courier]) {
      courierMap[courier] = { orders: 0, rev: 0, cost: 0, rto: 0, weight: 0, disc: 0, cn: 0 }
    }
    const cm = courierMap[courier]
    cm.orders++; cm.rev += revenue; cm.cost += cost; cm.weight += charged
    if (isRto)         cm.rto++
    if (hasWeightDisc) cm.disc++
    if (cnAmount > 0)  cm.cn += cnAmount

    // ── Sellers ───────────────────────────────────────────────────────────
    if (!sellerMap[userId]) {
      sellerMap[userId] = {
        user_id: userId,
        name: str(row['Name']),
        company_name: str(row['Company Name']),
        orders: 0, rev: 0, cost: 0, rto: 0, disc: 0, cnCount: 0, cnAmt: 0,
      }
      sellerZones[userId]      = {}
      sellerCouriers[userId]   = {}
      sellerPriceCards[userId] = {}
    }
    const sm = sellerMap[userId]
    sm.orders++; sm.rev += revenue; sm.cost += cost
    if (isRto)         sm.rto++
    if (hasWeightDisc) sm.disc++
    if (cnReason)      { sm.cnCount++; sm.cnAmt += cnAmount }
    if (usedZone)     sellerZones[userId][usedZone]        = (sellerZones[userId][usedZone]        || 0) + 1
    if (courier)      sellerCouriers[userId][courier]      = (sellerCouriers[userId][courier]      || 0) + 1
    if (priceCardId)  sellerPriceCards[userId][priceCardId] = (sellerPriceCards[userId][priceCardId] || 0) + 1

    // ── Price cards ───────────────────────────────────────────────────────
    if (priceCardId) {
      if (!pcMap[priceCardId]) {
        pcMap[priceCardId] = {
          orders: 0, rev: 0, cost: 0, rto: 0, weight: 0, disc: 0, cn: 0,
          sellers: new Set(),
          zones: {},
        }
      }
      const pc = pcMap[priceCardId]
      pc.orders++; pc.rev += revenue; pc.cost += cost; pc.weight += charged
      if (isRto)         pc.rto++
      if (hasWeightDisc) pc.disc++
      if (cnAmount > 0)  pc.cn += cnAmount
      pc.sellers.add(userId)
      if (usedZone) pc.zones[usedZone] = (pc.zones[usedZone] || 0) + 1
    }

    // ── Zones ─────────────────────────────────────────────────────────────
    if (usedZone) {
      if (!zoneMap[usedZone]) zoneMap[usedZone] = { orders: 0, rev: 0, rto: 0 }
      const zm = zoneMap[usedZone]
      zm.orders++; zm.rev += revenue
      if (isRto) zm.rto++
    }

    // ── Service types ─────────────────────────────────────────────────────
    const stKey = `${courier}|||${serviceType}`
    if (!stMap[stKey]) stMap[stKey] = { orders: 0, rev: 0, cost: 0, rto: 0, weight: 0 }
    const stv = stMap[stKey]
    stv.orders++; stv.rev += revenue; stv.cost += cost; stv.weight += charged
    if (isRto) stv.rto++

    // ── Daily ─────────────────────────────────────────────────────────────
    if (!dailyMap[dateStr]) dailyMap[dateStr] = { orders: 0, rto: 0, rev: 0, dow }
    const dv = dailyMap[dateStr]
    dv.orders++; dv.rev += revenue
    if (isRto) dv.rto++

    // ── Credit notes ──────────────────────────────────────────────────────
    if (cnReason) {
      if (!cnMap[cnReason]) cnMap[cnReason] = { count: 0, amount: 0 }
      cnMap[cnReason].count++
      cnMap[cnReason].amount += cnAmount
    }

    // ── Weight audit ──────────────────────────────────────────────────────
    if (!waMap[courier]) {
      waMap[courier] = { total: 0, disc: 0, overKg: 0, overN: 0, underKg: 0, underN: 0, zoneMismatch: 0 }
    }
    const wa = waMap[courier]
    wa.total++
    if (hasWeightDisc) {
      wa.disc++
      const diff = charged - courierW
      if (diff > 0) { wa.overKg  += diff;         wa.overN++ }
      else          { wa.underKg += Math.abs(diff); wa.underN++ }
    }
    if (hasZoneMismatch) wa.zoneMismatch++
  }

  // ── Finalise all tables ───────────────────────────────────────────────────

  const overview = {
    month: targetMonth,
    total_orders: totalOrders,
    total_revenue_billed: r2(totalRevenue),
    total_courier_cost: r2(totalCost),
    gross_margin: r2(totalRevenue - totalCost),
    margin_pct: rate(totalRevenue - totalCost, totalRevenue),
    rto_count: totalRto,
    rto_rate: rate(totalRto, totalOrders),
    active_sellers: sellerSet.size,
    avg_shipping_charge: r2(totalRevenue / (totalOrders || 1)),
    total_credit_note_amount: r2(totalCreditNotes),
    weight_discrepancy_count: totalWeightDisc,
    zone_mismatch_count: totalZoneMismatch,
    // new_sellers / churned_sellers filled in by pipeline after sellers query
    new_sellers: 0,
    churned_sellers: 0,
  }

  const courierMonthly = Object.entries(courierMap).map(([courier, c]) => ({
    month: targetMonth, courier,
    orders: c.orders,
    revenue_billed: r2(c.rev),
    courier_cost: r2(c.cost),
    margin: r2(c.rev - c.cost),
    margin_pct: rate(c.rev - c.cost, c.rev),
    rto_count: c.rto,
    rto_rate: rate(c.rto, c.orders),
    avg_charge: r2(c.rev / (c.orders || 1)),
    avg_weight: r2(c.weight / (c.orders || 1)),
    weight_discrepancy_count: c.disc,
    credit_note_amount: r2(c.cn),
  }))

  const sellerMonthly = Object.values(sellerMap).map(s => {
    const zones  = sellerZones[s.user_id]   || {}
    const couriers = sellerCouriers[s.user_id] || {}
    const zTotal = Object.values(zones).reduce((a, b) => a + b, 0) || 1
    return {
      month: targetMonth,
      user_id: s.user_id,
      name: s.name,
      company_name: s.company_name,
      orders: s.orders,
      revenue_billed: r2(s.rev),
      courier_cost: r2(s.cost),
      margin: r2(s.rev - s.cost),
      margin_pct: rate(s.rev - s.cost, s.rev),
      rto_count: s.rto,
      rto_rate: rate(s.rto, s.orders),
      avg_shipping_charge: r2(s.rev / (s.orders || 1)),
      primary_courier: topKey(couriers),
      primary_zone: topKey(zones),
      zone_a_pct: rate(zones['A'] || 0, zTotal),
      zone_b_pct: rate(zones['B'] || 0, zTotal),
      zone_c_pct: rate(zones['C'] || 0, zTotal),
      zone_d_pct: rate(zones['D'] || 0, zTotal),
      zone_e_pct: rate(zones['E'] || 0, zTotal),
      weight_discrepancy_count: s.disc,
      credit_note_count: s.cnCount,
      credit_note_amount: r2(s.cnAmt),
      price_card_id: topKey(sellerPriceCards[s.user_id] || {}),
    }
  })

  const priceCardMonthly = Object.entries(pcMap).map(([price_card_id, pc]) => {
    const zTotal = Object.values(pc.zones).reduce((a, b) => a + b, 0) || 1
    return {
      month: targetMonth,
      price_card_id,
      orders: pc.orders,
      revenue_billed: r2(pc.rev),
      courier_cost: r2(pc.cost),
      margin: r2(pc.rev - pc.cost),
      margin_pct: rate(pc.rev - pc.cost, pc.rev),
      rto_count: pc.rto,
      rto_rate: rate(pc.rto, pc.orders),
      seller_count: pc.sellers.size,
      avg_weight: r2(pc.weight / (pc.orders || 1)),
      weight_discrepancy_count: pc.disc,
      zone_a_orders: pc.zones['A'] || 0,
      zone_b_orders: pc.zones['B'] || 0,
      zone_c_orders: pc.zones['C'] || 0,
      zone_d_orders: pc.zones['D'] || 0,
      zone_e_orders: pc.zones['E'] || 0,
      credit_note_amount: r2(pc.cn),
    }
  })

  const zoneMonthly = Object.entries(zoneMap).map(([zone, z]) => ({
    month: targetMonth, zone,
    orders: z.orders,
    revenue_billed: r2(z.rev),
    avg_charge: r2(z.rev / (z.orders || 1)),
    rto_count: z.rto,
    rto_rate: rate(z.rto, z.orders),
  }))

  const serviceTypeMonthly = Object.entries(stMap).map(([key, st]) => {
    const [courier, service_type] = key.split('|||')
    return {
      month: targetMonth, courier, service_type,
      orders: st.orders,
      revenue_billed: r2(st.rev),
      courier_cost: r2(st.cost),
      margin: r2(st.rev - st.cost),
      margin_pct: rate(st.rev - st.cost, st.rev),
      avg_weight: r2(st.weight / (st.orders || 1)),
      rto_count: st.rto,
      rto_rate: rate(st.rto, st.orders),
    }
  })

  const dailySummary = Object.entries(dailyMap).map(([date, d]) => ({
    date, month: targetMonth,
    orders: d.orders,
    rto_count: d.rto,
    rto_rate: rate(d.rto, d.orders),
    revenue_billed: r2(d.rev),
    day_of_week: d.dow,
  }))

  const creditNotesMonthly = Object.entries(cnMap).map(([reason, cn]) => ({
    month: targetMonth, reason,
    count: cn.count,
    total_amount: r2(cn.amount),
  }))

  const weightAuditMonthly = Object.entries(waMap).map(([courier, wa]) => ({
    month: targetMonth, courier,
    total_orders_audited: wa.total,
    discrepancy_count: wa.disc,
    discrepancy_rate: rate(wa.disc, wa.total),
    avg_overcharge_kg: wa.overN  > 0 ? r2(wa.overKg  / wa.overN)  : 0,
    avg_undercharge_kg: wa.underN > 0 ? r2(wa.underKg / wa.underN) : 0,
    zone_mismatch_count: wa.zoneMismatch,
  }))

  // Slim seller list for master-table update (includes monthly totals for lifetime calcs)
  const uniqueSellers = Object.values(sellerMap).map(s => ({
    user_id: s.user_id,
    name: s.name,
    company_name: s.company_name,
    primary_courier: topKey(sellerCouriers[s.user_id] || {}),
    monthly_orders: s.orders,
    monthly_revenue: r2(s.rev),
  }))

  return {
    filteredRowCount: totalOrders,
    overview,
    courierMonthly,
    sellerMonthly,
    zoneMonthly,
    serviceTypeMonthly,
    dailySummary,
    creditNotesMonthly,
    weightAuditMonthly,
    priceCardMonthly,
    uniqueSellers,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function num(val) {
  const n = parseFloat(String(val ?? '').replace(/,/g, ''))
  return isNaN(n) ? 0 : n
}
function str(val) { return String(val ?? '').trim() }

function parseOrderDate(val) {
  if (!val) return null
  const s = String(val).trim()
  if (!s) return null

  // Try native parse first (handles ISO 8601, RFC 2822, etc.)
  let d = new Date(s)
  if (!isNaN(d.getTime())) return d

  // DD/MM/YYYY or DD-MM-YYYY (common in Indian exports)
  const dmyMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/)
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch
    d = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`)
    if (!isNaN(d.getTime())) return d
  }

  // DD/MM/YYYY HH:MM or DD-MM-YYYY HH:MM:SS
  const dmyTimeMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\s+(\d{1,2}):(\d{2})/)
  if (dmyTimeMatch) {
    const [, dd, mm, yyyy, hh, min] = dmyTimeMatch
    d = new Date(`${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}T${hh.padStart(2,'0')}:${min}:00`)
    if (!isNaN(d.getTime())) return d
  }

  return null
}
function toMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function toDateStr(d) {
  return d.toISOString().split('T')[0]
}
function r2(n) { return Math.round(n * 100) / 100 }
// Returns percentage 0–100 (e.g. 27.3 not 0.273)
function rate(numerator, denominator) {
  return denominator === 0 ? 0 : r2((numerator / denominator) * 100)
}
function topKey(obj) {
  let max = 0, top = null
  for (const [k, v] of Object.entries(obj)) {
    if (v > max) { max = v; top = k }
  }
  return top
}
