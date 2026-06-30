import { useState, useEffect } from 'react'
import {
  UploadIcon,
  SearchIcon,
  BrainIcon,
  SettingsIcon,
  LaTeXIcon,
  CompareIcon,
  CheckIcon,
  LightningIcon,
  FailedIcon,
  SparklesIcon
} from './Icons'

/**
 * ConversionProgress — Real-time conversion progress display
 * Shows step-by-step pipeline status with animated progress bar.
 * Enforces a minimum 1 second duration per step for a smoother and
 * more readable user experience.
 */
export default function ConversionProgress({ status, progress, message, onVisualComplete }) {
  const steps = [
    { id: 'upload', label: 'Upload', icon: <UploadIcon size={18} />, desc: 'PDF received' },
    { id: 'parsing', label: 'Parsing', icon: <SearchIcon size={18} />, desc: 'Analyzing document structure' },
    { id: 'analyzing', label: 'Analyzing', icon: <BrainIcon size={18} />, desc: 'AI processing layout & content' },
    { id: 'generating', label: 'Generating', icon: <SettingsIcon size={18} />, desc: 'Creating LaTeX code' },
    { id: 'compiling', label: 'Compiling', icon: <LaTeXIcon size={18} />, desc: 'Building output PDF' },
    { id: 'comparing', label: 'Comparing', icon: <CompareIcon size={18} />, desc: 'Measuring visual fidelity' },
    { id: 'complete', label: 'Complete', icon: <CheckIcon size={18} />, desc: 'Ready to download' },
  ]

  const statusOrder = ['upload', 'parsing', 'analyzing', 'generating', 'compiling', 'comparing', 'complete']
  const stepProgressValues = [15, 30, 50, 70, 85, 95, 100]

  const getParentStatusIndex = (s) => {
    if (s === 'uploading' || s === 'uploaded') return 0
    if (s === 'processing') return 1
    if (s === 'failed') return -2
    const idx = statusOrder.indexOf(s)
    return idx !== -1 ? idx : 0
  }

  const [visualIdx, setVisualIdx] = useState(() => {
    return status === 'idle' || status === 'uploading' ? 0 : getParentStatusIndex(status)
  })
  const [visualProgress, setVisualProgress] = useState(() => {
    if (status === 'idle' || status === 'uploading') return 0
    if (status === 'failed') return progress
    const target = getParentStatusIndex(status)
    return target >= 0 ? stepProgressValues[target] : 0
  })

  // Reset visual state when starting/uploading a new file
  useEffect(() => {
    if (status === 'idle' || status === 'uploading') {
      setVisualIdx(0)
      setVisualProgress(0)
    }
  }, [status])

  const targetIdx = getParentStatusIndex(status)

  // Step advancement timer: spend at least 1000ms at each step
  useEffect(() => {
    if (status === 'failed') return

    if (visualIdx < targetIdx) {
      const timer = setTimeout(() => {
        setVisualIdx(prev => prev + 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else if (visualIdx === 6 && status === 'complete') {
      if (onVisualComplete) {
        onVisualComplete()
      }
    }
  }, [visualIdx, targetIdx, status, onVisualComplete])

  // Smooth easing animation for progress bar and percentage
  const targetProgress = status === 'failed' ? progress : stepProgressValues[visualIdx]
  useEffect(() => {
    let animationFrameId

    const animate = () => {
      setVisualProgress(prev => {
        if (prev < targetProgress) {
          const stepSize = Math.max((targetProgress - prev) * 0.1, 0.2)
          const next = prev + stepSize
          if (next >= targetProgress) return targetProgress
          return next
        } else if (prev > targetProgress) {
          return targetProgress
        }
        return prev
      })
      animationFrameId = requestAnimationFrame(animate)
    }

    animate()
    return () => cancelAnimationFrame(animationFrameId)
  }, [targetProgress])

  const getStepState = (stepId) => {
    const stepIdx = statusOrder.indexOf(stepId)

    if (stepIdx < visualIdx) return 'complete'
    if (stepIdx === visualIdx) {
      return status === 'failed' ? 'failed' : 'active'
    }
    return 'pending'
  }

  const currentStep = steps[visualIdx] || steps[0]
  const displayMessage = status === 'complete' && visualIdx === 6
    ? 'Conversion complete!'
    : status === 'failed'
    ? message || 'Conversion failed'
    : currentStep.desc

  return (
    <div className="glass-card animate-slide-up" style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ 
          fontSize: '1.1rem', 
          fontWeight: 700, 
          marginBottom: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          {status === 'failed' ? <FailedIcon size={18} /> : (visualIdx === 6 ? <SparklesIcon size={18} /> : <LightningIcon size={18} />)} 
          Conversion Progress
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
          {displayMessage}
        </p>
      </div>

      {/* Progress Bar */}
      <div className="progress-container" style={{ marginBottom: '2rem' }}>
        <div 
          className="progress-bar" 
          style={{ 
            width: `${visualProgress}%`,
            background: status === 'failed' 
              ? 'linear-gradient(135deg, #e17055, #d63031)' 
              : 'var(--gradient-primary)',
          }} 
        />
      </div>

      {/* Progress percentage */}
      <div style={{ 
        textAlign: 'center', 
        marginBottom: '1.5rem',
        fontSize: '2rem',
        fontWeight: 800,
        background: 'var(--gradient-primary)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {Math.round(visualProgress)}%
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {steps.map((step) => {
          const stepState = getStepState(step.id)
          return (
            <div key={step.id} className={`status-step ${stepState}`}>
              <div className="step-icon" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {stepState === 'complete' ? <CheckIcon size={18} /> : step.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ 
                  fontWeight: 600, 
                  fontSize: '0.9rem',
                  color: stepState === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
                }}>
                  {step.label}
                </div>
                <div style={{ 
                  fontSize: '0.75rem', 
                  color: 'var(--text-muted)',
                }}>
                  {step.desc}
                </div>
              </div>
              {stepState === 'active' && (
                <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
