import { useState, useRef, useEffect } from 'react'
import Papa from 'papaparse'
import { supabase } from '../lib/supabase'
import { validateColumns, detectTargetMonth, aggregateCSV, getMonthCoverage, EXPECTED_COLUMNS } from '../lib/aggregator'
import { computeHealthScore, computeVolumeTrend, computeRtoTrend } from '../lib/healthScore'
import { generateMonthlyBrief } from '../lib/openai'
import { fmtMonth } from '../lib/chartConfig'

// ── Pipeline step definitions ─────────────────────────────────────────────────
const STEPS = [
  { id: 'parse',     label: 'Parsing CSV file' },
  { id: 'aggregate', label: 'Aggregating data' },
  { id: 'sellers',   label: 'Updating seller registry' },
  { id: 'upsert',    label: 'Saving to database' },
  { id: 'health',    label: 'Computing health scores' },
  { id: 'ai',        label: 'Generating AI brief' },
  { id: 'log',       label: 'Finalising upload' },
]

// ── Pipeline helpers ──────────────────────────────────────────────────────────

async function parseCSV(file, onProgress) {
  return new Promise((resolve, reject) => {
    const rows = []
    const estimatedRows = file.size / 250
    let count = 0

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      step(result) {
        rows.push(result.data)
        count++
        if (count % 10000 === 0) {
          onProgress(Math.min(90, Math.round((count / estimatedRows) * 100)))
        }
      },
      complete() { onProgress(100); resolve(rows) },
      error: reject,
    })
  })
}

async function deleteMonthData(month) {
  const monthTables = [
    'monthly_overview', 'courier_monthly', 'seller_monthly', 'zone_monthly',
    'service_type_monthly', 'credit_notes_monthly', 'weight_audit_monthly', 'price_card_monthly',
  ]
  for (const table of monthTables) {
    const { error } = await supabase.from(table).delete().eq('month', month)
    if (error) throw new Error(`Delete ${table}: ${error.message}`)
  }
  // daily_summary filtered by month column
  const { error: dErr } = await supabase.from('daily_summary').delete().eq('month', month)
  if (dErr) throw new Error(`Delete daily_summary: ${dErr.message}`)
  // ai_insights for this month
  await supabase.from('ai_insights').delete().eq('month', month)
  // upload_log for this month
  await supabase.from('upload_log').delete().eq('month', month)
}

async function batchUpsert(table, rows, opts = {}) {
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + BATCH), opts)
    if (error) throw new Error(`Upsert ${table}: ${error.message}`)
  }
}

async function updateSellers(uniqueSellers, targetMonth) {
  const userIds = uniqueSellers.map(s => s.user_id)

  // Batch the .in() query — large arrays overflow PostgREST's URL limit
  const CHUNK = 100
  const existingRows = []
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('sellers')
      .select('user_id, lifetime_orders, lifetime_revenue')
      .in('user_id', userIds.slice(i, i + CHUNK))
    if (error) throw new Error(`Query sellers: ${error.message}`)
    if (data) existingRows.push(...data)
  }

  const existingMap = Object.fromEntries(existingRows.map(s => [s.user_id, s]))
  const toUpsert = []
  let newCount = 0

  for (const s of uniqueSellers) {
    const ex = existingMap[s.user_id]
    if (ex) {
      toUpsert.push({
        user_id: s.user_id,
        name: s.name,
        company_name: s.company_name,
        last_active_month: targetMonth,
        primary_courier: s.primary_courier,
        lifetime_orders: (ex.lifetime_orders || 0) + s.monthly_orders,
        lifetime_revenue: Math.round(((ex.lifetime_revenue || 0) + s.monthly_revenue) * 100) / 100,
        status: 'active',
      })
    } else {
      newCount++
      toUpsert.push({
        user_id: s.user_id,
        name: s.name,
        company_name: s.company_name,
        first_seen_month: targetMonth,
        last_active_month: targetMonth,
        primary_courier: s.primary_courier,
        lifetime_orders: s.monthly_orders,
        lifetime_revenue: s.monthly_revenue,
        status: 'active',
      })
    }
  }

  await batchUpsert('sellers', toUpsert, { onConflict: 'user_id' })

  // Upsert couriers master list
  const couriersInData = [...new Set(uniqueSellers.map(s => s.primary_courier).filter(Boolean))]
  if (couriersInData.length) {
    await supabase.from('couriers').upsert(
      couriersInData.map(name => ({
        courier_name: name,
        first_seen_month: targetMonth,
        is_b2b: name.toLowerCase().includes('b2b'),
      })),
      { onConflict: 'courier_name', ignoreDuplicates: true }
    )
  }

  return newCount
}

async function computeAndSaveHealthScores(uniqueSellers, targetMonth) {
  const userIds = uniqueSellers.map(s => s.user_id)

  // Fetch last 3 months of seller_monthly — batch to avoid URL overflow
  const allMonthlyRows = []
  for (let i = 0; i < userIds.length; i += 100) {
    const { data, error } = await supabase
      .from('seller_monthly')
      .select('user_id, month, orders, rto_rate, revenue_billed')
      .in('user_id', userIds.slice(i, i + 100))
      .order('month', { ascending: false })
    if (error) throw new Error(`Query seller_monthly for health: ${error.message}`)
    if (data) allMonthlyRows.push(...data)
  }

  // Group by user_id, keep newest 3 months
  const byUser = {}
  for (const row of allMonthlyRows) {
    if (!byUser[row.user_id]) byUser[row.user_id] = []
    if (byUser[row.user_id].length < 3) byUser[row.user_id].push(row)
  }

  const revMap = Object.fromEntries(uniqueSellers.map(s => [s.user_id, s.monthly_revenue]))

  const healthRows = uniqueSellers.map(s => {
    const months = byUser[s.user_id] || []
    const { score, status } = computeHealthScore({ months })
    const revenueAtRisk = (status === 'red' || status === 'amber') ? (revMap[s.user_id] || 0) : 0
    let action = 'Healthy seller — maintain engagement'
    if (status === 'red')   action = 'High risk — contact seller immediately, review RTO issues'
    if (status === 'amber') action = 'Monitor closely — check volume trend and RTO rate'

    return {
      user_id: s.user_id,
      health_score: score,
      risk_level: status,
      volume_trend: computeVolumeTrend(months),
      rto_trend: computeRtoTrend(months),
      months_active: months.length,
      last_3m_avg_orders: months.length
        ? Math.round(months.reduce((a, m) => a + (m.orders || 0), 0) / months.length * 100) / 100
        : 0,
      last_3m_avg_rto_rate: months.length
        ? Math.round(months.reduce((a, m) => a + (m.rto_rate || 0), 0) / months.length * 100) / 100
        : 0,
      revenue_at_risk: revenueAtRisk,
      recommended_action: action,
    }
  })

  await batchUpsert('seller_health', healthRows, { onConflict: 'user_id' })
}

async function generateAndSaveAIBrief(overview, courierMonthly, targetMonth) {
  try {
    const context = {
      month: targetMonth,
      overview,
      topCouriers: courierMonthly.sort((a, b) => b.orders - a.orders).slice(0, 5),
    }
    const content = await generateMonthlyBrief(context)
    await supabase.from('ai_insights').insert({
      month: targetMonth,
      insight_type: 'monthly_brief',
      title: `Monthly Brief — ${targetMonth}`,
      content,
      context_data: context,
      model_used: 'gpt-4.1-mini',
    })
  } catch {
    // AI brief failure is non-fatal — log and continue
    console.warn('AI brief generation failed (non-fatal)')
  }
}

async function writeUploadLog(file, targetMonth, data) {
  const { error } = await supabase.from('upload_log').insert({
    month: targetMonth,
    filename: file.name,
    row_count: data.filteredRowCount,
    order_count: data.overview.total_orders,
    total_revenue: data.overview.total_revenue_billed,
    status: 'success',
  })
  if (error) throw new Error(`Upload log: ${error.message}`)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const [stage, setStage]           = useState('idle')    // idle | preview | uploading | done | error
  const [file, setFile]             = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [preview, setPreview]       = useState(null)      // { targetMonth, rowCount }
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [parseProgress, setParseProgress] = useState(0)
  const [stepState, setStepState]   = useState({})        // { stepId: 'active' | 'done' | 'error' }
  const [currentStepLabel, setCurrentStepLabel] = useState('')
  const [result, setResult]         = useState(null)
  const [errorMsg, setErrorMsg]     = useState('')
  const [uploadHistory, setUploadHistory] = useState([])
  const inputRef = useRef(null)

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    const { data } = await supabase
      .from('upload_log')
      .select('*')
      .order('uploaded_at', { ascending: false })
    setUploadHistory(data ?? [])
  }

  function setStep(id, state) {
    setStepState(prev => ({ ...prev, [id]: state }))
    if (state === 'active') {
      setCurrentStepLabel(STEPS.find(s => s.id === id)?.label ?? '')
    }
  }

  function handleFileChange(e) { selectFile(e.target.files[0]) }
  function handleDrop(e) {
    e.preventDefault(); setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.csv')) selectFile(f)
  }

  function selectFile(f) {
    if (!f) return
    setFile(f)
    setStage('idle')
    setPreview(null)
    setStepState({})
    setErrorMsg('')
  }

  async function handlePreview() {
    if (!file) return
    setStage('preview')
    setParseProgress(0)
    setStep('parse', 'active')

    let rows
    try {
      rows = await parseCSV(file, setParseProgress)
    } catch (e) {
      setErrorMsg(`CSV parse error: ${e.message}`)
      setStage('error'); return
    }
    setStep('parse', 'done')

    // Validate columns
    const headers = Object.keys(rows[0] || {})
    const { valid, missing } = validateColumns(headers)
    if (!valid) {
      setErrorMsg(`Missing columns: ${missing.join(', ')}`)
      setStage('error'); return
    }

    const targetMonth = detectTargetMonth(rows)
    if (!targetMonth) {
      setErrorMsg('Could not detect a target month from Order Date column.')
      setStage('error'); return
    }

    const coverage = getMonthCoverage(rows, targetMonth)

    // Check for duplicate month
    const { data: existing } = await supabase
      .from('upload_log').select('id').eq('month', targetMonth).limit(1)
    const dup = (existing?.length ?? 0) > 0

    setPreview({ targetMonth, rowCount: rows.length, filteredRows: rows, isDuplicate: dup, coverage })
    setIsDuplicate(dup)
    setStage('confirm')
  }

  async function handleUpload(replace = false) {
    const { targetMonth, filteredRows } = preview
    setStage('uploading')
    setStepState({})

    try {
      // Delete existing month data if replacing
      if (replace) await deleteMonthData(targetMonth)

      // Aggregate
      setStep('aggregate', 'active')
      const data = aggregateCSV(filteredRows, targetMonth)
      if (!data || data.filteredRowCount === 0) {
        throw new Error(`No rows found for month ${targetMonth} after filtering.`)
      }
      setStep('aggregate', 'done')

      // Update sellers master
      setStep('sellers', 'active')
      const newSellerCount = await updateSellers(data.uniqueSellers, targetMonth)
      data.overview.new_sellers = newSellerCount
      setStep('sellers', 'done')

      // Batch upsert all tables
      setStep('upsert', 'active')
      await batchUpsert('monthly_overview',    [data.overview],            { onConflict: 'month' })
      await batchUpsert('courier_monthly',     data.courierMonthly,        { onConflict: 'month,courier' })
      await batchUpsert('seller_monthly',      data.sellerMonthly,         { onConflict: 'month,user_id' })
      await batchUpsert('zone_monthly',        data.zoneMonthly,           { onConflict: 'month,zone' })
      await batchUpsert('service_type_monthly',data.serviceTypeMonthly,    { onConflict: 'month,courier,service_type' })
      await batchUpsert('daily_summary',       data.dailySummary,          { onConflict: 'date' })
      await batchUpsert('credit_notes_monthly',data.creditNotesMonthly,    { onConflict: 'month,reason' })
      await batchUpsert('weight_audit_monthly',data.weightAuditMonthly,    { onConflict: 'month,courier' })
      await batchUpsert('price_card_monthly',  data.priceCardMonthly,      { onConflict: 'month,price_card_id' })
      setStep('upsert', 'done')

      // Health scores
      setStep('health', 'active')
      await computeAndSaveHealthScores(data.uniqueSellers, targetMonth)
      setStep('health', 'done')

      // AI brief
      setStep('ai', 'active')
      await generateAndSaveAIBrief(data.overview, data.courierMonthly, targetMonth)
      setStep('ai', 'done')

      // Upload log
      setStep('log', 'active')
      await writeUploadLog(file, targetMonth, data)
      setStep('log', 'done')

      setResult({
        month: targetMonth,
        orders: data.overview.total_orders,
        revenue: data.overview.total_revenue_billed,
        sellers: data.overview.active_sellers,
        newSellers: newSellerCount,
        rtoRate: data.overview.rto_rate,
      })
      setStage('done')
      loadHistory()

    } catch (e) {
      setErrorMsg(e.message || 'Unknown error')
      setStage('error')
    }
  }

  function reset() {
    setFile(null); setStage('idle'); setPreview(null)
    setStepState({}); setResult(null); setErrorMsg('')
    setParseProgress(0)
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Upload Monthly Data</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Upload the monthly CSV export (~600K rows). All processing runs in your browser.
        </p>
      </div>

      {/* ── IDLE: file drop zone ── */}
      {(stage === 'idle' || stage === 'preview') && (
        <>
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={e => { e.preventDefault(); setIsDragging(false) }}
            onDrop={handleDrop}
            onClick={() => !file && inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors select-none
              ${isDragging ? 'border-blue-400 bg-blue-50' :
                file ? 'border-green-400 bg-green-50 cursor-default' :
                'border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50/40 cursor-pointer'}`}
          >
            <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
            {file ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckIcon className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                </div>
                <button onClick={e => { e.stopPropagation(); reset() }}
                  className="text-sm text-gray-400 hover:text-gray-600 underline">Remove</button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <UploadIcon className="w-6 h-6 text-gray-400" />
                </div>
                <div>
                  <p className="font-medium text-gray-700">
                    {isDragging ? 'Drop your CSV here' : 'Drop CSV here or click to browse'}
                  </p>
                  <p className="text-sm text-gray-400 mt-0.5">Only .csv files · 22 expected columns</p>
                </div>
              </div>
            )}
          </div>

          {/* Info cards */}
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            {[
              { label: 'Expected columns', value: '22' },
              { label: 'Typical file size', value: '80–150 MB' },
              { label: 'Processing time', value: '~60 sec' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                <p className="text-gray-400">{label}</p>
                <p className="font-semibold text-gray-800 mt-0.5">{value}</p>
              </div>
            ))}
          </div>

          {file && stage === 'idle' && (
            <button onClick={handlePreview}
              className="mt-6 w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
              Analyse File &rarr;
            </button>
          )}

          {/* Parsing progress */}
          {stage === 'preview' && parseProgress < 100 && (
            <div className="mt-6">
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>Parsing CSV…</span><span>{parseProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${parseProgress}%` }} />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── CONFIRM: show detected month, ask to proceed ── */}
      {stage === 'confirm' && preview && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 text-lg mb-4">Ready to upload</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Stat label="Detected month"    value={fmtMonth(preview.targetMonth)} />
            <Stat label="Total rows in file" value={preview.rowCount.toLocaleString('en-IN')} />
            <Stat label="Rows to be saved"  value={preview.rowCount.toLocaleString('en-IN')} />
            <Stat label="Unparseable dates" value={(preview.coverage?.unparseable ?? 0).toLocaleString('en-IN')} />
          </div>
          {(preview.coverage?.excluded ?? 0) > 0 && (
            <div className="mb-4 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              <strong>{preview.coverage.excluded.toLocaleString('en-IN')} rows</strong> have dates outside {fmtMonth(preview.targetMonth)} — they are still included in the upload.
            </div>
          )}
          {(preview.coverage?.unparseable ?? 0) > 0 && (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <strong>{preview.coverage.unparseable.toLocaleString('en-IN')} rows</strong> have blank or unreadable Order Date and will be skipped.
            </div>
          )}

          {isDuplicate && (
            <div className="mb-4 flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <WarnIcon className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">Month already uploaded</p>
                <p className="text-amber-700 mt-0.5">
                  Data for <strong>{preview.targetMonth}</strong> already exists.
                  Proceeding will delete and replace it.
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => handleUpload(isDuplicate)}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
              {isDuplicate ? 'Replace & Upload' : 'Start Upload'}
            </button>
            <button onClick={reset}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── UPLOADING: step-by-step progress ── */}
      {stage === 'uploading' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-900 text-lg mb-1">Uploading…</h2>
          <p className="text-sm text-gray-500 mb-6">{currentStepLabel}</p>
          <div className="space-y-3">
            {STEPS.map(step => {
              const state = stepState[step.id]
              return (
                <div key={step.id} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                    ${state === 'done'  ? 'bg-green-500' :
                      state === 'active' ? 'bg-blue-500' :
                      state === 'error'  ? 'bg-red-500' :
                      'bg-gray-200'}`}>
                    {state === 'done'   && <CheckIcon className="w-3.5 h-3.5 text-white" />}
                    {state === 'active' && <SpinIcon className="w-3.5 h-3.5 text-white animate-spin" />}
                    {state === 'error'  && <span className="text-white text-xs">!</span>}
                  </div>
                  <span className={`text-sm ${state === 'active' ? 'text-gray-900 font-medium' : state === 'done' ? 'text-gray-500' : 'text-gray-400'}`}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── DONE: success summary ── */}
      {stage === 'done' && result && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <CheckIcon className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Upload complete</h2>
              <p className="text-sm text-gray-500">{result.month}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <Stat label="Total orders"    value={result.orders.toLocaleString()} />
            <Stat label="Revenue billed"  value={`₹${(result.revenue / 100000).toFixed(1)}L`} />
            <Stat label="Active sellers"  value={result.sellers.toLocaleString()} />
            <Stat label="New sellers"     value={result.newSellers.toLocaleString()} />
            <Stat label="RTO rate"        value={`${result.rtoRate}%`} />
          </div>
          <button onClick={reset}
            className="w-full py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm">
            Upload another month
          </button>
        </div>
      )}

      {/* ── ERROR ── */}
      {stage === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="font-semibold text-red-800 mb-2">Upload failed</h2>
          <p className="text-sm text-red-700 font-mono break-all">{errorMsg}</p>
          <button onClick={reset}
            className="mt-4 px-4 py-2 bg-white border border-red-300 text-red-700 rounded-lg hover:bg-red-50 text-sm transition-colors">
            Try again
          </button>
        </div>
      )}

      {/* ── UPLOAD HISTORY ── */}
      {uploadHistory.length > 0 && (
        <div className="mt-10">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Upload History</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide text-left">
                  <th className="px-5 py-3 font-medium">Month</th>
                  <th className="px-5 py-3 font-medium">Uploaded</th>
                  <th className="px-5 py-3 font-medium">File</th>
                  <th className="px-5 py-3 font-medium text-right">Orders</th>
                  <th className="px-5 py-3 font-medium text-right">Revenue</th>
                  <th className="px-5 py-3 font-medium text-right">Rows</th>
                  <th className="px-5 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {uploadHistory.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-gray-800">
                      {fmtMonth(u.month)}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {u.uploaded_at ? new Date(u.uploaded_at).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs max-w-[180px] truncate" title={u.filename}>
                      {u.filename ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700 font-medium">
                      {u.order_count?.toLocaleString('en-IN') ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {u.total_revenue ? `₹${(u.total_revenue / 100000).toFixed(1)}L` : '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500">
                      {u.row_count?.toLocaleString('en-IN') ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                        u.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {u.status ?? 'unknown'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Small UI pieces ───────────────────────────────────────────────────────────

function Stat({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
function UploadIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.522 7.095A4.5 4.5 0 0117.25 19.5H6.75z" />
    </svg>
  )
}
function WarnIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  )
}
function SpinIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
