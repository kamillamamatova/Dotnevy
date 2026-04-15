/**
 * Terminal output helpers.
 *
 * All output goes through these functions so the style is consistent and
 * colors are automatically disabled when stdout is not a TTY (pipes, CI).
 * No external color dependency — ANSI escape codes inline.
 */

const isTTY = process.stdout.isTTY

// ─── ANSI codes ───────────────────────────────────────────────────────────────

const A = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
}

function c(code: string, text: string): string {
  return isTTY ? `${code}${text}${A.reset}` : text
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export const fmt = {
  bold:   (s: string) => c(A.bold,   s),
  dim:    (s: string) => c(A.dim,    s),
  green:  (s: string) => c(A.green,  s),
  red:    (s: string) => c(A.red,    s),
  yellow: (s: string) => c(A.yellow, s),
  blue:   (s: string) => c(A.blue,   s),
  cyan:   (s: string) => c(A.cyan,   s),
  gray:   (s: string) => c(A.gray,   s),
}

// ─── Log functions ────────────────────────────────────────────────────────────

export function success(msg: string): void {
  console.log(`${fmt.green('✓')} ${msg}`)
}

export function info(msg: string): void {
  console.log(`${fmt.blue('ℹ')} ${msg}`)
}

export function warn(msg: string): void {
  console.log(`${fmt.yellow('⚠')} ${msg}`)
}

export function error(msg: string): void {
  console.error(`${fmt.red('✗')} ${msg}`)
}

export function hint(msg: string): void {
  console.log(fmt.dim(`  ${msg}`))
}

export function blank(): void {
  console.log()
}

export function header(title: string, sub?: string): void {
  blank()
  console.log(fmt.bold(title))
  const width = Math.max(title.length, sub?.length ?? 0)
  console.log(fmt.dim('─'.repeat(width)))
  if (sub) console.log(fmt.dim(sub))
}

// ─── Table ────────────────────────────────────────────────────────────────────

export interface Column {
  key: string
  label?: string
  align?: 'left' | 'right'
}

export function table(
  rows: Array<Record<string, string>>,
  columns: Column[],
): void {
  if (rows.length === 0) {
    hint('No results.')
    return
  }

  const widths = columns.map((col) =>
    Math.max(
      (col.label ?? col.key).length,
      ...rows.map((r) => (r[col.key] ?? '').length),
    ),
  )

  const renderRow = (values: string[], bold: boolean) => {
    const line = columns
      .map((col, i) => {
        const val = values[i] ?? ''
        const w = widths[i]
        return col.align === 'right' ? val.padStart(w) : val.padEnd(w)
      })
      .join('  ')
    return bold ? fmt.bold(line) : line
  }

  console.log(renderRow(columns.map((c) => (c.label ?? c.key).toUpperCase()), true))
  console.log(fmt.dim('─'.repeat(widths.reduce((a, w) => a + w, 0) + (columns.length - 1) * 2)))
  for (const row of rows) {
    console.log(renderRow(columns.map((c) => row[c.key] ?? ''), false))
  }
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export interface Spinner {
  update(msg: string): void
  stop(finalLine?: string): void
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function spinner(msg: string): Spinner {
  if (!isTTY) {
    process.stdout.write(`${msg}...\n`)
    return {
      update: () => {},
      stop: (final) => { if (final) console.log(final) },
    }
  }

  let current = msg
  let frame = 0
  const interval = setInterval(() => {
    process.stdout.write(`\r${fmt.cyan(FRAMES[frame % FRAMES.length])} ${current}`)
    frame++
  }, 80)

  return {
    update(newMsg: string) { current = newMsg },
    stop(finalLine?: string) {
      clearInterval(interval)
      process.stdout.write('\r\x1b[K')
      if (finalLine) console.log(finalLine)
    },
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

import { createInterface } from 'readline'

export function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const display = defaultValue
    ? `${question} ${fmt.dim(`[${defaultValue}]`)} `
    : `${question} `
  return new Promise((resolve) => {
    rl.question(display, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

export function promptList(
  question: string,
  items: string[],
  defaultIndex = 0,
): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  items.forEach((item, i) => {
    console.log(`  ${fmt.dim(`[${i + 1}]`)} ${item}`)
  })
  blank()
  const display = `${question} ${fmt.dim(`[${defaultIndex + 1}]`)} `
  return new Promise((resolve) => {
    rl.question(display, (answer) => {
      rl.close()
      const n = parseInt(answer.trim(), 10)
      if (!isNaN(n) && n >= 1 && n <= items.length) {
        resolve(n - 1)
      } else {
        resolve(defaultIndex)
      }
    })
  })
}
