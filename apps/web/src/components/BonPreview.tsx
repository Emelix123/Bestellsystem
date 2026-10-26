import { layoutBon, type BonDoc, type Codepage } from '@bestellsystem/shared';
import { cn } from '../lib/format';

/** Zeigt einen Bon so, wie er auf dem Drucker aussieht (Druck-Simulator). */
export function BonPreview({ doc, widthChars, codepage }: { doc: BonDoc; widthChars: number; codepage: Codepage }) {
  const lines = layoutBon(doc, { widthChars, codepage });
  return (
    <div
      className="bon-paper inline-block rounded-sm bg-white px-3 py-4 text-slate-900 shadow-md ring-1 ring-slate-200"
      style={{ width: `calc(${widthChars}ch + 1.5rem)`, fontSize: 12, lineHeight: 1.25 }}
    >
      {lines.map((line, i) => (
        <div key={i} className={cn('whitespace-pre', line.bold && 'font-bold')} style={{ fontSize: `${line.size}em`, lineHeight: 1.15 }}>
          {' '.repeat(line.indent)}
          <span className={cn(line.invert && 'bg-slate-900 text-white')}>{line.text || ' '}</span>
        </div>
      ))}
      <div className="mt-3 border-t-2 border-dashed border-slate-300" />
    </div>
  );
}
