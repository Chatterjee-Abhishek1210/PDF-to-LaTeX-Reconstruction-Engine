import { useState, useEffect } from 'react'
import './index.css'
import { useConversion } from './hooks/useConversion'
import UploadZone from './components/UploadZone'
import ConversionProgress from './components/ConversionProgress'
import LaTeXEditor from './components/LaTeXEditor'
import ThemeToggle from './components/ThemeToggle'
import {
  UploadIcon,
  LightningIcon,
  LaTeXIcon,
  ColorIcon,
  TypographyIcon,
  LayoutIcon,
  TableIcon,
  EquationIcon,
  ImageIcon,
  FailedIcon,
  RefreshIcon
} from './components/Icons'

/**
 * Main Application — PDF-to-LaTeX Reconstruction Engine
 * Premium, modern UI with dark/light mode and glassmorphism design
 */
export default function App() {
  const [activeTab, setActiveTab] = useState(() => {
    // Restore active tab from session safely
    try {
      const saved = localStorage.getItem('pdf2latex-active-tab');
      return ['upload', 'progress', 'editor'].includes(saved) ? saved : 'upload';
    } catch (e) {
      return 'upload'
    }
  })
  const conversion = useConversion()
  const [editedCode, setEditedCode] = useState('')

  // Persist active tab safely
  useEffect(() => {
    try {
      localStorage.setItem('pdf2latex-active-tab', activeTab)
    } catch (e) {
      console.warn('Failed to save tab state', e)
    }
  }, [activeTab])

  const handleFileSelect = async (file) => {
    await conversion.uploadAndConvert(file)
    setActiveTab('progress')
  }

  const [visualFinished, setVisualFinished] = useState(false)

  useEffect(() => {
    if (conversion.status !== 'complete') {
      setVisualFinished(false)
    }
  }, [conversion.status])

  useEffect(() => {
    if (conversion.latexCode) {
      setEditedCode(conversion.latexCode)
    }
  }, [conversion.latexCode])

  // On mount: if session was restored with complete status, go to editor
  useEffect(() => {
    if (conversion.status === 'complete' && conversion.latexCode && activeTab === 'upload') {
      setActiveTab('editor')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-switch to results when complete and visual animation is finished
  if (conversion.status === 'complete' && visualFinished && activeTab === 'progress') {
    setActiveTab('editor')
  }

  if (activeTab === 'editor' && (conversion.latexCode || editedCode)) {
    return (
      <LaTeXEditor
        code={editedCode || conversion.latexCode}
        onCodeChange={setEditedCode}
        jobId={conversion.jobId}
        onReset={() => {
          conversion.reset()
          setEditedCode('')
          setActiveTab('upload')
        }}
        saveToBackend={conversion.saveToBackend}
        loadFromBackend={conversion.loadFromBackend}
        compileAndDownloadPdf={conversion.compileAndDownloadPdf}
        compileAndDownloadDocx={conversion.compileAndDownloadDocx}
      />
    )
  }

  const tabs = [
    { id: 'upload', label: 'Upload', icon: <UploadIcon /> },
    { id: 'progress', label: 'Progress', icon: <LightningIcon />, show: conversion.status !== 'idle' },
    { id: 'editor', label: 'Live Editor', icon: <LaTeXIcon />, show: Boolean(conversion.latexCode) },
  ]


  return (
    <>
      {/* Background effects */}
      <div className="bg-grid" />
      <div className="bg-orbs" />

      {/* Navbar */}
      <nav className="navbar">
        <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="logo-icon" style={{ display: 'inline-flex' }}>
            <LightningIcon size={18} />
          </span>
          PDF → LaTeX
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {/* Tab Navigation */}
          <div className="tab-nav">
            {tabs.filter(t => t.show !== false).map(tab => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                id={`tab-${tab.id}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span style={{ display: 'inline-flex' }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <ThemeToggle />
        </div>
      </nav>

      {/* Main Content */}
      <main style={{
        flex: 1,
        maxWidth: '1400px',
        width: '100%',
        margin: '0 auto',
        padding: '2rem',
      }}>
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="animate-slide-up" style={{ maxWidth: '800px', margin: '0 auto' }}>
            {/* Hero Section */}
            <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
              <h1 style={{
                fontSize: '3rem',
                fontWeight: 900,
                lineHeight: 1.1,
                marginBottom: '1rem',
                letterSpacing: '-0.03em',
              }}>
                <span style={{
                  background: 'var(--gradient-primary)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  AI-Powered
                </span>
                <br />
                PDF to LaTeX
              </h1>
              <p style={{
                fontSize: '1.15rem',
                color: 'var(--text-secondary)',
                maxWidth: '600px',
                margin: '0 auto 2rem',
                lineHeight: 1.6,
              }}>
                Transform any PDF into production-quality LaTeX code with 
                near pixel-perfect visual fidelity. Colors, fonts, layouts, 
                tables, equations — all preserved.
              </p>

              {/* Feature badges */}
              <div style={{
                display: 'flex',
                gap: '0.75rem',
                justifyContent: 'center',
                flexWrap: 'wrap',
                marginBottom: '2rem',
              }}>
                {[
                  { icon: <ColorIcon size={14} />, label: 'Exact Colors' },
                  { icon: <TypographyIcon size={14} />, label: 'Typography' },
                  { icon: <LayoutIcon size={14} />, label: 'Layout Fidelity' },
                  { icon: <TableIcon size={14} />, label: 'Tables' },
                  { icon: <EquationIcon size={14} />, label: 'Equations' },
                  { icon: <ImageIcon size={14} />, label: 'Images' },
                ].map(feat => (
                  <span key={feat.label} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.5rem 1rem',
                    background: 'var(--gradient-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '24px',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: 'var(--text-primary)',
                  }}>
                    <span style={{ display: 'inline-flex' }}>{feat.icon}</span> {feat.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Upload Zone */}
            <UploadZone 
              onFileSelect={handleFileSelect}
              disabled={conversion.status === 'processing' || conversion.status === 'uploading'}
            />

            {/* Error message */}
            {conversion.error && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                background: 'rgba(225, 112, 85, 0.1)',
                border: '1px solid rgba(225, 112, 85, 0.3)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--danger)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <FailedIcon size={16} />
                {conversion.error}
              </div>
            )}

            {/* Stats */}
            <div className="stat-grid" style={{ marginTop: '3rem' }}>
              {[
                { value: '99%', label: 'Layout Accuracy' },
                { value: '50+', label: 'LaTeX Packages' },
                { value: '< 30s', label: 'Avg. Processing' },
                { value: 'SSIM', label: 'Fidelity Engine' },
              ].map(stat => (
                <div key={stat.label} className="stat-card">
                  <div className="stat-value">{stat.value}</div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progress Tab */}
        {activeTab === 'progress' && (
          <div style={{ maxWidth: '600px', margin: '0 auto' }}>
            <ConversionProgress
              status={conversion.status}
              progress={conversion.progress}
              message={conversion.message}
              onVisualComplete={() => setVisualFinished(true)}
            />

            {conversion.status === 'complete' && visualFinished && (
              <div style={{ 
                textAlign: 'center', 
                marginTop: '1.5rem',
                display: 'flex',
                gap: '1rem',
                justifyContent: 'center',
              }}>
                <button 
                  className="btn-primary" 
                  onClick={() => setActiveTab('editor')}
                  id="view-latex-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <LaTeXIcon size={16} />
                  View LaTeX Code
                </button>
              </div>
            )}

            {conversion.status === 'failed' && (
              <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                <button 
                  className="btn-primary" 
                  onClick={() => { conversion.reset(); setActiveTab('upload') }}
                  id="try-again-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <RefreshIcon size={16} />
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Editor Fallback / Loading State */}
        {activeTab === 'editor' && !(conversion.latexCode || editedCode) && (
          <div style={{ textAlign: 'center', marginTop: '5rem', color: 'var(--text-muted)' }}>
            {conversion.jobId ? (
              <>
                <span className="btn-spinner" style={{ width: '32px', height: '32px', borderTopColor: 'var(--accent-light)', borderWidth: '3px', marginBottom: '1rem' }}></span>
                <div>Restoring editor session...</div>
              </>
            ) : (
              <div>
                <p style={{ marginBottom: '1rem' }}>No active document found.</p>
                <button className="btn-primary" onClick={() => setActiveTab('upload')}>
                  Go to Upload
                </button>
              </div>
            )}
          </div>
        )}

        {/* LaTeX Editor Tab is handled by early return for full viewport experience */}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '2rem',
        color: 'var(--text-muted)',
        fontSize: '0.8rem',
        borderTop: '1px solid var(--border-color)',
      }}>
        <p>
          PDF-to-LaTeX Reconstruction Engine • Powered by AI • 
          PyMuPDF • FastAPI • React
        </p>
      </footer>
    </>
  )
}
