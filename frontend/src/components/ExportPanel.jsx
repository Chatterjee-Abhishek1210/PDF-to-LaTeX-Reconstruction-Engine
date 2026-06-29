import { useState } from 'react'
import {
  LaTeXIcon,
  PdfIcon,
  ExportIcon,
  DownloadIcon
} from './Icons'

/**
 * ExportPanel — Download options for LaTeX, PDF, DOCX, and ZIP package.
 * Includes compile-and-download for current edited LaTeX source.
 */
export default function ExportPanel({ jobId, latexCode, compileAndDownloadPdf, compileAndDownloadDocx }) {
  const baseUrl = '/api/export'
  const [compilingPdf, setCompilingPdf] = useState(false)
  const [compilingDocx, setCompilingDocx] = useState(false)
  const [compileError, setCompileError] = useState('')

  const handleCompilePdf = async () => {
    if (!jobId || !latexCode) return
    setCompilingPdf(true)
    setCompileError('')
    try {
      const success = await compileAndDownloadPdf(jobId, latexCode)
      if (!success) {
        setCompileError('PDF compilation failed. Check your LaTeX source for errors.')
      }
    } catch (e) {
      setCompileError(e.message || 'PDF compilation failed')
    } finally {
      setCompilingPdf(false)
    }
  }

  const handleCompileDocx = async () => {
    if (!jobId || !latexCode) return
    setCompilingDocx(true)
    setCompileError('')
    try {
      const success = await compileAndDownloadDocx(jobId, latexCode)
      if (!success) {
        setCompileError('DOCX conversion failed. Pandoc may not be available.')
      }
    } catch (e) {
      setCompileError(e.message || 'DOCX conversion failed')
    } finally {
      setCompilingDocx(false)
    }
  }

  const exports = [
    {
      id: 'compile-pdf',
      icon: <PdfIcon size={40} />,
      label: 'Download as PDF',
      desc: 'Compile current LaTeX & download',
      color: '#e17055',
      isAction: true,
      onClick: handleCompilePdf,
      loading: compilingPdf,
    },
    {
      id: 'compile-docx',
      icon: <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <text x="8" y="17" fontSize="6" fill="currentColor" stroke="none" fontWeight="bold">W</text>
      </svg>,
      label: 'Download as Word',
      desc: 'Convert LaTeX → DOCX via Pandoc',
      color: '#0984e3',
      isAction: true,
      onClick: handleCompileDocx,
      loading: compilingDocx,
    },
    {
      id: 'tex',
      icon: <LaTeXIcon size={40} />,
      label: 'LaTeX Source',
      desc: '.tex file with all formatting',
      url: `${baseUrl}/tex/${jobId}`,
      color: '#6c5ce7',
    },
    {
      id: 'pdf',
      icon: <PdfIcon size={40} />,
      label: 'Original Compiled PDF',
      desc: 'From initial conversion',
      url: `${baseUrl}/pdf/${jobId}`,
      color: '#fd79a8',
    },
    {
      id: 'zip',
      icon: <ExportIcon size={40} />,
      label: 'Full Package',
      desc: 'ZIP with .tex, images & PDF',
      url: `${baseUrl}/zip/${jobId}`,
      color: '#00b894',
    },
    {
      id: 'original',
      icon: <PdfIcon size={40} />,
      label: 'Original PDF',
      desc: 'Download source document',
      url: `${baseUrl}/original/${jobId}`,
      color: '#74b9ff',
    },
  ]

  const handleDownload = (url) => {
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.click()
  }

  if (!jobId) return null

  return (
    <div className="animate-fade-in">
      <div className="section-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ExportIcon size={24} />
          Export
        </h2>
        <p>Download your converted files — compile current edits to PDF or Word</p>
      </div>

      {compileError && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.75rem 1rem',
          background: 'rgba(225, 112, 85, 0.1)',
          border: '1px solid rgba(225, 112, 85, 0.3)',
          borderRadius: '8px',
          color: 'var(--danger)',
          fontSize: '0.85rem',
        }}>
          ⚠ {compileError}
        </div>
      )}

      <div className="export-grid">
        {exports.map((item) => (
          <div
            key={item.id}
            className={`export-card ${item.isAction ? 'export-card-primary' : ''}`}
            onClick={() => {
              if (item.isAction) {
                item.onClick?.()
              } else {
                handleDownload(item.url)
              }
            }}
            role="button"
            tabIndex={0}
            id={`export-${item.id}-btn`}
            style={item.loading ? { opacity: 0.7, pointerEvents: 'none' } : {}}
          >
            <div className="export-icon" style={{ display: 'inline-flex', justifyContent: 'center', color: item.color }}>
              {item.icon}
            </div>
            <div className="export-label">{item.label}</div>
            <div className="export-desc">{item.desc}</div>
            <div style={{
              marginTop: '0.5rem',
              padding: '0.3rem 1rem',
              background: `${item.color}22`,
              color: item.color,
              borderRadius: '20px',
              fontSize: '0.75rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}>
              {item.loading ? (
                <>
                  <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }}></span>
                  Compiling...
                </>
              ) : (
                <>
                  <DownloadIcon size={12} />
                  {item.isAction ? 'Compile & Download' : 'Download'}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
