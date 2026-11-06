import type { ReactNode } from 'react'

// Ícones desenhados num grid 24, traço 2
type P = { size?: number }
const svg = (size: number, body: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body}
  </svg>
)
export const PlayIcon = ({ size = 24 }: P) => svg(size, <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />)
export const StopIcon = ({ size = 24 }: P) => svg(size, <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" />)
export const RecIcon = ({ size = 24 }: P) => svg(size, <circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none" />)
export const MetronomeIcon = ({ size = 24 }: P) => svg(size, <><path d="M9 3h6l4 18H5z" /><path d="M12 15l5-8" /></>)
export const TrashIcon = ({ size = 24 }: P) => svg(size, <><path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13" /></>)
export const MuteIcon = ({ size = 24 }: P) => svg(size, <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l4 6M21 9l-4 6" /></>)
export const LockIcon = ({ size = 24 }: P) => svg(size, <><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>)
export const MicIcon = ({ size = 24 }: P) => svg(size, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>)
export const UndoIcon = ({ size = 24 }: P) => svg(size, <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>)
export const DiceIcon = ({ size = 24 }: P) => svg(size, <><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="15" cy="9" r="1.2" fill="currentColor" /><circle cx="9" cy="15" r="1.2" fill="currentColor" /></>)
export const PencilIcon = ({ size = 24 }: P) => svg(size, <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>)
