import { useState, useEffect } from 'react'
import { supabase, fetchAllPaged } from '../lib/supabase'
import { fmtNum } from '../lib/chartConfig'
import { PageHeader, Spinner } from './ui'

export default function BranchManagement() {
  const [branches, setBranches]       = useState([])
  const [spocMap, setSpocMap]         = useState({})   // spoc_name → branch_id
  const [spocStats, setSpocStats]     = useState({})   // spoc_name → { sellers, orders }
  const [allSpocs, setAllSpocs]       = useState([])   // unique SPOC names
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)

  // Branch form state
  const [showForm, setShowForm]       = useState(false)
  const [editId, setEditId]           = useState(null)
  const [formName, setFormName]       = useState('')
  const [formCity, setFormCity]       = useState('')
  const [formError, setFormError]     = useState('')

  // SPOC assignment draft (local changes before save)
  const [draft, setDraft]             = useState({})   // spoc_name → branch_id | null
  const [spocSearch, setSpocSearch]   = useState('')
  const [saveMsg, setSaveMsg]         = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: br }, { data: sbm }, teamRows, smRows] = await Promise.all([
      supabase.from('branches').select('*').order('name'),
      supabase.from('spoc_branch_map').select('spoc_name,branch_id'),
      fetchAllPaged(() => supabase.from('seller_team').select('user_id,spoc')),
      // get latest month's orders for stats
      supabase.from('monthly_overview').select('month').order('month', { ascending: false }).limit(1)
        .then(async ({ data }) => {
          if (!data?.[0]) return []
          return fetchAllPaged(() =>
            supabase.from('seller_monthly').select('user_id,orders').eq('month', data[0].month)
          )
        }),
    ])

    setBranches(br ?? [])

    // Build SPOC → branch_id map
    const map = {}
    for (const r of sbm ?? []) map[r.spoc_name] = r.branch_id
    setSpocMap(map)
    setDraft({ ...map })

    // Build SPOC stats: sellers count and orders
    const orderMap = Object.fromEntries((smRows ?? []).map(r => [r.user_id, r.orders ?? 0]))
    const stats = {}
    for (const t of teamRows) {
      if (!t.spoc) continue
      if (!stats[t.spoc]) stats[t.spoc] = { sellers: 0, orders: 0 }
      stats[t.spoc].sellers++
      stats[t.spoc].orders += orderMap[t.user_id] ?? 0
    }
    setSpocStats(stats)
    setAllSpocs(Object.keys(stats).sort())
    setLoading(false)
  }

  // ── Branch CRUD ─────────────────────────────────────────────────────────────

  function openNewForm() {
    setEditId(null); setFormName(''); setFormCity(''); setFormError(''); setShowForm(true)
  }
  function openEditForm(b) {
    setEditId(b.id); setFormName(b.name); setFormCity(b.city ?? ''); setFormError(''); setShowForm(true)
  }
  function cancelForm() { setShowForm(false); setFormError('') }

  async function saveBranch() {
    if (!formName.trim()) { setFormError('Branch name is required'); return }
    setFormError('')
    if (editId) {
      const { error } = await supabase.from('branches').update({ name: formName.trim(), city: formCity.trim() || null }).eq('id', editId)
      if (error) { setFormError(error.message); return }
    } else {
      const { error } = await supabase.from('branches').insert({ name: formName.trim(), city: formCity.trim() || null })
      if (error) { setFormError(error.message); return }
    }
    setShowForm(false)
    loadAll()
  }

  async function deleteBranch(b) {
    if (!confirm(`Delete branch "${b.name}"? SPOCs assigned to it will become unassigned.`)) return
    await supabase.from('branches').delete().eq('id', b.id)
    loadAll()
  }

  // ── SPOC Assignment ──────────────────────────────────────────────────────────

  async function saveAssignments() {
    setSaving(true)
    setSaveMsg('')
    const rows = Object.entries(draft)
      .filter(([, branchId]) => branchId !== null && branchId !== undefined)
      .map(([spoc_name, branch_id]) => ({ spoc_name, branch_id }))

    // Upsert assigned
    if (rows.length) {
      const { error } = await supabase.from('spoc_branch_map').upsert(rows, { onConflict: 'spoc_name' })
      if (error) { setSaveMsg(`Error: ${error.message}`); setSaving(false); return }
    }

    // Delete unassigned ones
    const unassigned = Object.entries(draft).filter(([, v]) => !v).map(([k]) => k)
    if (unassigned.length) {
      await supabase.from('spoc_branch_map').delete().in('spoc_name', unassigned)
    }

    setSpocMap({ ...draft })
    setSaveMsg(`Saved! ${rows.length} SPOCs assigned.`)
    setSaving(false)
    setTimeout(() => setSaveMsg(''), 3000)
  }

  const filteredSpocs = allSpocs.filter(s =>
    !spocSearch || s.toLowerCase().includes(spocSearch.toLowerCase())
  )
  const changedCount = Object.keys(draft).filter(k => draft[k] !== spocMap[k]).length

  if (loading) return <Spinner />

  return (
    <div>
      <PageHeader title="Branch Management" subtitle="Create branches and assign SPOCs to them" />

      {/* ── Branches Section ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold" style={{ color:'var(--color-text-primary)' }}>
          Branches <span className="text-sm font-normal ml-1" style={{ color:'var(--color-text-muted)' }}>({branches.length})</span>
        </h2>
        <button onClick={openNewForm}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all"
          style={{ background:'var(--color-primary)' }}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Branch
        </button>
      </div>

      {/* Inline add/edit form */}
      {showForm && (
        <div className="rounded-xl p-5 mb-4"
          style={{ background:'rgba(37,99,235,0.04)', border:'1px solid rgba(37,99,235,0.2)' }}>
          <p className="text-sm font-semibold mb-3" style={{ color:'var(--color-text-primary)' }}>
            {editId ? 'Edit Branch' : 'New Branch'}
          </p>
          <div className="flex gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color:'var(--color-text-muted)' }}>Branch Name *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Delhi North" autoFocus
                className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 w-52"
                style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-primary)' }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color:'var(--color-text-muted)' }}>City</label>
              <input value={formCity} onChange={e => setFormCity(e.target.value)}
                placeholder="e.g. New Delhi"
                className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 w-44"
                style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-primary)' }} />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={saveBranch}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background:'var(--color-primary)' }}>
                {editId ? 'Update' : 'Create'}
              </button>
              <button onClick={cancelForm}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-slate-100"
                style={{ border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
          {formError && <p className="text-xs text-red-600 mt-2">{formError}</p>}
        </div>
      )}

      {/* Branches table */}
      {branches.length === 0 ? (
        <div className="rounded-xl p-8 text-center mb-8"
          style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
          <p className="font-medium" style={{ color:'var(--color-text-primary)' }}>No branches yet</p>
          <p className="text-sm mt-1" style={{ color:'var(--color-text-muted)' }}>Create your first branch above</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden mb-8"
          style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background:'var(--color-surface-2)', borderBottom:'1px solid var(--color-border-2)' }}>
                {['Branch Name','City','SPOCs Assigned','Sellers',''].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-left"
                    style={{ color:'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor:'var(--color-border-2)' }}>
              {branches.map(b => {
                const assignedSpocs = allSpocs.filter(s => spocMap[s] === b.id)
                const totalSellers  = assignedSpocs.reduce((a, s) => a + (spocStats[s]?.sellers ?? 0), 0)
                return (
                  <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ background:`hsl(${(b.name.charCodeAt(0)*41)%360},60%,50%)` }}>
                          {b.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold" style={{ color:'var(--color-text-primary)' }}>{b.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color:'var(--color-text-secondary)' }}>{b.city || '—'}</td>
                    <td className="px-5 py-3">
                      {assignedSpocs.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {assignedSpocs.slice(0,4).map(s => (
                            <span key={s} className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background:'rgba(37,99,235,0.08)', color:'var(--color-primary)', border:'1px solid rgba(37,99,235,0.15)' }}>
                              {s}
                            </span>
                          ))}
                          {assignedSpocs.length > 4 && (
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ color:'var(--color-text-muted)', border:'1px solid var(--color-border)' }}>
                              +{assignedSpocs.length-4} more
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color:'var(--color-text-muted)' }}>No SPOCs assigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm font-medium" style={{ color:'var(--color-text-secondary)' }}>
                      {fmtNum(totalSellers)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => openEditForm(b)}
                          className="text-xs px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                          style={{ border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>
                          Edit
                        </button>
                        <button onClick={() => deleteBranch(b)}
                          className="text-xs px-3 py-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"
                          style={{ border:'1px solid var(--color-border)', color:'var(--color-text-muted)' }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SPOC Assignment Section ── */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color:'var(--color-text-primary)' }}>
            Assign SPOCs to Branches
          </h2>
          <p className="text-xs mt-0.5" style={{ color:'var(--color-text-muted)' }}>
            {allSpocs.length} SPOCs found in your seller mappings
          </p>
        </div>
        <div className="flex items-center gap-3">
          {changedCount > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background:'rgba(245,158,11,0.1)', color:'#d97706', border:'1px solid rgba(245,158,11,0.2)' }}>
              {changedCount} unsaved change{changedCount > 1 ? 's' : ''}
            </span>
          )}
          {saveMsg && (
            <span className="text-xs font-medium text-emerald-600">{saveMsg}</span>
          )}
          <button onClick={saveAssignments} disabled={saving || changedCount === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ background:'var(--color-primary)' }}>
            {saving ? 'Saving…' : 'Save Assignments'}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input value={spocSearch} onChange={e => setSpocSearch(e.target.value)}
          placeholder="Search SPOC name…"
          className="rounded-lg px-4 py-2 text-sm focus:outline-none w-72"
          style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-primary)' }} />
      </div>

      {allSpocs.length === 0 ? (
        <div className="rounded-xl p-8 text-center"
          style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
          <p className="font-medium" style={{ color:'var(--color-text-primary)' }}>No SPOCs found</p>
          <p className="text-sm mt-1" style={{ color:'var(--color-text-muted)' }}>Upload a team mapping CSV first</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden"
          style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background:'var(--color-surface-2)', borderBottom:'1px solid var(--color-border-2)' }}>
                {['SPOC Name','Sellers','Orders (latest month)','Assigned Branch'].map(h => (
                  <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-left"
                    style={{ color:'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor:'var(--color-border-2)' }}>
              {filteredSpocs.map(spoc => {
                const stats   = spocStats[spoc] ?? { sellers: 0, orders: 0 }
                const current = draft[spoc] ?? ''
                const changed = draft[spoc] !== spocMap[spoc]
                return (
                  <tr key={spoc} className={`transition-colors ${changed ? 'bg-amber-50/40' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-3">
                      <span className="font-semibold text-sm" style={{ color:'var(--color-text-primary)' }}>{spoc}</span>
                      {changed && <span className="ml-2 text-xs text-amber-600 font-medium">● unsaved</span>}
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color:'var(--color-text-secondary)' }}>{fmtNum(stats.sellers)}</td>
                    <td className="px-5 py-3 text-sm" style={{ color:'var(--color-text-secondary)' }}>{fmtNum(stats.orders)}</td>
                    <td className="px-5 py-3">
                      <select value={current}
                        onChange={e => setDraft(d => ({ ...d, [spoc]: e.target.value ? parseInt(e.target.value) : null }))}
                        className="rounded-lg px-3 py-1.5 text-sm focus:outline-none cursor-pointer"
                        style={{
                          background: current ? 'rgba(37,99,235,0.06)' : 'var(--color-surface)',
                          border: `1px solid ${current ? 'rgba(37,99,235,0.25)' : 'var(--color-border)'}`,
                          color: current ? 'var(--color-primary)' : 'var(--color-text-muted)',
                          minWidth: 180,
                        }}>
                        <option value="">— Unassigned —</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>{b.name}{b.city ? ` (${b.city})` : ''}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
