// Fader de volume com leitura em dB (input range nativo, estilizado no CSS)
const toDb = (v: number) => (v <= 0.001 ? '−∞' : `${(20 * Math.log10(v)).toFixed(1).replace('-', '−')}`)

export function Fader({ name, value, onChange }: { name: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="fader">
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={name}
        aria-valuetext={`${toDb(value)} dB`}
      />
      <output className="fader__val">{toDb(value)}</output>
    </label>
  )
}
