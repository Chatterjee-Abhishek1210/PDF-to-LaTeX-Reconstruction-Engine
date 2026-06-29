import { useState, useCallback, useRef, useEffect } from 'react'

const STORAGE_KEY_JOB = 'pdf2latex-job-id'
const STORAGE_KEY_CODE = 'pdf2latex-latex-code'
const STORAGE_KEY_STATUS = 'pdf2latex-status'

/**
 * Custom hook for managing the PDF-to-LaTeX conversion workflow.
 * Handles upload, conversion, progress tracking, result fetching,
 * persistence, and session recovery on page refresh.
 */
export function useConversion() {
  const [state, setState] = useState(() => {
    let savedJobId = null
    let savedCode = null
    let savedStatus = null
    try {
      savedJobId = localStorage.getItem(STORAGE_KEY_JOB)
      savedCode = localStorage.getItem(STORAGE_KEY_CODE)
      savedStatus = localStorage.getItem(STORAGE_KEY_STATUS)
    } catch (e) {
      console.warn('localStorage read failed', e)
    }

    if (savedJobId && savedStatus === 'complete') {
      return {
        file: null,
        fileName: '',
        fileSize: 0,
        jobId: savedJobId,
        status: 'complete',
        progress: 100,
        message: 'Session restored',
        latexCode: '', // Will be loaded from backend shortly
        ssimScore: null,
        error: null,
      }
    }

    return {
      file: null,
      fileName: '',
      fileSize: 0,
      jobId: null,
      status: 'idle', // idle, uploading, processing, complete, failed
      progress: 0,
      message: '',
      latexCode: '',
      ssimScore: null,
      error: null,
    }
  })

  const wsRef = useRef(null)
  const backendSyncTimerRef = useRef(null)

  const updateState = (updates) => {
    setState(prev => ({ ...prev, ...updates }))
  }

  // Persist key state to localStorage whenever it changes
  useEffect(() => {
    try {
      if (state.jobId) {
        localStorage.setItem(STORAGE_KEY_JOB, state.jobId)
      }
      if (state.latexCode) {
        // latexCode is now strictly saved to the backend database
      }
      if (state.status) {
        localStorage.setItem(STORAGE_KEY_STATUS, state.status)
      }
    } catch (e) {
      console.warn('localStorage write failed', e)
    }
  }, [state.jobId, state.latexCode, state.status])

  /**
   * Upload a PDF file to the server
   */
  const uploadFile = useCallback(async (file) => {
    updateState({
      file,
      fileName: file.name,
      fileSize: file.size,
      status: 'uploading',
      progress: 0,
      message: 'Uploading PDF...',
      error: null,
      latexCode: '',
      ssimScore: null,
    })

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Upload failed')
      }

      const data = await response.json()
      
      updateState({
        jobId: data.job_id,
        status: 'uploaded',
        progress: 10,
        message: 'PDF uploaded successfully',
      })

      return data.job_id
    } catch (error) {
      updateState({
        status: 'failed',
        error: error.message,
        message: `Upload failed: ${error.message}`,
      })
      return null
    }
  }, [])

  /**
   * Start the conversion process
   */
  const startConversion = useCallback(async (jobId) => {
    const id = jobId || state.jobId
    if (!id) return

    updateState({
      status: 'processing',
      progress: 15,
      message: 'Starting conversion...',
    })

    try {
      // Start conversion via API
      const response = await fetch(`/api/convert/${id}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Conversion failed to start')
      }

      // Connect WebSocket for progress updates
      connectWebSocket(id)

    } catch (error) {
      updateState({
        status: 'failed',
        error: error.message,
        message: `Conversion failed: ${error.message}`,
      })
    }
  }, [state.jobId])

  /**
   * Connect WebSocket for real-time progress updates
   */
  const connectWebSocket = useCallback((jobId) => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${wsProtocol}//localhost:8000/api/ws/${jobId}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      updateState({
        status: data.status,
        progress: data.progress,
        message: data.message,
        ssimScore: data.ssim_score || state.ssimScore,
      })

      if (data.status === 'complete' || data.status === 'failed') {
        ws.close()
        if (data.status === 'complete') {
          fetchResult(jobId)
        }
      }
    }

    ws.onerror = () => {
      // Fallback to polling
      pollStatus(jobId)
    }

    ws.onclose = () => {
      wsRef.current = null
    }
  }, [])

  /**
   * Fallback: poll for status updates
   */
  const pollStatus = useCallback(async (jobId) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/status/${jobId}`)
        const data = await response.json()
        
        updateState({
          status: data.status,
          progress: data.progress,
          message: data.message,
          ssimScore: data.ssim_score,
        })

        if (data.status !== 'complete' && data.status !== 'failed') {
          setTimeout(poll, 1000)
        } else if (data.status === 'complete') {
          fetchResult(jobId)
        }
      } catch (error) {
        setTimeout(poll, 2000)
      }
    }

    poll()
  }, [])

  /**
   * Fetch the conversion result (LaTeX code)
   */
  const fetchResult = useCallback(async (jobId) => {
    try {
      const response = await fetch(`/api/result/${jobId}`)
      const data = await response.json()

      updateState({
        latexCode: data.latex_code || '',
        ssimScore: data.ssim_score,
        status: 'complete',
        progress: 100,
        message: 'Conversion complete!',
      })
    } catch (error) {
      console.error('Failed to fetch result:', error)
    }
  }, [])

  /**
   * Save document to backend
   */
  const saveToBackend = useCallback(async (jobId, latexCode, cursorLine = 1, cursorCol = 1, scrollPosition = 0) => {
    if (!jobId || !latexCode) return false

    try {
      const response = await fetch(`/api/save/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latex_code: latexCode,
          cursor_line: cursorLine,
          cursor_col: cursorCol,
          scroll_position: scrollPosition,
        }),
      })

      return response.ok
    } catch (error) {
      console.error('Backend save failed:', error)
      return false
    }
  }, [])

  /**
   * Load document from backend (for page-refresh restoration)
   */
  const loadFromBackend = useCallback(async (jobId) => {
    if (!jobId) return null

    try {
      const response = await fetch(`/api/save/${jobId}`)
      if (!response.ok) return null

      const data = await response.json()
      return {
        latexCode: data.latex_code,
        cursorLine: data.cursor_line,
        cursorCol: data.cursor_col,
        scrollPosition: data.scroll_position,
        savedAt: data.saved_at,
      }
    } catch (error) {
      console.error('Backend load failed:', error)
      return null
    }
  }, [])

  /**
   * Compile and download PDF from current edited source
   */
  const compileAndDownloadPdf = useCallback(async (jobId, latexCode) => {
    if (!jobId || !latexCode) return

    try {
      const response = await fetch(`/api/export/compile-pdf/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex_code: latexCode }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Compilation failed')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${jobId}_compiled.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    } catch (error) {
      console.error('Compile PDF failed:', error)
      return false
    }
  }, [])

  /**
   * Compile and download DOCX from current edited source
   */
  const compileAndDownloadDocx = useCallback(async (jobId, latexCode) => {
    if (!jobId || !latexCode) return

    try {
      const response = await fetch(`/api/export/compile-docx/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex_code: latexCode }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'DOCX conversion failed')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${jobId}_document.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    } catch (error) {
      console.error('Compile DOCX failed:', error)
      return false
    }
  }, [])

  /**
   * Upload and convert in one step
   */
  const uploadAndConvert = useCallback(async (file) => {
    const jobId = await uploadFile(file)
    if (jobId) {
      await startConversion(jobId)
    }
  }, [uploadFile, startConversion])

  /**
   * Restore document state from database on mount if we have a valid jobId and no code
   */
  useEffect(() => {
    if (state.jobId && state.status === 'complete' && !state.latexCode) {
      loadFromBackend(state.jobId).then(data => {
        if (data && data.latexCode) {
          updateState({ latexCode: data.latexCode })
        }
      })
    }
  }, [state.jobId, state.status, state.latexCode, loadFromBackend])

  /**
   * Update internal state helper
   */
  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    if (backendSyncTimerRef.current) {
      clearInterval(backendSyncTimerRef.current)
    }

    // Clear localStorage safely
    try {
      localStorage.removeItem(STORAGE_KEY_JOB)
      // Database maintains latexCode based on jobId
      localStorage.removeItem(STORAGE_KEY_STATUS)
      localStorage.removeItem('latex-editor-source')
      localStorage.removeItem('latex-editor-cursor')
      localStorage.removeItem('latex-editor-scroll')
    } catch (e) {
      console.warn('localStorage clear failed', e)
    }

    setState({
      file: null,
      fileName: '',
      fileSize: 0,
      jobId: null,
      status: 'idle',
      progress: 0,
      message: '',
      latexCode: '',
      ssimScore: null,
      error: null,
    })
  }, [])

  return {
    ...state,
    uploadFile,
    startConversion,
    uploadAndConvert,
    fetchResult,
    saveToBackend,
    loadFromBackend,
    compileAndDownloadPdf,
    compileAndDownloadDocx,
    reset,
  }
}
