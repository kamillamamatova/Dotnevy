import { CopyButton } from './copy-button'

interface Props {
  command: string
  /** Optional label above the command block */
  label?: string
  /** Subdued variant — less visual weight, used inline */
  compact?: boolean
}

/**
 * Renders a CLI command in a dark terminal-style block with a copy button.
 *
 * Standard:  full dark block, used in setup flows
 * Compact:   lighter inline variant, used in environment detail headers
 */
export function CliCommand({ command, label, compact = false }: Props) {
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {label && <span className="text-xs text-gray-500">{label}</span>}
        <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5">
          <span className="font-mono text-xs text-gray-700">{command}</span>
          <CopyButton text={command} />
        </div>
      </div>
    )
  }

  return (
    <div>
      {label && (
        <p className="mb-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      )}
      <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-950 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="select-none text-gray-500 font-mono text-sm">$</span>
          <span className="font-mono text-sm text-gray-100 break-all">{command}</span>
        </div>
        <CopyButton
          text={command}
          className="shrink-0 bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        />
      </div>
    </div>
  )
}
