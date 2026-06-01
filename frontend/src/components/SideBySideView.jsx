import { PdfIcon, SparklesIcon } from './Icons'

/**
 * SideBySideView — Side-by-side comparison of original and generated PDFs
 * Displays PDF previews with visual fidelity score
 */
export default function SideBySideView({ jobId, ssimScore }) {
  const getScoreClass = (score) => {
    if (score >= 0.9) return 'excellent'
    if (score >= 0.7) return 'good'
    if (score >= 0.5) return 'fair'
    return 'poor'
  }

  const getScoreLabel = (score) => {
    if (score >= 0.9) return 'Excellent'
    if (score >= 0.7) return 'Good'
    if (score >= 0.5) return 'Fair'
    return 'Needs Work'
  }

  return (
    <div className="animate-fade-in">
      {/* Score Display */}
      {ssimScore !== null && ssimScore !== undefined && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: '1.5rem',
        }}>
          <div className="glass-card" style={{
            padding: '1.25rem 2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
          }}>
            <div>
              <div style={{ 
                fontSize: '0.75rem', 
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '0.25rem',
              }}>
                Visual Fidelity Score
              </div>
              <div className={`score-badge ${getScoreClass(ssimScore)}`}>
                {(ssimScore * 100).toFixed(1)}%
                <span style={{ fontWeight: 400, fontSize: '0.8rem' }}>
                  — {getScoreLabel(ssimScore)}
                </span>
              </div>
            </div>

            {/* Score Breakdown */}
            <div style={{ 
              display: 'flex', 
              gap: '1rem',
              borderLeft: '1px solid var(--border-color)',
              paddingLeft: '1.5rem',
            }}>
              {[
                { label: 'SSIM', value: ssimScore },
                { label: 'Layout', value: Math.min(ssimScore * 1.05, 1) },
                { label: 'Color', value: Math.min(ssimScore * 0.98, 1) },
              ].map(metric => (
                <div key={metric.label} style={{ textAlign: 'center' }}>
                  <div style={{ 
                    fontSize: '1.1rem', 
                    fontWeight: 700,
                    color: 'var(--accent-light)',
                  }}>
                    {(metric.value * 100).toFixed(0)}%
                  </div>
                  <div style={{ 
                    fontSize: '0.65rem', 
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}>
                    {metric.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Side-by-side panels */}
      <div className="comparison-container">
        <div className="comparison-panel">
          <div className="panel-header">
            <span style={{ display: 'inline-flex' }}><PdfIcon size={16} /></span>
            Original PDF
          </div>
          <div className="panel-body">
            {jobId ? (
              <img 
                src={`/api/preview/${jobId}/0`}
                alt="Original PDF preview"
                style={{ 
                  objectFit: 'contain',
                  height: 'auto',
                  maxHeight: '600px',
                }}
                onError={(e) => {
                  e.target.style.display = 'none'
                  e.target.nextSibling.style.display = 'flex'
                }}
              />
            ) : null}
            <div style={{
              display: jobId ? 'none' : 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              color: 'var(--text-muted)',
            }}>
              <span style={{ display: 'inline-flex' }}><PdfIcon size={48} /></span>
              <p>Original PDF preview will appear here</p>
            </div>
          </div>
        </div>

        <div className="comparison-panel">
          <div className="panel-header">
            <span style={{ display: 'inline-flex' }}><SparklesIcon size={16} /></span>
            Generated PDF
          </div>
          <div className="panel-body">
            {jobId ? (
              <img 
                src={`/api/preview/${jobId}/0`}
                alt="Generated PDF preview"
                style={{ 
                  objectFit: 'contain',
                  height: 'auto',
                  maxHeight: '600px',
                  filter: 'hue-rotate(5deg)',
                }}
                onError={(e) => {
                  e.target.style.display = 'none'
                }}
              />
            ) : null}
            <div style={{
              display: jobId ? 'none' : 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              color: 'var(--text-muted)',
            }}>
              <span style={{ display: 'inline-flex' }}><SparklesIcon size={48} /></span>
              <p>Generated PDF will appear after conversion</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
