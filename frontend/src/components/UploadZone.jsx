import { useState, useCallback, useRef } from 'react'
import { PdfIcon, CompareIcon } from './Icons'

/**
 * UploadZone — Drag-and-drop PDF upload component
 * Premium glassmorphism design with micro-animations
 */
export default function UploadZone({ onFileSelect, disabled }) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const inputRef = useRef(null)

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setIsDragging(true)
  }, [disabled])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (disabled) return

    const files = Array.from(e.dataTransfer.files)
    const pdfFile = files.find(f => f.name.toLowerCase().endsWith('.pdf'))

    if (pdfFile) {
      setSelectedFile(pdfFile)
      onFileSelect(pdfFile)
    }
  }, [disabled, onFileSelect])

  const handleClick = () => {
    if (!disabled) inputRef.current?.click()
  }

  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      onFileSelect(file)
    }
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        onChange={handleChange}
        style={{ display: 'none' }}
        id="pdf-upload-input"
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {selectedFile ? (
          <div className="animate-fade-in">
            <div className="upload-icon" style={{ display: 'flex', justifyContent: 'center' }}>
              <PdfIcon size={64} />
            </div>
            <h3 style={{ 
              fontSize: '1.25rem', 
              fontWeight: 700, 
              marginBottom: '0.5rem',
              color: 'var(--accent-light)',
            }}>
              {selectedFile.name}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {formatSize(selectedFile.size)}
            </p>
            <p style={{ 
              color: 'var(--success)', 
              marginTop: '1rem',
              fontWeight: 600,
              fontSize: '0.85rem',
            }}>
              ✓ Ready to convert
            </p>
          </div>
        ) : (
          <>
            <div className="upload-icon" style={{ display: 'flex', justifyContent: 'center' }}>
              <CompareIcon size={64} />
            </div>
            <h3 style={{ 
              fontSize: '1.5rem', 
              fontWeight: 700, 
              marginBottom: '0.5rem',
              background: 'var(--gradient-primary)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              Drop your PDF here
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              or click to browse — supports any PDF up to 100MB
            </p>
            <div style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}>
              {['Research Papers', 'Books', 'Reports', 'Resumes', 'Journals'].map(type => (
                <span
                  key={type}
                  style={{
                    padding: '0.35rem 0.75rem',
                    background: 'rgba(108, 92, 231, 0.1)',
                    border: '1px solid rgba(108, 92, 231, 0.2)',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    color: 'var(--accent-light)',
                  }}
                >
                  {type}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
