import {
  LaTeXIcon,
  PdfIcon,
  ExportIcon
} from './Icons'

/**
 * ExportPanel — Download options for LaTeX, PDF, and ZIP package
 */
export default function ExportPanel({ jobId }) {
  const baseUrl = '/api/export'

  const exports = [
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
      label: 'Compiled PDF',
      desc: 'Generated PDF output',
      url: `${baseUrl}/pdf/${jobId}`,
      color: '#e17055',
    },
    {
      id: 'docx',
      icon: <LaTeXIcon size={40} />,
      label: 'Word Document',
      desc: 'Generated Word (.docx)',
      url: `${baseUrl}/docx/${jobId}`,
      color: '#0984e3',
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
        <p>Download your converted files</p>
      </div>

      <div className="export-grid">
        {exports.map((item) => (
          <div
            key={item.id}
            className="export-card"
            onClick={() => handleDownload(item.url)}
            role="button"
            tabIndex={0}
            id={`export-${item.id}-btn`}
          >
            <div className="export-icon" style={{ display: 'inline-flex', justifyContent: 'center' }}>{item.icon}</div>
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
            }}>
              Download
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
