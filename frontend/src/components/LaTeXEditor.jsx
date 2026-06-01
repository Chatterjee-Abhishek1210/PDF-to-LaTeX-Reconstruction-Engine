import { useState, useRef, useEffect } from 'react'
import {
  LaTeXIcon,
  CheckIcon,
  ClipboardIcon,
  DownloadIcon
} from './Icons'

/**
 * LaTeXEditor — Syntax-highlighted LaTeX code editor
 * With copy, download, and edit capabilities
 */
export default function LaTeXEditor({ code, onCodeChange, jobId }) {
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef(null)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const textarea = document.createElement('textarea')
      textarea.value = code
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'application/x-tex' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'output.tex'
    a.click()
    URL.revokeObjectURL(url)
  }

  const lineCount = code ? code.split('\n').length : 0
  const charCount = code ? code.length : 0

  return (
    <div className="glass-card animate-fade-in" style={{ overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        background: 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          <span style={{ display: 'inline-flex' }}><LaTeXIcon size={16} /></span>
          <span style={{
            fontWeight: 600,
            fontSize: '0.85rem',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-secondary)',
          }}>
            LaTeX Source
          </span>
          <span style={{
            padding: '0.2rem 0.5rem',
            background: 'rgba(108, 92, 231, 0.15)',
            borderRadius: '4px',
            fontSize: '0.7rem',
            color: 'var(--accent-light)',
          }}>
            {lineCount} lines • {charCount.toLocaleString()} chars
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-secondary"
            onClick={handleCopy}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            id="copy-latex-btn"
          >
            {copied ? <CheckIcon size={14} /> : <ClipboardIcon size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            className="btn-secondary"
            onClick={handleDownload}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            id="download-tex-btn"
          >
            <DownloadIcon size={14} />
            Download .tex
          </button>
        </div>
      </div>

      {/* Editor */}
      <div style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '50px',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          overflow: 'hidden',
          padding: '1rem 0',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85rem',
          lineHeight: '1.7',
          color: 'var(--text-muted)',
          textAlign: 'right',
          paddingRight: '8px',
          userSelect: 'none',
        }}>
          {code && code.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          className="code-editor"
          value={code || '% LaTeX code will appear here after conversion...'}
          onChange={(e) => onCodeChange?.(e.target.value)}
          spellCheck={false}
          style={{
            paddingLeft: '60px',
            border: 'none',
            borderRadius: 0,
            minHeight: '500px',
          }}
          id="latex-editor-textarea"
        />
      </div>
    </div>
  )
}
