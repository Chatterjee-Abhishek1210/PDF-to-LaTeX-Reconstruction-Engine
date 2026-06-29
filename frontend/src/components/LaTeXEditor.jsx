import { useState, useRef, useEffect, useCallback } from 'react'
import { EditorState, StateField, StateEffect } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, Decoration, gutter, GutterMarker } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { StreamLanguage, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { linter, lintGutter, setDiagnostics } from '@codemirror/lint'
import katex from 'katex'
import 'katex/dist/katex.min.css'

import {
  LaTeXIcon,
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  RefreshIcon,
  PdfIcon
} from './Icons'

// Snippets data for command palette
const SNIPPETS = [
  { name: 'Fraction \\frac{}{}', code: '\\frac{numerator}{denominator}', desc: 'Fraction expression' },
  { name: 'Bold \\textbf{}', code: '\\textbf{text}', desc: 'Bold text formatting' },
  { name: 'Italic \\textit{}', code: '\\textit{text}', desc: 'Italic text formatting' },
  { name: 'Underline \\underline{}', code: '\\underline{text}', desc: 'Underlined text formatting' },
  { name: 'Monospace \\texttt{}', code: '\\texttt{code}', desc: 'Monospaced text style' },
  { name: 'Section \\section{}', code: '\\section{Section Name}', desc: 'Major document heading' },
  { name: 'Subsection \\subsection{}', code: '\\subsection{Subsection Name}', desc: 'Sub heading level 2' },
  { name: 'TOC \\tableofcontents', code: '\\tableofcontents', desc: 'Add Table of Contents' },
  { name: 'Itemize List \\begin{itemize}', code: '\\begin{itemize}\n  \\item \n\\end{itemize}', desc: 'Bulleted list' },
  { name: 'Enumerate List \\begin{enumerate}', code: '\\begin{enumerate}\n  \\item \n\\end{enumerate}', desc: 'Numbered list' },
  { name: 'Description List \\begin{description}', code: '\\begin{description}\n  \\item[Label] Details\n\\end{description}', desc: 'Labled description list' },
  { name: 'Equation \\begin{equation}', code: '\\begin{equation}\n  E = mc^2 \\label{eq:energy}\n\\end{equation}', desc: 'Display equation block' },
  { name: 'Table \\begin{table}', code: '\\begin{table}[h]\n  \\centering\n  \\begin{tabular}{|l|c|r|}\n    \\hline\n    Header 1 & Header 2 & Header 3 \\\\\n    \\hline\n    Row 1 & Value 2 & Right 3 \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{My Table Caption}\n  \\label{tab:table1}\n\\end{table}', desc: 'Floating grid table' },
  { name: 'Figure \\begin{figure}', code: '\\begin{figure}[h]\n  \\centering\n  \\includegraphics{example-image}\n  \\caption{Figure Caption}\n  \\label{fig:fig1}\n\\end{figure}', desc: 'Graphic figure block' },
  { name: 'Reference \\ref{}', code: '\\ref{label_key}', desc: 'Cross-reference citation' },
  { name: 'Citation \\cite{}', code: '\\cite{cite_key}', desc: 'Bibliography reference' },
  { name: 'Footnote \\footnote{}', code: '\\footnote{Footnote text}', desc: 'Bottom footnotes' }
]

// ─────────────────────────────────────────────────────────────────
// CUSTOM SIMULATED LATEX PARSER & COMPILER CLASS
// ─────────────────────────────────────────────────────────────────
class LaTeXCompiler {
  constructor(source, onRefClick) {
    this.source = source
    this.onRefClick = onRefClick
    this.expandedText = this.expandMacros(source)
    this.cleanText = this.expandedText.replace(/(?<!\\)%.*/g, (match) => ' '.repeat(match.length))
    
    this.title = 'Untitled LaTeX Document'
    this.author = ''
    this.date = ''
    
    this.labels = {}
    this.citations = {}
    this.footnotes = []
    this.footnoteCount = 0
    
    this.sectionCount = 0
    this.subsectionCount = 0
    this.subsubsectionCount = 0
    this.equationCount = 0
    this.figureCount = 0
    this.tableCount = 0
    
    this.errors = []
    this.outline = []
  }

  getLineNum(index) {
    return this.cleanText.substring(0, index).split('\n').length
  }

  extractBraceContent(str, startIndex) {
    let depth = 0
    let result = ''
    for (let i = startIndex; i < str.length; i++) {
      let char = str[i]
      if (char === '{') {
        depth++
        if (depth === 1) continue
      } else if (char === '}') {
        depth--
        if (depth === 0) {
          return { content: result, endIndex: i }
        }
      }
      if (depth > 0) {
        result += char
      }
    }
    return null
  }

  findMatchingEnd(text, startPos, envName) {
    let depth = 1
    const regex = new RegExp(`\\\\(begin|end)\\s*\\{${envName}\\}`, 'g')
    regex.lastIndex = startPos
    let match
    while ((match = regex.exec(text)) !== null) {
      if (match[1] === 'begin') {
        depth++
      } else {
        depth--
        if (depth === 0) {
          return match.index
        }
      }
    }
    return -1
  }

  convertLaTeXLength(len) {
    len = len.trim()
    if (len.includes('\\textwidth')) {
      const m = len.match(/([0-9.]+)\s*\\textwidth/)
      return m ? (parseFloat(m[1]) * 100) + '%' : '100%'
    }
    if (len.includes('\\linewidth')) {
      const m = len.match(/([0-9.]+)\s*\\linewidth/)
      return m ? (parseFloat(m[1]) * 100) + '%' : '100%'
    }
    const m = len.match(/^(-?[0-9.]+)\s*([a-zA-Z]+)?/)
    if (m) {
      const val = m[1]
      const unit = m[2] || 'pt'
      if (unit === 'pt') return (parseFloat(val) * 1.33) + 'px'
      if (['cm', 'mm', 'in', 'em', 'ex', 'px', '%'].includes(unit)) return val + unit
    }
    return len
  }

  expandMacros(text) {
    const macroRegex = /\\newcommand\s*\{\\([a-zA-Z]+)\}\s*(?:\[(\d+)\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
    const macros = {}
    let match
    while ((match = macroRegex.exec(text)) !== null) {
      macros[match[1]] = {
        numArgs: match[2] ? parseInt(match[2]) : 0,
        defn: match[3]
      }
    }
    
    let expanded = text.replace(macroRegex, '')
    let expandedAny = true
    let iterations = 0
    
    while (expandedAny && iterations < 5) {
      expandedAny = false
      iterations++
      
      for (const [name, macro] of Object.entries(macros)) {
        if (macro.numArgs === 0) {
          const usageRegex = new RegExp(`\\\\${name}\\b`, 'g')
          if (usageRegex.test(expanded)) {
            expanded = expanded.replace(usageRegex, macro.defn)
            expandedAny = true
          }
        } else {
          const usageRegex = new RegExp(`\\\\${name}(?=\\s*\\{)`, 'g')
          let m
          let loopCount = 0
          while ((m = usageRegex.exec(expanded)) !== null && loopCount < 100) {
            loopCount++
            const args = []
            let pos = m.index + m[0].length
            let currentEnd = pos
            for (let i = 0; i < macro.numArgs; i++) {
              while (pos < expanded.length && /\s/.test(expanded[pos])) pos++
              if (expanded[pos] === '{') {
                const argBrace = this.extractBraceContent(expanded, pos)
                if (argBrace) {
                  args.push(argBrace.content)
                  pos = argBrace.endIndex + 1
                  currentEnd = pos
                } else {
                  break
                }
              } else {
                break
              }
            }
            if (args.length === macro.numArgs) {
              let replaced = macro.defn
              for (let i = 0; i < args.length; i++) {
                replaced = replaced.replace(new RegExp(`#${i+1}`, 'g'), args[i])
              }
              expanded = expanded.substring(0, m.index) + replaced + expanded.substring(currentEnd)
              expandedAny = true
              usageRegex.lastIndex = 0
            } else {
              break
            }
          }
        }
      }
    }
    return expanded
  }

  preScan() {
    const titleMatch = this.cleanText.match(/\\title\s*\{((?:[^{}]|\{[^{}]*\})*)\}/)
    if (titleMatch) this.title = titleMatch[1]
    
    const authorMatch = this.cleanText.match(/\\author\s*\{((?:[^{}]|\{[^{}]*\})*)\}/)
    if (authorMatch) this.author = authorMatch[1]
    
    const dateMatch = this.cleanText.match(/\\date\s*\{((?:[^{}]|\{[^{}]*\})*)\}/)
    if (dateMatch) this.date = dateMatch[1]

    const bibRegex = /\\begin\s*\{thebibliography\}\s*\{[^}]*\}\s*([\s\S]*?)\\end\s*\{thebibliography\}/
    const bibMatch = bibRegex.exec(this.cleanText)
    if (bibMatch) {
      const bibContent = bibMatch[1]
      const itemRegex = /\\bibitem\s*\{([^}]+)\}/g
      let itemMatch
      let idx = 1
      while ((itemMatch = itemRegex.exec(bibContent)) !== null) {
        this.citations[itemMatch[1]] = idx++
      }
    }

    const labelAndCounterRegex = /\\(section|subsection|subsubsection|begin\s*\{equation\}|begin\s*\{figure\}|begin\s*\{table\}|label\s*\{([^}]+)\})/g
    let match
    let sCount = 0
    let subCount = 0
    let subsubCount = 0
    let eqCount = 0
    let figCount = 0
    let tabCount = 0
    let activeRef = ''
    
    while ((match = labelAndCounterRegex.exec(this.cleanText)) !== null) {
      const cmd = match[1]
      if (cmd.startsWith('section')) {
        sCount++
        subCount = 0
        subsubCount = 0
        activeRef = `${sCount}`
      } else if (cmd.startsWith('subsection')) {
        subCount++
        subsubCount = 0
        activeRef = `${sCount}.${subCount}`
      } else if (cmd.startsWith('subsubsection')) {
        subsubCount++
        activeRef = `${sCount}.${subCount}.${subsubCount}`
      } else if (cmd.startsWith('begin') && cmd.includes('equation')) {
        eqCount++
        activeRef = `${eqCount}`
      } else if (cmd.startsWith('begin') && cmd.includes('figure')) {
        figCount++
        activeRef = `${figCount}`
      } else if (cmd.startsWith('begin') && cmd.includes('table')) {
        tabCount++
        activeRef = `${tabCount}`
      } else if (cmd.startsWith('label')) {
        this.labels[match[2]] = activeRef
      }
    }
  }

  parseBlocks() {
    const blocks = []
    const docStartRegex = /\\begin\s*\{document\}/
    const docEndRegex = /\\end\s*\{document\}/
    
    let bodyText = this.cleanText
    let bodyOffset = 0
    
    const startMatch = docStartRegex.exec(this.cleanText)
    const endMatch = docEndRegex.exec(this.cleanText)
    
    if (startMatch) {
      bodyOffset = startMatch.index + startMatch[0].length
      let endOffset = this.cleanText.length
      if (endMatch) {
        endOffset = endMatch.index
      }
      bodyText = this.cleanText.substring(bodyOffset, endOffset)
    }
    
    let bodyPos = 0
    while (bodyPos < bodyText.length) {
      const rest = bodyText.substring(bodyPos)
      const wsMatch = rest.match(/^\s+/)
      if (wsMatch) {
        bodyPos += wsMatch[0].length
        continue
      }
      
      const absPos = bodyOffset + bodyPos
      const lineNum = this.getLineNum(absPos)
      
      // Stop compilation if we hit the end of the document
      if (rest.startsWith('\\end{document}')) {
        break
      }
      
      if (rest.startsWith('\\maketitle')) {
        blocks.push({ type: 'maketitle', line: lineNum, content: '' })
        bodyPos += '\\maketitle'.length
        continue
      }

      if (rest.startsWith('\\tableofcontents')) {
        blocks.push({ type: 'tableofcontents', line: lineNum, content: '' })
        bodyPos += '\\tableofcontents'.length
        continue
      }
      
      const secMatch = rest.match(/^\\(section|subsection|subsubsection)\b/)
      if (secMatch) {
        const secType = secMatch[1]
        let argStart = bodyPos + secMatch[0].length
        while (argStart < bodyText.length && bodyText[argStart] !== '{') argStart++
        if (argStart < bodyText.length) {
          const braceResult = this.extractBraceContent(bodyText, argStart)
          if (braceResult) {
            blocks.push({
              type: secType,
              line: lineNum,
              content: braceResult.content
            })
            bodyPos = braceResult.endIndex + 1
            continue
          }
        }
      }
      
      const envMatch = rest.match(/^\\begin\s*\{([^}]+)\}/)
      if (envMatch) {
        const envName = envMatch[1]
        const envEndStr = `\\end{${envName}}`
        const searchStart = bodyPos + envMatch[0].length
        const endOffset = this.findMatchingEnd(bodyText, searchStart, envName)
        if (endOffset !== -1) {
          const envContent = bodyText.substring(searchStart, endOffset)
          blocks.push({
            type: 'environment',
            envName: envName,
            line: lineNum,
            content: envContent
          })
          bodyPos = endOffset + envEndStr.length
          continue
        } else {
          blocks.push({
            type: 'broken_env',
            envName: envName,
            line: lineNum,
            content: rest.split('\n')[0]
          })
          bodyPos += envMatch[0].length
          continue
        }
      }
      
      if (rest.startsWith('$$')) {
        const endMath = bodyText.indexOf('$$', bodyPos + 2)
        if (endMath !== -1) {
          blocks.push({
            type: 'displaymath',
            line: lineNum,
            content: bodyText.substring(bodyPos + 2, endMath)
          })
          bodyPos = endMath + 2
          continue
        }
      }
      if (rest.startsWith('\\[')) {
        const endMath = bodyText.indexOf('\\]', bodyPos + 2)
        if (endMath !== -1) {
          blocks.push({
            type: 'displaymath',
            line: lineNum,
            content: bodyText.substring(bodyPos + 2, endMath)
          })
          bodyPos = endMath + 2
          continue
        }
      }
      
      let nextBlockPos = bodyPos
      let paraText = ''
      while (nextBlockPos < bodyText.length) {
        const sub = bodyText.substring(nextBlockPos)
        if (sub.match(/^\n\s*\n/) || sub.startsWith('\\par') || 
            sub.match(/^\\(section|subsection|subsubsection)\b/) || 
            sub.match(/^\\begin\s*\{/) || 
            sub.startsWith('\\maketitle') || 
            sub.startsWith('\\tableofcontents') ||
            sub.startsWith('$$') || 
            sub.startsWith('\\[') ||
            sub.startsWith('\\end{document}')) {
          break
        }
        paraText += bodyText[nextBlockPos]
        nextBlockPos++
      }
      
      if (bodyText.substring(nextBlockPos).startsWith('\\par')) {
        nextBlockPos += 4
      }
      
      if (paraText.trim() !== '') {
        blocks.push({ type: 'paragraph', line: lineNum, content: paraText })
      }
      
      // Safety check to ensure we always advance the position
      if (nextBlockPos === bodyPos) {
        bodyPos++
      } else {
        bodyPos = nextBlockPos
      }
    }
    
    return blocks
  }

  processStructure(blocks) {
    for (let block of blocks) {
      if (block.type === 'section') {
        this.sectionCount++
        this.subsectionCount = 0
        this.subsubsectionCount = 0
        block.number = `${this.sectionCount}`
        this.outline.push({ type: 'section', title: block.content, number: block.number, line: block.line })
      } else if (block.type === 'subsection') {
        this.subsectionCount++
        this.subsubsectionCount = 0
        block.number = `${this.sectionCount}.${this.subsectionCount}`
        this.outline.push({ type: 'subsection', title: block.content, number: block.number, line: block.line })
      } else if (block.type === 'subsubsection') {
        this.subsubsectionCount++
        block.number = `${this.sectionCount}.${this.subsectionCount}.${this.subsubsectionCount}`
        this.outline.push({ type: 'subsubsection', title: block.content, number: block.number, line: block.line })
      } else if (block.type === 'environment') {
        if (block.envName === 'equation') {
          this.equationCount++
          block.number = `${this.equationCount}`
        } else if (block.envName === 'figure') {
          this.figureCount++
          block.number = `${this.figureCount}`
        } else if (block.envName === 'table') {
          this.tableCount++
          block.number = `${this.tableCount}`
        }
      }
    }
  }

  renderInline(text, lineNum) {
    let pos = 0
    let html = ''
    
    while (pos < text.length) {
      if (text[pos] === '$') {
        let endMath = text.indexOf('$', pos + 1)
        if (endMath !== -1) {
          let math = text.substring(pos + 1, endMath)
          try {
            html += katex.renderToString(math, { displayMode: false, throwOnError: false })
          } catch (e) {
            html += `$${math}$`
          }
          pos = endMath + 1
          continue
        }
      }
      if (text.substring(pos).startsWith('\\(')) {
        let endMath = text.indexOf('\\)', pos + 2)
        if (endMath !== -1) {
          let math = text.substring(pos + 2, endMath)
          try {
            html += katex.renderToString(math, { displayMode: false, throwOnError: false })
          } catch (e) {
            html += `\\(${math}\\)`
          }
          pos = endMath + 2
          continue
        }
      }

      if (text[pos] === '\\') {
        let cmdMatch = text.substring(pos).match(/^\\([a-zA-Z]+)/)
        if (cmdMatch) {
          let cmd = cmdMatch[1]
          let cmdLen = cmdMatch[0].length
          
          if (['textbf', 'textit', 'underline', 'emph', 'ref', 'cite', 'footnote', 'texttt', 'hspace', 'vspace', 'textsf'].includes(cmd)) {
            let argStart = pos + cmdLen
            while (argStart < text.length && text[argStart] !== '{') argStart++
            if (argStart < text.length) {
              let braceResult = this.extractBraceContent(text, argStart)
              if (braceResult) {
                let arg = braceResult.content
                if (cmd === 'textbf') {
                  html += `<strong>${this.renderInline(arg, lineNum)}</strong>`
                } else if (cmd === 'textit' || cmd === 'emph') {
                  html += `<em>${this.renderInline(arg, lineNum)}</em>`
                } else if (cmd === 'underline') {
                  html += `<span class="underline">${this.renderInline(arg, lineNum)}</span>`
                } else if (cmd === 'texttt' || cmd === 'textsf') {
                  html += `<code class="tex-monospace">${this.renderInline(arg, lineNum)}</code>`
                } else if (cmd === 'hspace') {
                  html += `<span style="display: inline-block; width: ${this.convertLaTeXLength(arg)};"></span>`
                } else if (cmd === 'vspace') {
                  html += `<span style="display: block; height: ${this.convertLaTeXLength(arg)};"></span>`
                } else if (cmd === 'ref') {
                  const num = this.labels[arg] || '??'
                  html += `<a href="#" class="pdf-ref" data-ref="${arg}">${num}</a>`
                } else if (cmd === 'cite') {
                  const num = this.citations[arg] || '?'
                  html += `<a href="#" class="pdf-cite" data-cite="${arg}">[${num}]</a>`
                } else if (cmd === 'footnote') {
                  this.footnoteCount++
                  const id = this.footnoteCount
                  this.footnotes.push({ id: id, content: arg })
                  html += `<sup class="pdf-footnote-ref" data-fn-idx="${id}">[${id}]</sup>`
                }
                pos = braceResult.endIndex + 1
                continue
              }
            }
          } else if (cmd === 'textcolor') {
            let arg1Start = pos + cmdLen
            while (arg1Start < text.length && text[arg1Start] !== '{') arg1Start++
            if (arg1Start < text.length) {
              let brace1 = this.extractBraceContent(text, arg1Start)
              if (brace1) {
                let color = brace1.content
                let arg2Start = brace1.endIndex + 1
                while (arg2Start < text.length && text[arg2Start] !== '{') arg2Start++
                if (arg2Start < text.length) {
                  let brace2 = this.extractBraceContent(text, arg2Start)
                  if (brace2) {
                    let innerText = brace2.content
                    html += `<span style="color: ${color};">${this.renderInline(innerText, lineNum)}</span>`
                    pos = brace2.endIndex + 1
                    continue
                  }
                }
              }
            }
          } else if (cmd === 'newline' || cmd === '\\') {
            html += `<br/>`
            pos += cmdLen
            continue
          } else if (['LARGE', 'Large', 'large', 'centering', 'noindent', 'hline'].includes(cmd)) {
            pos += cmdLen
            continue
          } else {
            html += `\\${cmd}`
            pos += cmdLen
            continue
          }
          
          // Fallback if parsing braces failed in any block above
          html += `\\${cmd}`
          pos += cmdLen
          continue
        } else {
          // It's a slash but not followed by letters (e.g. \&, \%, \_)
          let escapedChar = text[pos + 1]
          if (escapedChar) {
            if (escapedChar === '&') html += '&amp;'
            else if (escapedChar === '<') html += '&lt;'
            else if (escapedChar === '>') html += '&gt;'
            else html += escapedChar
            pos += 2
          } else {
            html += '\\'
            pos += 1
          }
          continue
        }
      }
      
      let nextPos = pos
      let textRun = ''
      while (nextPos < text.length && text[nextPos] !== '$' && text[nextPos] !== '\\') {
        textRun += text[nextPos]
        nextPos++
      }
      
      html += `<span class="tex-text" data-source-line="${lineNum}">${textRun}</span>`
      pos = nextPos
    }
    
    return html
  }

  renderMaketitle(block) {
    const el = document.createElement('div')
    el.className = 'latex-title-block'
    el.dataset.sourceLine = block.line
    
    const titleEl = document.createElement('h1')
    titleEl.className = 'latex-title'
    titleEl.innerHTML = this.renderInline(this.title, block.line)
    el.appendChild(titleEl)
    
    if (this.author) {
      const authorEl = document.createElement('div')
      authorEl.className = 'latex-author'
      authorEl.innerHTML = this.renderInline(this.author, block.line)
      el.appendChild(authorEl)
    }
    
    if (this.date) {
      const dateEl = document.createElement('div')
      dateEl.className = 'latex-date'
      dateEl.innerHTML = this.renderInline(this.date, block.line)
      el.appendChild(dateEl)
    }
    return el
  }

  renderTableOfContents(block) {
    const el = document.createElement('div')
    el.className = 'latex-toc'
    el.dataset.sourceLine = block.line
    
    const heading = document.createElement('h2')
    heading.className = 'latex-toc-heading'
    heading.innerText = 'Contents'
    el.appendChild(heading)
    
    const list = document.createElement('div')
    list.className = 'latex-toc-list'
    
    this.outline.forEach(item => {
      const itemEl = document.createElement('div')
      const depth = item.type === 'section' ? 1 : item.type === 'subsection' ? 2 : 3
      itemEl.className = `latex-toc-item depth-${depth}`
      
      itemEl.innerHTML = `
        <span class="toc-number">${item.number}</span>
        <span class="toc-title">${item.title}</span>
        <span class="toc-filler"></span>
        <span class="toc-page"></span>
      `
      
      itemEl.addEventListener('click', (e) => {
        e.preventDefault()
        if (this.onRefClick) this.onRefClick(item.line)
      })
      
      list.appendChild(itemEl)
    })
    
    el.appendChild(list)
    return el
  }

  renderAbstract(block) {
    const el = document.createElement('div')
    el.className = 'latex-abstract'
    el.dataset.sourceLine = block.line
    
    const heading = document.createElement('div')
    heading.className = 'latex-abstract-heading'
    heading.innerText = 'Abstract'
    el.appendChild(heading)
    
    const content = document.createElement('p')
    content.className = 'latex-abstract-content'
    content.innerHTML = this.renderInline(block.content, block.line)
    el.appendChild(content)
    return el
  }

  renderSection(block) {
    const tag = block.type === 'section' ? 'h2' : block.type === 'subsection' ? 'h3' : 'h4'
    const el = document.createElement(tag)
    el.className = `latex-${block.type}`
    el.dataset.sourceLine = block.line
    
    const cleanTitle = block.content.replace(/\\label\s*\{[^}]*\}/g, '').trim()
    
    const numSpan = document.createElement('span')
    numSpan.className = 'heading-number'
    numSpan.innerText = block.number + ' '
    el.appendChild(numSpan)
    
    const textSpan = document.createElement('span')
    textSpan.className = 'heading-text'
    textSpan.innerHTML = this.renderInline(cleanTitle, block.line)
    el.appendChild(textSpan)
    return el
  }

  renderParagraph(block) {
    const el = document.createElement('p')
    el.className = 'latex-paragraph'
    el.dataset.sourceLine = block.line
    
    let content = block.content.trim()
    if (content.startsWith('\\noindent')) {
      el.style.textIndent = '0'
      content = content.replace(/^\\noindent\s*/, '')
    }
    
    el.innerHTML = this.renderInline(content, block.line)
    return el
  }

  renderEquation(block) {
    const el = document.createElement('div')
    el.className = 'latex-equation-block'
    el.dataset.sourceLine = block.line
    
    let mathContent = block.content.replace(/\\label\s*\{[^}]*\}/g, '').trim()
    const mathWrapper = document.createElement('div')
    mathWrapper.className = 'latex-equation-math'
    
    try {
      mathWrapper.innerHTML = katex.renderToString(mathContent, { displayMode: true, throwOnError: false })
    } catch (err) {
      mathWrapper.innerText = mathContent
    }
    el.appendChild(mathWrapper)
    
    if (block.number) {
      const numEl = document.createElement('div')
      numEl.className = 'latex-equation-number'
      numEl.innerText = `(${block.number})`
      el.appendChild(numEl)
    }
    return el
  }

  renderEnvironment(block) {
    if (block.envName === 'tikzpicture') return this.renderTikzpicture(block)
    if (block.envName === 'itemize') return this.renderList(block)
    if (block.envName === 'enumerate') return this.renderList(block)
    if (block.envName === 'description') return this.renderDescriptionList(block)
    return null
  }

  renderList(block) {
    if (block.envName === 'description') {
      return this.renderDescriptionList(block)
    }
    const tag = block.envName === 'itemize' ? 'ul' : 'ol'
    const el = document.createElement(tag)
    el.className = `latex-${block.envName}`
    el.dataset.sourceLine = block.line
    
    const items = block.content.split(/\\item\b/)
    for (let i = 1; i < items.length; i++) {
      const li = document.createElement('li')
      li.className = 'latex-list-item'
      let itemContent = items[i].trim()
      
      let customBulletMatch = itemContent.match(/^\[(.*?)\]/)
      if (customBulletMatch) {
        li.style.listStyleType = 'none'
        const bulletSpan = document.createElement('span')
        bulletSpan.className = 'custom-bullet'
        bulletSpan.innerHTML = this.renderInline(customBulletMatch[1], block.line)
        li.appendChild(bulletSpan)
        itemContent = itemContent.substring(customBulletMatch[0].length).trim()
      }
      
      const contentSpan = document.createElement('span')
      contentSpan.innerHTML = this.renderInline(itemContent, block.line)
      li.appendChild(contentSpan)
      el.appendChild(li)
    }
    return el
  }

  renderDescriptionList(block) {
    const el = document.createElement('dl')
    el.className = 'latex-description'
    el.dataset.sourceLine = block.line
    
    const items = block.content.split(/\\item\b/)
    for (let i = 1; i < items.length; i++) {
      let itemContent = items[i].trim()
      let label = ''
      let desc = itemContent
      
      let labelMatch = itemContent.match(/^\[(.*?)\]/)
      if (labelMatch) {
        label = labelMatch[1]
        desc = itemContent.substring(labelMatch[0].length).trim()
      }
      
      const dt = document.createElement('dt')
      dt.className = 'latex-desc-term'
      dt.innerHTML = this.renderInline(label, block.line)
      el.appendChild(dt)
      
      const dd = document.createElement('dd')
      dd.className = 'latex-desc-details'
      dd.innerHTML = this.renderInline(desc, block.line)
      el.appendChild(dd)
    }
    return el
  }

  renderFigure(block) {
    const el = document.createElement('div')
    el.className = 'latex-figure'
    el.dataset.sourceLine = block.line
    
    const imgRegex = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/
    const imgMatch = imgRegex.exec(block.content)
    const imgPath = imgMatch ? imgMatch[1] : 'example-image'
    
    const captionRegex = /\\caption\s*\{((?:[^{}]|\{[^{}]*\})*)\}/
    const captionMatch = captionRegex.exec(block.content)
    const captionText = captionMatch ? captionMatch[1] : ''
    
    const placeholder = document.createElement('div')
    placeholder.className = 'latex-figure-placeholder'
    placeholder.innerHTML = `
      <svg class="figure-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
      <span class="figure-path">${imgPath}</span>
    `
    el.appendChild(placeholder)
    
    if (captionText) {
      const captionEl = document.createElement('div')
      captionEl.className = 'latex-figure-caption'
      captionEl.innerHTML = `<strong>Figure ${block.number}:</strong> ` + this.renderInline(captionText, block.line)
      el.appendChild(captionEl)
    }
    return el
  }

  renderTable(block) {
    const el = document.createElement('div')
    el.className = 'latex-table-container'
    el.dataset.sourceLine = block.line
    
    const captionRegex = /\\caption\s*\{((?:[^{}]|\{[^{}]*\})*)\}/
    const captionMatch = captionRegex.exec(block.content)
    const captionText = captionMatch ? captionMatch[1] : ''
    
    const tabularRegex = /\\begin\s*\{tabular\}\s*\{([^}]+)\}([\s\S]*?)\\end\s*\{tabular\}/
    const tabMatch = tabularRegex.exec(block.content)
    
    if (tabMatch) {
      const colsSpec = tabMatch[1]
      const tabContent = tabMatch[2]
      
      const table = document.createElement('table')
      table.className = 'latex-table'
      
      const colStyles = []
      let borderLeft = false
      for (let char of colsSpec) {
        if (char === '|') {
          borderLeft = true
        } else if (['l', 'c', 'r'].includes(char)) {
          colStyles.push({
            align: char === 'l' ? 'left' : char === 'c' ? 'center' : 'right',
            borderLeft: borderLeft
          })
          borderLeft = false
        }
      }
      
      const rawRows = tabContent.split('\\\\')
      const tbody = document.createElement('tbody')
      
      let nextRowHline = false
      for (let rawRow of rawRows) {
        rawRow = rawRow.trim()
        if (rawRow === '') continue
        
        if (rawRow === '\\hline') {
          nextRowHline = true
          continue
        }
        
        let rowHlineBefore = nextRowHline
        nextRowHline = false
        
        if (rawRow.startsWith('\\hline')) {
          rowHlineBefore = true
          rawRow = rawRow.replace(/^\\hline\s*/, '')
        }
        if (rawRow.endsWith('\\hline')) {
          nextRowHline = true
          rawRow = rawRow.replace(/\s*\\hline$/, '')
        }
        
        const tr = document.createElement('tr')
        if (rowHlineBefore) {
          tr.className = 'border-top'
        }
        
        const cells = rawRow.split('&')
        for (let i = 0; i < cells.length; i++) {
          const td = document.createElement('td')
          const cellText = cells[i].trim()
          td.innerHTML = this.renderInline(cellText, block.line)
          
          const spec = colStyles[i] || { align: 'left', borderLeft: false }
          td.style.textAlign = spec.align
          if (spec.borderLeft) {
            td.style.borderLeft = '1px solid #000000'
          }
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      }
      table.appendChild(tbody)
      el.appendChild(table)
    }

    if (captionText) {
      const captionEl = document.createElement('div')
      captionEl.className = 'latex-table-caption'
      captionEl.innerHTML = `<strong>Table ${block.number}:</strong> ` + this.renderInline(captionText, block.line)
      el.appendChild(captionEl)
    }
    return el
  }

  renderBibliography(block) {
    const el = document.createElement('div')
    el.className = 'latex-bibliography'
    el.dataset.sourceLine = block.line
    
    const heading = document.createElement('h2')
    heading.className = 'latex-bibliography-heading'
    heading.innerText = 'References'
    el.appendChild(heading)
    
    const list = document.createElement('ul')
    list.className = 'latex-bib-list'
    
    const bibItems = block.content.split(/\\bibitem\s*\{([^}]+)\}/)
    let idx = 1
    for (let i = 1; i < bibItems.length; i += 2) {
      const key = bibItems[i]
      const desc = bibItems[i+1].trim()
      
      const li = document.createElement('li')
      li.className = 'latex-bib-item'
      li.id = `bib-${key}`
      
      const label = document.createElement('span')
      label.className = 'bib-label'
      label.innerText = `[${idx}] `
      li.appendChild(label)
      
      const text = document.createElement('span')
      text.innerHTML = this.renderInline(desc, block.line)
      li.appendChild(text)
      
      list.appendChild(li)
      idx++
    }
    el.appendChild(list)
    return el
  }

  renderBrokenEnv(block) {
    const el = document.createElement('div')
    el.className = 'latex-warning-box'
    el.dataset.sourceLine = block.line
    el.innerHTML = `<strong>⚠ Parse error near line ${block.line}:</strong> Mismatched or unclosed environment \\begin{${block.envName}}.`
    return el
  }

  renderTikzpicture(block) {
    const el = document.createElement('div')
    el.className = 'latex-tikzpicture'
    el.dataset.sourceLine = block.line
    el.style.position = 'relative'
    el.style.width = '100%'
    el.style.height = '100%' // Usually takes full page height
    el.style.overflow = 'visible'

    // Parse \node[opts] at (x,y) {content};
    const nodeRegex = /\\node\[(.*?)\]\s*at\s*\(([^,]+),([^)]+)\)\s*\{([\s\S]*?)\};/g
    let match
    
    // Scale factor since LaTeX bp (big points) are 1/72 inch, same as CSS pt or px depending on DPI
    // But PyMuPDF coordinates might need a generic scaling. We'll use absolute px.
    const scale = 1.0 

    while ((match = nodeRegex.exec(block.content)) !== null) {
      const optsStr = match[1]
      const x = parseFloat(match[2])
      const y = parseFloat(match[3])
      const content = match[4]
      
      // Calculate approximate line number of this node within the block content
      const contentBefore = block.content.substring(0, match.index)
      const localLine = contentBefore.split('\\n').length - 1
      const actualLineNum = block.line + localLine + 1 // +1 for \begin{tikzpicture} line

      const nodeDiv = document.createElement('div')
      nodeDiv.className = 'tikz-node'
      nodeDiv.dataset.sourceLine = actualLineNum
      nodeDiv.style.position = 'absolute'
      nodeDiv.style.left = `${x * scale}px`
      nodeDiv.style.top = `${y * scale}px`
      
      // Parse options like text width
      if (optsStr.includes('text width=')) {
        const widthMatch = optsStr.match(/text width=([\d.]+)bp/)
        if (widthMatch) {
          nodeDiv.style.width = `${parseFloat(widthMatch[1]) * scale}px`
        }
      }

      // Check if it's an image
      if (content.startsWith('\\includegraphics')) {
        const imgMatch = content.match(/\\includegraphics\[(.*?)\]\{(.*?)\}/)
        if (imgMatch) {
          const imgOpts = imgMatch[1]
          const imgSrc = imgMatch[2]
          
          let w = 'auto', h = 'auto'
          if (imgOpts.includes('width=')) w = imgOpts.match(/width=([\d.]+)bp/)?.[1] + 'px'
          if (imgOpts.includes('height=')) h = imgOpts.match(/height=([\d.]+)bp/)?.[1] + 'px'
          
          nodeDiv.innerHTML = `<img src="/api/outputs/images/${imgSrc.split('/').pop()}" style="width:${w}; height:${h};" alt="extracted image" />`
        }
      } else {
        // Text node
        nodeDiv.contentEditable = "true"
        nodeDiv.style.cursor = "text"
        nodeDiv.style.outline = "none"
        
        let innerText = content.trim()
        
        // Strip outer braces if present (e.g., from fallback spans)
        if (innerText.startsWith('{') && innerText.endsWith('}')) {
          innerText = innerText.substring(1, innerText.length - 1).trim()
        }

        // Find the FIRST color to apply to the div
        const tcMatch = innerText.match(/\\textcolor\[HTML\]\{([A-Fa-f0-9]+)\}/)
        if (tcMatch) {
          nodeDiv.style.color = '#' + tcMatch[1]
        }
        
        // Find the FIRST font size to apply to the div
        const fsMatch = innerText.match(/\\fontsize\{([\d.]+)bp\}\{[\d.]+bp\}\\selectfont/)
        if (fsMatch) {
          nodeDiv.style.fontSize = fsMatch[1] + 'px'
          nodeDiv.style.lineHeight = (parseFloat(fsMatch[1]) * 1.2) + 'px'
        }

        // Now STRIP ALL raw latex font formatting from innerText so it doesn't clutter the view!
        innerText = innerText.replace(/\\textcolor\[HTML\]\{[A-Fa-f0-9]+\}\s*\{/g, '')
        innerText = innerText.replace(/\\fontsize\{[\d.]+bp\}\{[\d.]+bp\}\\selectfont\s*/g, '')
        
        // Clean up dangling braces that were left behind by stripping the opening \textcolor{
        innerText = innerText.replace(/^\{+/, '').replace(/\}+$/, '').trim()
        
        // Also remove braces from \textbf{} etc if any (optional, but renderInline handles it partially)
        nodeDiv.innerHTML = this.renderInline(innerText, actualLineNum)
        
        // Add special class to bind events later
        nodeDiv.classList.add('tikz-editable-text')
      }

      el.appendChild(nodeDiv)
    }

    return el
  }

  compile() {
    this.preScan()
    const blocks = this.parseBlocks()
    this.processStructure(blocks)
    
    const renderedElements = []
    for (let block of blocks) {
      let node
      if (block.type === 'maketitle') {
        node = this.renderMaketitle(block)
      } else if (block.type === 'tableofcontents') {
        node = this.renderTableOfContents(block)
      } else if (block.type === 'abstract') {
        node = this.renderAbstract(block)
      } else if (['section', 'subsection', 'subsubsection'].includes(block.type)) {
        node = this.renderSection(block)
      } else if (block.type === 'paragraph') {
        node = this.renderParagraph(block)
      } else if (block.type === 'displaymath') {
        node = this.renderEquation(block)
      } else if (block.type === 'broken_env') {
        node = this.renderBrokenEnv(block)
      } else if (block.type === 'environment') {
        if (block.envName === 'tikzpicture') {
          node = this.renderTikzpicture(block)
        } else if (['itemize', 'enumerate', 'description'].includes(block.envName)) {
          node = this.renderList(block)
        } else if (block.envName === 'equation' || block.envName === 'align') {
          node = this.renderEquation(block)
        } else if (block.envName === 'figure') {
          node = this.renderFigure(block)
        } else if (block.envName === 'table') {
          node = this.renderTable(block)
        } else if (block.envName === 'abstract') {
          node = this.renderAbstract(block)
        } else if (block.envName === 'thebibliography') {
          node = this.renderBibliography(block)
        } else {
          node = document.createElement('div')
          node.className = 'latex-fallback-block'
          node.dataset.sourceLine = block.line
          node.innerHTML = this.renderInline(block.content, block.line)
        }
      }
      if (node) {
        renderedElements.push(node)
      }
    }
    
    this.errors = this.checkErrors(this.source)
    return {
      elements: renderedElements,
      errors: this.errors,
      outline: this.outline,
      footnotes: this.footnotes
    }
  }

  checkErrors(text) {
    const errors = []
    const cleanText = this.cleanText
    
    const braceStack = []
    for (let i = 0; i < cleanText.length; i++) {
      if (cleanText[i] === '{' && (i === 0 || cleanText[i-1] !== '\\')) {
        braceStack.push({ pos: i, line: this.getLineNum(i) })
      } else if (cleanText[i] === '}' && (i === 0 || cleanText[i-1] !== '\\')) {
        if (braceStack.length === 0) {
          errors.push({
            line: this.getLineNum(i),
            message: "Mismatched closing brace '}'",
            severity: "error",
            from: i,
            to: i + 1
          })
        } else {
          braceStack.pop()
        }
      }
    }
    for (let open of braceStack) {
      errors.push({
        line: open.line,
        message: "Unbalanced braces (Unclosed '{')",
        severity: "error",
        from: open.pos,
        to: open.pos + 1
      })
    }
    
    const envStack = []
    const envRegex = /\\(begin|end)\s*\{([^}]+)\}/g
    let match
    while ((match = envRegex.exec(cleanText)) !== null) {
      const type = match[1]
      const envName = match[2]
      const line = this.getLineNum(match.index)
      const startPos = match.index
      const endPos = match.index + match[0].length
      
      if (type === 'begin') {
        envStack.push({ name: envName, pos: startPos, line: line })
      } else {
        if (envStack.length === 0) {
          errors.push({
            line: line,
            message: `Mismatched \\end{${envName}} without matching \\begin`,
            severity: "error",
            from: startPos,
            to: endPos
          })
        } else {
          const last = envStack.pop()
          if (last.name !== envName) {
            errors.push({
              line: line,
              message: `Mismatched environment: expected \\end{${last.name}}, found \\end{${envName}}`,
              severity: "error",
              from: startPos,
              to: endPos
            })
          }
        }
      }
    }
    for (let unclosed of envStack) {
      errors.push({
        line: unclosed.line,
        message: `Unclosed environment \\begin{${unclosed.name}}`,
        severity: "error",
        from: unclosed.pos,
        to: unclosed.pos + 12
      })
    }
    
    const emptyArgRegex = /\\(section|subsection|subsubsection|ref|cite|footnote)\s*\{\s*\}/g
    while ((match = emptyArgRegex.exec(cleanText)) !== null) {
      errors.push({
        line: this.getLineNum(match.index),
        message: `Empty required argument for \\${match[1]}`,
        severity: "error",
        from: match.index,
        to: match.index + match[0].length
      })
    }

    const refCheckRegex = /\\ref\s*\{([^}]+)\}/g
    while ((match = refCheckRegex.exec(cleanText)) !== null) {
      const key = match[1]
      if (!this.labels[key]) {
        errors.push({
          line: this.getLineNum(match.index),
          message: `Unresolved cross-reference: \\ref{${key}}`,
          severity: "warning",
          from: match.index,
          to: match.index + match[0].length
        })
      }
    }

    const citeCheckRegex = /\\cite\s*\{([^}]+)\}/g
    while ((match = citeCheckRegex.exec(cleanText)) !== null) {
      const key = match[1]
      if (!this.citations[key]) {
        errors.push({
          line: this.getLineNum(match.index),
          message: `Unresolved citation reference: \\cite{${key}}`,
          severity: "warning",
          from: match.index,
          to: match.index + match[0].length
        })
      }
    }
    
    return errors
  }
}

// ─────────────────────────────────────────────────────────────────
// CODEMIRROR INTERACTION STATE FIELDS & ACTIONS
// ─────────────────────────────────────────────────────────────────
const highlightLineEffect = StateEffect.define()
const clearHighlightEffect = StateEffect.define()
const highlightDecoration = Decoration.line({
  attributes: { class: "cm-sync-highlight" }
})

const highlightField = StateField.define({
  create() { return Decoration.none },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes)
    for (let e of tr.effects) {
      if (e.is(highlightLineEffect)) {
        const linePos = tr.state.doc.line(e.value).from
        decorations = Decoration.set([highlightDecoration.range(linePos)])
      } else if (e.is(clearHighlightEffect)) {
        decorations = Decoration.none
      }
    }
    return decorations
  },
  provide: f => EditorView.decorations.from(f)
})

const greenFlashEffect = StateEffect.define()
const clearGreenFlashEffect = StateEffect.define()
const greenFlashDeco = Decoration.line({
  attributes: { class: "cm-green-flash" }
})

const greenFlashField = StateField.define({
  create() { return Decoration.none },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes)
    for (let e of tr.effects) {
      if (e.is(greenFlashEffect)) {
        const pos = tr.state.doc.line(e.value).from
        decorations = Decoration.set([greenFlashDeco.range(pos)])
      } else if (e.is(clearGreenFlashEffect)) {
        decorations = Decoration.none
      }
    }
    return decorations
  },
  provide: f => EditorView.decorations.from(f)
})

const searchEffect = StateEffect.define()
const searchMatchDeco = Decoration.mark({ class: "cm-search-match" })
const activeSearchMatchDeco = Decoration.mark({ class: "cm-search-match-active" })

const searchField = StateField.define({
  create() { return Decoration.none },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes)
    for (let e of tr.effects) {
      if (e.is(searchEffect)) {
        const ranges = e.value.matches.map((m, idx) => {
          if (idx === e.value.activeIndex) {
            return activeSearchMatchDeco.range(m.from, m.to)
          }
          return searchMatchDeco.range(m.from, m.to)
        })
        decorations = Decoration.set(ranges, true)
      }
    }
    return decorations
  },
  provide: f => EditorView.decorations.from(f)
})

const setHoverLineEffect = StateEffect.define()
const clearHoverLineEffect = StateEffect.define()
const hoverGutterMarker = new class extends GutterMarker {
  toDOM() {
    const el = document.createElement("span")
    el.className = "cm-hover-chevron"
    el.innerText = "▶"
    return el
  }
}

const hoverLineField = StateField.define({
  create() { return null },
  update(value, tr) {
    for (let e of tr.effects) {
      if (e.is(setHoverLineEffect)) return e.value
      if (e.is(clearHoverLineEffect)) return null
    }
    return value
  }
})

const hoverGutter = gutter({
  class: "cm-hover-gutter",
  markers: v => {
    const hoverLine = v.state.field(hoverLineField)
    if (hoverLine !== null && hoverLine >= 1 && hoverLine <= v.state.doc.lines) {
      const pos = v.state.doc.line(hoverLine).from
      return Decoration.set([hoverGutterMarker.range(pos)])
    }
    return Decoration.none
  }
})

// ─────────────────────────────────────────────────────────────────
// MAIN LIVE EDITOR COMPONENT
// ─────────────────────────────────────────────────────────────────
export default function LaTeXEditor({ code, onCodeChange, jobId, onReset, saveToBackend, loadFromBackend, compileAndDownloadPdf, compileAndDownloadDocx }) {
  const [zoom, setZoom] = useState(() => {
    try {
      return parseInt(localStorage.getItem('latex-editor-zoom') || '100')
    } catch (e) {
      return 100
    }
  })
  const [autoCompile, setAutoCompile] = useState(true)
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false)
  const [outline, setOutline] = useState([])
  const [errors, setErrors] = useState([])
  const [stats, setStats] = useState({ words: 0, chars: 0, lines: 0, sections: 0, equations: 0, tables: 0, figures: 0 })
  const [isStatsOpen, setIsStatsOpen] = useState(false)
  
  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatches, setSearchMatches] = useState([])
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [isRegex, setIsRegex] = useState(false)
  const [replaceQuery, setReplaceQuery] = useState('')

  // Command palette state
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0)

  // Diagnostics status
  const [compileStatus, setCompileStatus] = useState('Ready')
  const [compileTime, setCompileTime] = useState('')
  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(true)
  const [downloadError, setDownloadError] = useState('')
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null)
  const [isBackendCompiling, setIsBackendCompiling] = useState(false)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [activeOutlineLine, setActiveOutlineLine] = useState(1)

  const [savedIndicatorVisible, setSavedIndicatorVisible] = useState(false)
  const [saveStatus, setSaveStatus] = useState('') // '', 'saving', 'saved', 'error'
  const [lastSavedAt, setLastSavedAt] = useState('')
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false)
  const [compiledPageCount, setCompiledPageCount] = useState(0)
  const [compileTimestamp, setCompileTimestamp] = useState(Date.now())

  // DOM Refs
  const editorContainerRef = useRef(null)
  const editorViewRef = useRef(null)
  const pdfPagesContainerRef = useRef(null)
  const pdfViewerPaneRef = useRef(null)
  const pdfZoomWrapperRef = useRef(null)
  const leftPaneRef = useRef(null)
  const dividerRef = useRef(null)
  const tooltipRef = useRef(null)

  // Sync state helpers
  const compiledBlocksRef = useRef([])
  const lastActiveBlockRef = useRef(null)
  const documentDirtyRef = useRef(false)
  const backendSyncTimerRef = useRef(null)

  // 1. Initialize CodeMirror
  useEffect(() => {
    if (!editorContainerRef.current) return

    const latexLanguage = StreamLanguage.define(stex)
    
    const themeConfig = EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" }
    })

    const startState = EditorState.create({
      doc: code || '',
      extensions: [
        themeConfig,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        foldGutter(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap
        ]),
        history(),
        latexLanguage,
        
        highlightField,
        greenFlashField,
        searchField,
        hoverLineField,
        hoverGutter,
        
        lintGutter(),
        
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            const pos = update.state.selection.main.head
            const line = update.state.doc.lineAt(pos)
            const col = pos - line.from + 1
            setCursorPos({ line: line.number, col })
            
            // Highlight active outline item
            setActiveOutlineLine(line.number)
            
            // Trigger forward scroll
            syncCodeToPdf(line.number)
          }
          
          if (update.docChanged) {
            documentDirtyRef.current = true
            const newCode = update.state.doc.toString()
            onCodeChange?.(newCode)
          }
        })
      ]
    })

    const view = new EditorView({
      state: startState,
      parent: editorContainerRef.current
    })

    editorViewRef.current = view

    return () => {
      view.destroy()
    }
  }, [])

  // Update CodeMirror doc when code prop changes from parent (e.g. initial load)
  useEffect(() => {
    if (editorViewRef.current && code !== editorViewRef.current.state.doc.toString()) {
      editorViewRef.current.dispatch({
        changes: { from: 0, to: editorViewRef.current.state.doc.length, insert: code }
      })
    }
  }, [code])

  // Apply zoom changes
  useEffect(() => {
    if (pdfZoomWrapperRef.current) {
      pdfZoomWrapperRef.current.style.setProperty('--pdf-zoom', zoom / 100)
      pdfZoomWrapperRef.current.style.transform = `scale(${zoom / 100})`
      localStorage.setItem('latex-editor-zoom', zoom.toString())
    }
  }, [zoom])

  // The 2s localStorage sync was removed in favor of backend database sync

  // Backend sync (every 30s)
  useEffect(() => {
    if (!jobId || !saveToBackend) return
    backendSyncTimerRef.current = setInterval(async () => {
      if (editorViewRef.current) {
        const source = editorViewRef.current.state.doc.toString()
        const pos = editorViewRef.current.state.selection.main.head
        const line = editorViewRef.current.state.doc.lineAt(pos)
        const scrollPos = pdfViewerPaneRef.current?.scrollTop || 0
        setSaveStatus('saving')
        const success = await saveToBackend(jobId, source, line.number, pos - line.from + 1, scrollPos)
        if (success) {
          setSaveStatus('saved')
          setLastSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
        } else {
          setSaveStatus('error')
        }
        setTimeout(() => setSaveStatus(''), 2000)
      }
    }, 10000)
    return () => {
      if (backendSyncTimerRef.current) clearInterval(backendSyncTimerRef.current)
    }
  }, [jobId, saveToBackend])

  // Explicit save handler
  const handleExplicitSave = useCallback(async () => {
    if (!editorViewRef.current || !jobId || !saveToBackend) return
    const source = editorViewRef.current.state.doc.toString()
    const pos = editorViewRef.current.state.selection.main.head
    const line = editorViewRef.current.state.doc.lineAt(pos)
    const scrollPos = pdfViewerPaneRef.current?.scrollTop || 0
    setSaveStatus('saving')
    const success = await saveToBackend(jobId, source, line.number, pos - line.from + 1, scrollPos)
    if (success) {
      setSaveStatus('saved')
      setLastSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } else {
      setSaveStatus('error')
    }
    setTimeout(() => setSaveStatus(''), 2000)
  }, [jobId, saveToBackend])

  // Download as PDF handler
  const handleDownloadPdf = useCallback(async () => {
    if (!editorViewRef.current || !jobId || !compileAndDownloadPdf) return
    setIsDownloadingPdf(true)
    setDownloadError('')
    try {
      const source = editorViewRef.current.state.doc.toString()
      const success = await compileAndDownloadPdf(jobId, source)
      if (!success) setDownloadError('PDF compilation failed')
    } catch (e) {
      setDownloadError(e.message || 'PDF download failed')
    } finally {
      setIsDownloadingPdf(false)
    }
  }, [jobId, compileAndDownloadPdf])

  // Download as DOCX handler
  const handleDownloadDocx = useCallback(async () => {
    if (!editorViewRef.current || !jobId || !compileAndDownloadDocx) return
    setIsDownloadingDocx(true)
    setDownloadError('')
    try {
      const source = editorViewRef.current.state.doc.toString()
      const success = await compileAndDownloadDocx(jobId, source)
      if (!success) setDownloadError('DOCX conversion failed')
    } catch (e) {
      setDownloadError(e.message || 'DOCX download failed')
    } finally {
      setIsDownloadingDocx(false)
    }
  }, [jobId, compileAndDownloadDocx])

  // Helper: jump/highlight in editor
  const highlightLine = useCallback((lineNum) => {
    const editor = editorViewRef.current
    if (!editor || lineNum < 1 || lineNum > editor.state.doc.lines) return
    const line = editor.state.doc.line(lineNum)
    editor.dispatch({
      selection: { anchor: line.from, head: line.from },
      scrollIntoView: true,
      effects: [highlightLineEffect.of(lineNum)]
    })
    
    editor.focus()
    
    setTimeout(() => {
      editor.dispatch({
        effects: [clearHighlightEffect.of()]
      })
    }, 1500)
  }, [])

  // Compilation & Pagination Engine
  const compileLatex = useCallback(() => {
    if (!editorViewRef.current) return
    
    setCompileStatus('Compiling')
    const text = editorViewRef.current.state.doc.toString()
    
    // Proximity Scroll Preservation: Save reading position
    const savedPos = getTopmostVisibleSourceLine()

    try {
      // Compiler Run
      const compiler = new LaTeXCompiler(text, (line) => highlightLine(line))
      const res = compiler.compile()
      
      compiledBlocksRef.current = compiler.parseBlocks()
      setOutline(res.outline)
      setErrors(res.errors)

      // Statistics Calculation
      const words = text.replace(/\\.*/g, '').replace(/[^a-zA-Z\s]/g, '').trim().split(/\s+/).filter(w => w.length > 0).length
      setStats({
        words,
        chars: text.length,
        lines: text.split('\n').length,
        sections: res.outline.length,
        equations: compiler.equationCount,
        tables: compiler.tableCount,
        figures: compiler.figureCount
      })

      // Remove renderDocument call. Instead, we use the PDF imagery from backend

      // Restore Reading Position
      restoreReadingPosition(savedPos)

      // Update status indicators
      const errorCount = res.errors.filter(e => e.severity === 'error').length
      if (res.errors.length > 0) {
        setCompileStatus(errorCount > 0 ? 'Error' : 'Warning')
      } else {
        setCompileStatus('Ready')
      }
      
      const now = new Date()
      setCompileTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))

      // Trigger backend compilation for Live PDF Viewer
      if (jobId) {
        setIsBackendCompiling(true)
        fetch(`/api/export/compile-pdf/${jobId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latex_code: text })
        })
        .then(response => {
          if (!response.ok) throw new Error('Backend compilation failed')
          return response.blob()
        })
        .then(blob => {
          setPdfPreviewUrl(prev => {
            if (prev) URL.revokeObjectURL(prev)
            return URL.createObjectURL(blob)
          })
          // Also fetch the updated page count to render imagery
          return fetch(`/api/export/preview-compiled/count/${jobId}`)
        })
        .then(res => {
          if (res) return res.json()
        })
        .then(data => {
          if (data) {
            setCompiledPageCount(data.count)
            setCompileTimestamp(Date.now())
          }
          setIsBackendCompiling(false)
        })
        .catch(err => {
          console.error('Backend compilation failed, trying fallback images:', err)
          // Fallback: still try to fetch page count so we can show original PDF images
          fetch(`/api/export/preview-compiled/count/${jobId}`)
            .then(res => res.json())
            .then(data => {
              setCompiledPageCount(data.count)
              setCompileTimestamp(Date.now())
              setIsBackendCompiling(false)
            })
            .catch(() => setIsBackendCompiling(false))
        })
      }
    } catch (error) {
      console.error('LaTeX compilation failed:', error)
      setCompileStatus('Error')
      setErrors([{ line: 1, from: 0, to: 0, message: (error.stack || error.message || 'Fatal compilation error').substring(0, 200), severity: 'error' }])
      
      const now = new Date()
      setCompileTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
  }, [highlightLine, jobId])

  // Trigger compilation when code changes (debounced if auto-compile is ON)
  useEffect(() => {
    if (!autoCompile) return
    const timer = setTimeout(() => {
      compileLatex()
    }, 800)
    return () => clearTimeout(timer)
  }, [code, autoCompile, compileLatex])

  // Trigger initial compile when CodeMirror is ready
  useEffect(() => {
    const timer = setTimeout(() => {
      compileLatex()
    }, 200)
    return () => clearTimeout(timer)
  }, [compileLatex])



  // Drag Resizer logic
  useEffect(() => {
    const leftPane = leftPaneRef.current
    const divider = dividerRef.current
    if (!leftPane || !divider) return

    const savedWidth = localStorage.getItem('latex-editor-divider-pos')
    if (savedWidth) leftPane.style.width = savedWidth

    const onMouseDown = (e) => {
      const startX = e.clientX
      const startWidth = leftPane.getBoundingClientRect().width
      
      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX
        const totalWidth = leftPane.parentElement.getBoundingClientRect().width
        const newPercent = ((startWidth + deltaX) / totalWidth) * 100
        if (newPercent > 20 && newPercent < 80) {
          leftPane.style.width = `${newPercent}%`
          localStorage.setItem('latex-editor-divider-pos', `${newPercent}%`)
        }
      }
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        divider.classList.remove('resizing')
        document.body.style.userSelect = ''
      }

      divider.classList.add('resizing')
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    }

    divider.addEventListener('mousedown', onMouseDown)
    return () => {
      divider.removeEventListener('mousedown', onMouseDown)
    }
  }, [])



  // Formatting Code logic
  const handleFormat = () => {
    const editor = editorViewRef.current
    if (!editor) return
    const text = editor.state.doc.toString()
    
    // Formatter implementation
    const lines = text.split('\n')
    let indentLevel = 0
    const indentWidth = 2
    const formattedLines = []
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim()
      if (line.match(/^\\end\s*\{/)) {
        indentLevel = Math.max(0, indentLevel - 1)
      }
      
      const indentStr = ' '.repeat(indentLevel * indentWidth)
      if (line === '') {
        formattedLines.push('')
      } else {
        let indentedLine = indentStr + line
        if (indentedLine.length > 80 && !line.startsWith('\\') && !line.startsWith('$$') && !line.includes('$')) {
          const words = line.split(' ')
          let currentLine = indentStr
          for (let word of words) {
            if ((currentLine + ' ' + word).length > 80) {
              formattedLines.push(currentLine.trimEnd())
              currentLine = indentStr + word
            } else {
              if (currentLine === indentStr) {
                currentLine += word
              } else {
                currentLine += ' ' + word
              }
            }
          }
          if (currentLine.trim() !== '') {
            formattedLines.push(currentLine.trimEnd())
          }
        } else {
          formattedLines.push(indentedLine)
        }
      }
      
      if (line.match(/^\\begin\s*\{/)) {
        indentLevel++
      }
    }

    const formatted = formattedLines.join('\n')
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: formatted },
      effects: [greenFlashEffect.of(1)]
    })
    compileLatex()

    setTimeout(() => {
      editor.dispatch({ effects: [clearGreenFlashEffect.of()] })
    }, 1500)
  }



  const handleExportTex = () => {
    const editor = editorViewRef.current
    if (!editor) return
    const source = editor.state.doc.toString()
    const blob = new Blob([source], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'document.tex'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // CodeMirror diagnostics mapping
  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    
    const diagnostics = errors.map(err => ({
      from: err.from,
      to: err.to,
      severity: err.severity,
      message: err.message
    }))
    
    view.dispatch(setDiagnostics(view.state, diagnostics))
  }, [errors])



  // Scroll Helpers
  const getTopmostVisibleSourceLine = () => {
    const pane = pdfViewerPaneRef.current
    if (!pane) return null
    const paneRect = pane.getBoundingClientRect()
    const elements = pane.querySelectorAll('[data-source-line]')
    for (let el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.top >= paneRect.top && rect.top <= paneRect.bottom) {
        return {
          line: parseInt(el.getAttribute('data-source-line')),
          offset: rect.top - paneRect.top
        }
      }
    }
    return null
  }

  const restoreReadingPosition = (savedPos) => {
    if (!savedPos) return
    const pane = pdfViewerPaneRef.current
    if (!pane) return
    const el = pane.querySelector(`[data-source-line="${savedPos.line}"]`)
    if (el) {
      const paneRect = pane.getBoundingClientRect()
      pane.scrollTop = pane.scrollTop + (el.getBoundingClientRect().top - paneRect.top) - savedPos.offset
    }
  }

  // FORWARD SYNC
  const syncCodeToPdf = (lineNum) => {
    let bestBlock = null
    for (let block of compiledBlocksRef.current) {
      if (block.line <= lineNum) {
        if (!bestBlock || block.line > bestBlock.line) {
          bestBlock = block
        }
      }
    }
    
    if (bestBlock && bestBlock !== lastActiveBlockRef.current) {
      lastActiveBlockRef.current = bestBlock
      const target = pdfPagesContainerRef.current?.querySelector(`[data-source-line="${bestBlock.line}"]`)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        target.classList.remove('pdf-highlight-flash')
        void target.offsetWidth 
        target.classList.add('pdf-highlight-flash')
      }
    }
  }

  // INVERSE SYNC / HOVER & EDIT MOUSE EVENTS
  const attachPdfEvents = () => {
    const tooltip = tooltipRef.current
    const viewer = pdfViewerPaneRef.current
    const editor = editorViewRef.current
    if (!viewer || !editor) return

    // Hover chevrons
    const hoverElements = viewer.querySelectorAll('[data-source-line]')
    hoverElements.forEach(el => {
      el.addEventListener('mousemove', (e) => {
        e.stopPropagation()
        const lineNum = parseInt(el.getAttribute('data-source-line'))
        
        if (tooltip) {
          tooltip.innerText = `Line ${lineNum}`
          tooltip.style.left = (e.clientX + 15) + 'px'
          tooltip.style.top = (e.clientY + 15) + 'px'
          tooltip.style.display = 'block'
        }
        
        editor.dispatch({ effects: [setHoverLineEffect.of(lineNum)] })
      })
      
      el.addEventListener('mouseleave', () => {
        if (tooltip) tooltip.style.display = 'none'
        editor.dispatch({ effects: [clearHoverLineEffect.of()] })
      })

      // Single Click Sync
      el.addEventListener('click', (e) => {
        if (el.isContentEditable) return
        e.stopPropagation()
        const lineNum = parseInt(el.getAttribute('data-source-line'))
        highlightLine(lineNum)
        
        el.classList.add('pdf-click-active')
        setTimeout(() => { el.classList.remove('pdf-click-active') }, 1500)
      })

      // Double Click Edit
      el.addEventListener('dblclick', (e) => {
        const isInsideMath = el.closest('.katex') || el.closest('.latex-equation-block')
        const isHeading = el.closest('h2') || el.closest('h3') || el.closest('h4')
        const isFloat = el.closest('.latex-table-container') || el.closest('.latex-figure')
        
        if (isInsideMath || isHeading || isFloat) return
        
        e.preventDefault()
        e.stopPropagation()
        
        const originalText = el.innerText
        el.contentEditable = "true"
        el.focus()
        el.classList.add('inline-editing')
        
        let cancelled = false

        const finishEdit = () => {
          el.contentEditable = "false"
          el.classList.remove('inline-editing')
          
          if (cancelled) {
            el.innerText = originalText
            return
          }

          const newText = el.innerText
          if (originalText !== newText) {
            const lineNum = parseInt(el.getAttribute('data-source-line'))
            replaceTextInSource(originalText, newText, lineNum)
          }
        }
        
        el.addEventListener('blur', finishEdit, { once: true })
        
        el.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
            evt.preventDefault()
            el.blur()
          }
          if (evt.key === 'Escape') {
            cancelled = true
            evt.preventDefault()
            el.blur()
          }
        })
      })
    })

    // Inline citations and references navigation
    viewer.querySelectorAll('.pdf-ref').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const key = link.dataset.ref
        const text = editor.state.doc.toString()
        const target = `\\label{${key}}`
        const idx = text.indexOf(target)
        if (idx !== -1) {
          highlightLine(editor.state.doc.lineAt(idx).number)
        }
      })
    })
    
    viewer.querySelectorAll('.pdf-cite').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const key = link.dataset.cite
        const text = editor.state.doc.toString()
        const target = `\\bibitem{${key}}`
        const idx = text.indexOf(target)
        if (idx !== -1) {
          highlightLine(editor.state.doc.lineAt(idx).number)
        }
      })
    })
  }

  // Backwards fuzzy replace
  const replaceTextInSource = (oldText, newText, lineNum) => {
    const editor = editorViewRef.current
    if (!editor) return
    const doc = editor.state.doc
    const numLines = doc.lines
    const radius = 5
    const start = Math.max(1, lineNum - radius)
    const end = Math.min(numLines, lineNum + radius)
    
    const cleanStr = (s) => s.replace(/\s+/g, ' ').trim()
    const cleanedOld = cleanStr(oldText)
    if (!cleanedOld) return

    for (let offset = 0; offset <= radius; offset++) {
      const linesToCheck = []
      if (lineNum - offset >= start) linesToCheck.push(lineNum - offset)
      if (offset > 0 && lineNum + offset <= end) linesToCheck.push(lineNum + offset)
      
      for (let l of linesToCheck) {
        const lineText = doc.line(l).text
        
        let idx = lineText.indexOf(oldText)
        if (idx !== -1) {
          const startPos = doc.line(l).from + idx
          editor.dispatch({
            changes: { from: startPos, to: startPos + oldText.length, insert: newText }
          })
          compileLatex()
          return
        }
        
        const cleanedLine = cleanStr(lineText)
        if (cleanedLine.indexOf(cleanedOld) !== -1) {
          const words = oldText.split(/\s+/).filter(w => w.length > 0)
          let firstWord = words[0]
          let lastWord = words[words.length - 1]
          let firstIdx = lineText.indexOf(firstWord)
          let lastIdx = lineText.indexOf(lastWord, firstIdx)
          
          if (firstIdx !== -1 && lastIdx !== -1) {
            const startPos = doc.line(l).from + firstIdx
            const endPos = doc.line(l).from + lastIdx + lastWord.length
            editor.dispatch({
              changes: { from: startPos, to: endPos, insert: newText }
            })
            compileLatex()
            return
          }
        }
      }
    }

    // Global Fallback search
    for (let l = 1; l <= numLines; l++) {
      const lineText = doc.line(l).text
      let idx = lineText.indexOf(oldText)
      if (idx !== -1) {
        const startPos = doc.line(l).from + idx
        editor.dispatch({
          changes: { from: startPos, to: startPos + oldText.length, insert: newText }
        })
        compileLatex()
        return
      }
    }
  }

  // Command Snippets Palette keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        setIsPaletteOpen(true)
        setPaletteSearch('')
        setPaletteSelectedIndex(0)
      }
      if (e.key === 'Escape') {
        setIsPaletteOpen(false)
        setIsStatsOpen(false)
        setIsSearchOpen(false)
      }
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        setIsSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Command palette search items
  const filteredSnippets = SNIPPETS.filter(item => 
    item.name.toLowerCase().includes(paletteSearch.toLowerCase()) || 
    item.desc.toLowerCase().includes(paletteSearch.toLowerCase())
  )

  const insertSnippet = (snippet) => {
    const editor = editorViewRef.current
    if (!editor) return
    
    const selection = editor.state.selection.main
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert: snippet.code },
      selection: { anchor: selection.from + snippet.code.length }
    })
    setIsPaletteOpen(false)
    editor.focus()
  }

  const handlePaletteKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setPaletteSelectedIndex(prev => (prev + 1) % filteredSnippets.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setPaletteSelectedIndex(prev => (prev - 1 + filteredSnippets.length) % filteredSnippets.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredSnippets[paletteSelectedIndex]) {
        insertSnippet(filteredSnippets[paletteSelectedIndex])
      }
    }
  }

  // Find & Replace Search implementation
  const performSearch = () => {
    const editor = editorViewRef.current
    if (!editor || !searchQuery) {
      setSearchMatches([])
      setSearchActiveIndex(-1)
      if (editor) {
        editor.dispatch({ effects: [searchEffect.of({ matches: [], activeIndex: -1 })] })
      }
      return
    }

    const docText = editor.state.doc.toString()
    const matches = []

    try {
      if (isRegex) {
        const flags = caseSensitive ? 'g' : 'gi'
        const regex = new RegExp(searchQuery, flags)
        let match
        while ((match = regex.exec(docText)) !== null) {
          if (match[0].length === 0) break
          matches.push({ from: match.index, to: match.index + match[0].length })
        }
      } else {
        const searchStr = caseSensitive ? searchQuery : searchQuery.toLowerCase()
        const targetText = caseSensitive ? docText : docText.toLowerCase()
        let idx = targetText.indexOf(searchStr)
        while (idx !== -1) {
          matches.push({ from: idx, to: idx + searchStr.length })
          idx = targetText.indexOf(searchStr, idx + searchStr.length)
        }
      }
    } catch (err) {}

    setSearchMatches(matches)
    let activeIdx = -1
    if (matches.length > 0) {
      activeIdx = 0
      setSearchActiveIndex(0)
      editor.dispatch({
        selection: { anchor: matches[0].from, head: matches[0].to },
        scrollIntoView: true,
        effects: [searchEffect.of({ matches, activeIndex: 0 })]
      })
    } else {
      setSearchActiveIndex(-1)
      editor.dispatch({ effects: [searchEffect.of({ matches: [], activeIndex: -1 })] })
    }
  }

  const navigateSearch = (direction) => {
    const editor = editorViewRef.current
    if (!editor || searchMatches.length === 0) return

    let nextIdx = searchActiveIndex + direction
    if (nextIdx >= searchMatches.length) nextIdx = 0
    if (nextIdx < 0) nextIdx = searchMatches.length - 1

    setSearchActiveIndex(nextIdx)
    const match = searchMatches[nextIdx]
    editor.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true,
      effects: [searchEffect.of({ matches: searchMatches, activeIndex: nextIdx })]
    })
  }

  const handleReplace = () => {
    const editor = editorViewRef.current
    if (!editor || searchActiveIndex === -1 || !searchMatches[searchActiveIndex]) return

    const match = searchMatches[searchActiveIndex]
    editor.dispatch({
      changes: { from: match.from, to: match.to, insert: replaceQuery }
    })
    
    // Re-run search after edits
    setTimeout(() => {
      performSearch()
    }, 50)
  }

  const handleReplaceAll = () => {
    const editor = editorViewRef.current
    if (!editor || searchMatches.length === 0) return

    const changes = searchMatches.map(match => ({
      from: match.from,
      to: match.to,
      insert: replaceQuery
    })).reverse()

    editor.dispatch({ changes })
    setTimeout(() => {
      performSearch()
    }, 50)
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* Top Navigation Toolbar */}
      <header className="live-editor-toolbar">
        <div className="live-editor-toolbar-left">
          <button 
            className={`le-btn-icon ${onReset ? '' : 'disabled'}`} 
            onClick={onReset} 
            title="Reset and upload another file"
            style={{ marginRight: '6px' }}
          >
            <RefreshIcon size={16} />
          </button>
          
          <button 
            className={`le-btn-icon ${isOutlineCollapsed ? '' : 'active'}`} 
            onClick={() => setIsOutlineCollapsed(!isOutlineCollapsed)}
            title="Toggle Outline Side Panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="live-editor-app-title">
            LaTeX <span>Studio</span>
          </div>

          <button className="le-btn" onClick={compileLatex} title="Compile Document (Ctrl+Enter)">
            {compileStatus === 'Compiling' && (
              <span style={{ 
                width: '12px', 
                height: '12px', 
                border: '2px solid #fff', 
                borderTop: '2px solid transparent', 
                borderRadius: '50%', 
                animation: 'spin-slow 1s linear infinite', 
                marginRight: '4px' 
              }}></span>
            )}
            {compileStatus === 'Compiling' ? 'Compiling' : 'Compile'}
          </button>

          <div className="le-toggle-container">
            <label className="le-switch">
              <input type="checkbox" checked={autoCompile} onChange={() => setAutoCompile(!autoCompile)} />
              <span className="le-slider"></span>
            </label>
            <span>{autoCompile ? 'Auto: ON' : 'Auto: OFF'}</span>
          </div>
        </div>
        
        <div className="live-editor-toolbar-middle">
          <button className="le-btn-icon" onClick={() => setZoom(prev => Math.max(60, prev - 15))} title="Zoom Out">-</button>
          <select className="le-zoom-select" value={zoom} onChange={(e) => setZoom(parseInt(e.target.value))}>
            <option value="60">60%</option>
            <option value="75">75%</option>
            <option value="100">100%</option>
            <option value="125">125%</option>
            <option value="150">150%</option>
            <option value="200">200%</option>
          </select>
          <button className="le-btn-icon" onClick={() => setZoom(prev => Math.min(200, prev + 15))} title="Zoom In">+</button>
        </div>

        <div className="live-editor-toolbar-right">
          <button className="le-btn le-btn-save" onClick={handleExplicitSave} title="Save document (Ctrl+S)" disabled={!jobId}>
            {saveStatus === 'saving' ? (
              <><span className="btn-spinner"></span> Saving...</>
            ) : saveStatus === 'saved' ? (
              <><CheckIcon size={14} /> Saved</>
            ) : (
              <><DownloadIcon size={14} /> Save</>
            )}
          </button>
          <button 
            className="le-btn le-btn-pdf" 
            onClick={handleDownloadPdf} 
            title="Compile & download PDF" 
            disabled={isDownloadingPdf || !jobId}
          >
            {isDownloadingPdf ? (
              <><span className="btn-spinner"></span> Compiling...</>
            ) : (
              <><PdfIcon size={14} /> Download PDF</>
            )}
          </button>
          <button 
            className="le-btn le-btn-docx" 
            onClick={handleDownloadDocx} 
            title="Convert & download Word (.docx)" 
            disabled={isDownloadingDocx || !jobId}
          >
            {isDownloadingDocx ? (
              <><span className="btn-spinner"></span> Converting...</>
            ) : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Download DOCX</>
            )}
          </button>
          <div className="le-toolbar-separator"></div>
          <button className="le-btn le-btn-secondary" onClick={handleFormat} title="Format LaTeX Code">
            Format Code
          </button>

          <button className="le-btn le-btn-secondary" onClick={handleExportTex} title="Download LaTeX source">
            <DownloadIcon size={14} /> Export .tex
          </button>
        </div>
      </header>

      {/* Main Workspace Split Pane */}
      <main className="editor-main-container">
        
        {/* Outline Sidebar */}
        <div className={`outline-panel ${isOutlineCollapsed ? 'collapsed' : ''}`}>
          <div className="outline-header">Document Sections</div>
          <div className="outline-content">
            {outline.length === 0 ? (
              <div className="outline-item" style={{ color: 'var(--text-muted)', cursor: 'default' }}>No sections defined</div>
            ) : (
              outline.map((item, idx) => {
                const depth = item.type === 'section' ? 1 : item.type === 'subsection' ? 2 : 3
                const isActive = activeOutlineLine >= item.line && (idx === outline.length - 1 || outline[idx + 1].line > activeOutlineLine)
                
                return (
                  <div 
                    key={idx}
                    className={`outline-item sec-${depth} ${isActive ? 'active' : ''}`}
                    onClick={() => highlightLine(item.line)}
                  >
                    {item.number} {item.title}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Code Editor Pane (Left Side) */}
        <div ref={leftPaneRef} className="editor-pane" style={{ width: '50%' }}>
          
          {/* Find & Replace Panel */}
          <div className={`search-replace-panel ${isSearchOpen ? '' : 'collapsed'}`}>
            <div className="search-row">
              <input 
                type="text" 
                className="search-input" 
                placeholder="Search..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && performSearch()}
              />
              <button className="le-btn-icon" style={{ padding: '4px 8px' }} onClick={() => navigateSearch(-1)} title="Previous match">&lt;</button>
              <button className="le-btn-icon" style={{ padding: '4px 8px' }} onClick={() => navigateSearch(1)} title="Next match">&gt;</button>
              <span className="search-count">
                {searchMatches.length > 0 ? `${searchActiveIndex + 1} of ${searchMatches.length}` : '0 of 0'}
              </span>
              <label className="search-option-label">
                <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Case
              </label>
              <label className="search-option-label">
                <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} /> Regex
              </label>
              <button className="le-btn-icon" style={{ padding: '4px 8px', border: 'none' }} onClick={() => { setIsSearchOpen(false); setSearchMatches([]); }} title="Close find panel">&times;</button>
            </div>
            <div className="replace-row">
              <input 
                type="text" 
                className="search-input" 
                placeholder="Replace with..." 
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
              />
              <button className="le-btn le-btn-secondary" style={{ padding: '4px 10px' }} onClick={handleReplace}>Replace</button>
              <button className="le-btn le-btn-secondary" style={{ padding: '4px 10px' }} onClick={handleReplaceAll}>Replace All</button>
            </div>
          </div>

          {/* CodeMirror DOM Parent */}
          <div ref={editorContainerRef} className="editor-container"></div>
          
          {/* Diagnostic sliding console panel */}
          <div className={`error-console ${isConsoleCollapsed ? 'collapsed' : ''}`}>
            <div className="error-console-header">
              <span>Compiler Diagnostics ({errors.length})</span>
              <button className="close-console-btn" onClick={() => setIsConsoleCollapsed(true)}>&times;</button>
            </div>
            <div className="error-console-list">
              {errors.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No compilation issues found.</div>
              ) : (
                errors.map((err, idx) => (
                  <div 
                    key={idx} 
                    className={`error-item severity-${err.severity}`}
                    onClick={() => highlightLine(err.line)}
                  >
                    <span className="error-line-badge">Line {err.line}</span>
                    <span>{err.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Vertical draggable divider */}
        <div ref={dividerRef} className="pane-divider"></div>



        {/* Live Preview Pane (Right Side) */}
        <div ref={pdfViewerPaneRef} className="preview-pane">
          
          <div ref={pdfZoomWrapperRef} className="pdf-zoom-wrapper" style={{ paddingTop: '20px', paddingBottom: '40px' }}>
            <div className="doc-canvas" style={{ padding: 0, backgroundColor: 'transparent', boxShadow: 'none' }}>
              {compiledPageCount > 0 ? (
                Array.from({ length: compiledPageCount }).map((_, i) => (
                  <img
                    key={i}
                    src={`/api/export/preview-compiled/${jobId}/${i}?t=${compileTimestamp}`}
                    alt={`Page ${i + 1}`}
                    style={{ 
                      width: '100%', 
                      display: 'block', 
                      marginBottom: '24px', 
                      boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                      borderRadius: '4px',
                      backgroundColor: '#ffffff' 
                    }}
                  />
                ))
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-muted)' }}>
                  {isBackendCompiling ? (
                    <><span className="btn-spinner" style={{ borderTopColor: 'var(--accent-light)', width: '32px', height: '32px', marginBottom: '1rem', borderWidth: '3px' }}></span> Compiling pixel-perfect PDF...</>
                  ) : compileStatus === 'Error' ? (
                    <><FailedIcon size={48} style={{ color: 'var(--error)' }} /> <div style={{ marginTop: '1rem', color: 'var(--error)' }}>Compilation failed. Please check diagnostics below.</div></>
                  ) : (
                    <><PdfIcon size={48} /> <div style={{ marginTop: '1rem' }}>Generating preview...</div></>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {isBackendCompiling && compiledPageCount > 0 && (
             <div style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 16px', borderRadius: '20px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 100 }}>
                <span className="btn-spinner" style={{ width: '14px', height: '14px' }}></span> Compiling...
             </div>
          )}
        </div>

      </main>

      {/* Download error toast */}
      {downloadError && (
        <div style={{
          position: 'fixed',
          bottom: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '0.75rem 1.5rem',
          background: 'rgba(225, 112, 85, 0.95)',
          color: '#fff',
          borderRadius: '8px',
          fontSize: '0.85rem',
          fontWeight: 500,
          zIndex: 1000,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          animation: 'slideUp 0.3s ease-out',
          cursor: 'pointer',
        }} onClick={() => setDownloadError('')}>
          ⚠ {downloadError}
        </div>
      )}

      {/* Bottom Status Bar */}
      <footer className="status-bar">
        <div className="status-left">
          <div className="status-item">
            <span className={compileStatus === 'Error' ? 'status-badge-error' : 'status-badge-success'}>
              {compileStatus === 'Compiling' ? 'Compiling...' : compileStatus === 'Error' ? 'Compile Error' : 'Ready'}
            </span>
            {compileTime && <span style={{ marginLeft: '4px' }}>at {compileTime}</span>}
          </div>
          
          {errors.length > 0 && (
            <div className="status-item">
              <span className="status-badge-error" onClick={() => setIsConsoleCollapsed(!isConsoleCollapsed)}>
                ✖ {errors.length} Diagnostics
              </span>
            </div>
          )}

          <div className="status-item">
            <span style={{ 
              opacity: savedIndicatorVisible ? 1 : 0, 
              transition: 'opacity 0.5s ease', 
              color: 'var(--success)', 
              fontWeight: 500 
            }}>Saved</span>
            {lastSavedAt && (
              <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                Last saved {lastSavedAt}
              </span>
            )}
          </div>
        </div>

        <div className="status-right">
          <div className="status-item" onClick={() => setIsStatsOpen(true)} style={{ cursor: 'pointer' }} title="Show Document Statistics">
            <span>{stats.words} words</span>
          </div>
          <div className="status-item">
            <span>Ln {cursorPos.line}:Col {cursorPos.col}</span>
          </div>
        </div>
      </footer>

      {/* Snippet command palette modal dialog (Ctrl+K) */}
      <div className={`palette-overlay ${isPaletteOpen ? 'active' : ''}`} onClick={(e) => e.target.classList.contains('palette-overlay') && setIsPaletteOpen(false)}>
        <div className="palette-box">
          <input 
            type="text" 
            className="palette-search" 
            placeholder="Search LaTeX snippets..." 
            value={paletteSearch}
            onChange={(e) => { setPaletteSearch(e.target.value); setPaletteSelectedIndex(0); }}
            onKeyDown={handlePaletteKeyDown}
            autoFocus
          />
          <div className="palette-list">
            {filteredSnippets.length === 0 ? (
              <div style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>No matches found</div>
            ) : (
              filteredSnippets.map((item, idx) => (
                <div 
                  key={idx}
                  className={`palette-item ${paletteSelectedIndex === idx ? 'selected' : ''}`}
                  onClick={() => insertSnippet(item)}
                  onMouseEnter={() => setPaletteSelectedIndex(idx)}
                >
                  <span>{item.name}</span>
                  <span className="item-meta">{item.desc}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Statistics Modal dialog */}
      <div className={`palette-overlay ${isStatsOpen ? 'active' : ''}`} onClick={(e) => e.target.classList.contains('palette-overlay') && setIsStatsOpen(false)}>
        <div className="palette-box" style={{ padding: '24px', color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <h3 style={{ fontWeight: 700, margin: 0 }}>Document Statistics</h3>
            <button onClick={() => setIsStatsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem', padding: 0 }}>&times;</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', fontSize: '0.95rem' }}>
            <div>Words: <strong style={{ color: 'var(--accent)' }}>{stats.words}</strong></div>
            <div>Characters: <strong style={{ color: 'var(--accent)' }}>{stats.chars}</strong></div>
            <div>Lines: <strong style={{ color: 'var(--accent)' }}>{stats.lines}</strong></div>
            <div>Sections: <strong style={{ color: 'var(--accent)' }}>{stats.sections}</strong></div>
            <div>Equations: <strong style={{ color: 'var(--accent)' }}>{stats.equations}</strong></div>
            <div>Tables: <strong style={{ color: 'var(--accent)' }}>{stats.tables}</strong></div>
            <div>Figures: <strong style={{ color: 'var(--accent)' }}>{stats.figures}</strong></div>
          </div>
        </div>
      </div>

      {/* Gutter hover tooltip */}
      <div ref={tooltipRef} className="pdf-hover-tooltip">Line 1</div>

    </div>
  )
}
