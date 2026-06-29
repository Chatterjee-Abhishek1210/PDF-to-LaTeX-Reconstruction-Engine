import { useState, useEffect } from 'react'

/**
 * ThemeToggle — Dark/Light mode toggle switch
 * Persists preference in localStorage
 */
export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('pdf2latex-theme')
      return saved ? saved === 'dark' : true // Default to dark
    } catch (e) {
      return true
    }
  })

  useEffect(() => {
    const theme = isDark ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('pdf2latex-theme', theme)
    } catch (e) {
      console.warn('Theme save failed', e)
    }
  }, [isDark])

  return (
    <button
      className={`theme-toggle ${isDark ? 'dark' : 'light'}`}
      onClick={() => setIsDark(!isDark)}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
      id="theme-toggle-btn"
    />
  )
}
