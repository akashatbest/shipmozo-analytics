import { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [showPass, setShowPass] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setLoading(true)
    setError('')
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err.message?.includes('Invalid login') || err.message?.includes('invalid_credentials')
        ? 'Incorrect email or password. Please try again.'
        : err.message ?? 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#0f172a' }}>

      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f2044 100%)' }}>

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: '#2563eb' }}>
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0v10l-8 4m-8-4V7m8 4v10" />
            </svg>
          </div>
          <div>
            <p className="text-white font-bold text-lg leading-none">Shipmozo</p>
            <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>Analytics Platform</p>
          </div>
        </div>

        {/* Tagline */}
        <div>
          <h1 className="text-4xl font-bold leading-tight mb-4" style={{ color: '#f8fafc' }}>
            Your shipping data,<br />
            <span style={{ color: '#60a5fa' }}>fully decoded.</span>
          </h1>
          <p className="text-base leading-relaxed" style={{ color: '#64748b' }}>
            Real-time insights across 5,000+ sellers, 9 couriers, and 6 zones.
            From margin leaks to churn risk — all in one place.
          </p>

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-4 mt-10">
            {[
              { label: 'Orders analysed', value: '6L+' },
              { label: 'Couriers tracked', value: '9' },
              { label: 'Sellers monitored', value: '5K+' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl p-4"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <p className="text-2xl font-bold" style={{ color: '#60a5fa' }}>{value}</p>
                <p className="text-xs mt-1" style={{ color: '#475569' }}>{label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs" style={{ color: '#334155' }}>
          Internal ops tool · Shipmozo © 2026
        </p>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12"
        style={{ background: '#f8fafc' }}>
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#2563eb' }}>
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0v10l-8 4m-8-4V7m8 4v10" />
              </svg>
            </div>
            <p className="text-lg font-bold" style={{ color: '#0f172a' }}>Shipmozo Analytics</p>
          </div>

          <h2 className="text-2xl font-bold mb-1" style={{ color: '#0f172a' }}>Welcome back</h2>
          <p className="text-sm mb-8" style={{ color: '#64748b' }}>Sign in to your analytics dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>
                Email ID
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@shipmozo.in"
                required
                autoFocus
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all"
                style={{
                  background: '#fff',
                  border: `1px solid ${error ? '#fca5a5' : '#e2e8f0'}`,
                  color: '#0f172a',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
                onFocus={e => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.1)' }}
                onBlur={e  => { e.target.style.borderColor = error ? '#fca5a5' : '#e2e8f0'; e.target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)' }}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full rounded-xl px-4 py-3 pr-11 text-sm focus:outline-none transition-all"
                  style={{
                    background: '#fff',
                    border: `1px solid ${error ? '#fca5a5' : '#e2e8f0'}`,
                    color: '#0f172a',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                  onFocus={e => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.1)' }}
                  onBlur={e  => { e.target.style.borderColor = error ? '#fca5a5' : '#e2e8f0'; e.target.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)' }}
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors hover:bg-gray-100"
                  style={{ color: '#94a3b8' }}>
                  {showPass
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  }
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading || !email || !password}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 mt-2"
              style={{
                background: loading || !email || !password ? '#93c5fd' : '#2563eb',
                color: '#fff',
                cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
                boxShadow: loading || !email || !password ? 'none' : '0 4px 14px rgba(37,99,235,0.35)',
              }}>
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </>
              ) : 'Sign in →'}
            </button>
          </form>

          {/* Footer hint */}
          <p className="text-center text-xs mt-8" style={{ color: '#94a3b8' }}>
            Access is restricted to authorised Shipmozo team members.
          </p>
        </div>
      </div>
    </div>
  )
}
