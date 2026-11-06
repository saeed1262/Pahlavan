// An animated terminal, as an SVG that GitHub plays like a GIF: a recorded
// Claude Code session replayed from a short script (what was typed, the
// tools the coach ran and what it answered).
//
//   node tools/terminal-svg.mjs <cast.json> --out <file.svg> [--transcript <file>] [--frame N]
//
// A cast is { "title", "steps": [...] }. Each step is one of:
//   { "user": "text" }               typed at the prompt (with a short typing effect)
//   { "tool": "Bash(node …)" }       a tool call; "result" (optional) adds its ⎿ line
//   { "say": ["line", ...], "hold": seconds }   the coach's reply, revealed a few lines at a time
//   { "note": "text" }               an editor's note between steps (drawn dim and framed, never as the coach)
// In "say" lines, **bold** and `code` are styled; long lines wrap.
//
// With --transcript, every piece of the coach's text (split at " · " and at
// "…") must appear in the transcript word for word (markdown and spacing aside),
// so the replay shows what the coach said, with only marked cuts.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const COLS = 98;
const ROWS = 24;
const CW = 7.83; // character width at 13 px for the monospace stack
const LH = 19;
const PAD = 22;
const TOP = 44;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A line's styled words: **bold** and `code` runs, split at spaces. */
function words(line) {
  const out = [];
  let bold = false;
  let code = false;
  for (const part of line.split(/(\*\*|`)/)) {
    if (part === '**') bold = !bold;
    else if (part === '`') code = !code;
    else for (const w of part.split(/(\s+)/)) if (w) out.push({ w, bold, code });
  }
  return out;
}

/** Greedy wrap to `width` columns; continuation rows are indented by `indent`. */
function wrap(line, width, indent) {
  const rows = [[]];
  let len = 0;
  for (const t of words(line)) {
    const n = t.w.length;
    if (len + n > width && len > 0 && !/^\s+$/.test(t.w)) {
      rows.push([{ w: ' '.repeat(indent), bold: false, code: false }]);
      len = indent;
    }
    if (len === indent && rows.length > 1 && /^\s+$/.test(t.w)) continue;
    rows.at(-1).push(t);
    len += n;
  }
  return rows;
}

const plain = (s) => s.replace(/\*\*|`/g, '');

/** The cast's coach text, checked against the transcript. */
export function verify(cast, transcript) {
  const norm = (s) => plain(s).replace(/[*[\]]/g, '').replace(/[|#>]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = norm(transcript);
  const missing = [];
  for (const step of cast.steps) {
    // The coach's words only: what was typed at the prompt is the made-up athlete's.
    const lines = step.say ?? [];
    for (const line of lines) {
      for (let seg of plain(line).split(/ · |…/)) {
        seg = seg.replace(/^\s*(?:[-•]|\d+\.)\s+/, '').trim();
        if (seg.length < 3) continue;
        if (!hay.includes(norm(seg))) missing.push(seg);
      }
    }
  }
  return missing;
}

/** The frames: the screen's last ROWS rows after each moment, with how long it stays. */
function frames(cast) {
  const screen = [];
  const out = [];
  const snap = (d) => out.push({ rows: screen.slice(-ROWS).map((r) => ({ ...r, parts: r.parts.slice() })), d });
  const push = (row) => screen.push(row);
  const blank = () => screen.length && screen.at(-1).kind !== 'blank' && push({ kind: 'blank', parts: [] });
  for (const step of cast.steps) {
    if (step.user !== undefined) {
      blank();
      const full = step.user;
      const cuts = full.length > 24 ? [0.25, 0.55, 0.85, 1] : [0.5, 1];
      for (const c of cuts) {
        const text = full.slice(0, Math.max(1, Math.round(full.length * c)));
        const rows = wrap(text, COLS - 4, 2);
        const at = screen.length;
        rows.forEach((r, i) => screen.push({ kind: 'user', first: i === 0, parts: r }));
        snap(c === 1 ? 0.7 : 0.22);
        screen.splice(at);
      }
      wrap(full, COLS - 4, 2).forEach((r, i) => push({ kind: 'user', first: i === 0, parts: r }));
      blank();
    } else if (step.tool !== undefined) {
      if (screen.length && screen.at(-1).kind !== 'tool' && screen.at(-1).kind !== 'result') blank();
      wrap(step.tool, COLS - 4, 4).forEach((r, i) => push({ kind: 'tool', first: i === 0, parts: r }));
      if (step.result) push({ kind: 'result', parts: [{ w: step.result, bold: false, code: false }] });
      snap(0.55);
    } else if (step.note !== undefined) {
      blank();
      push({ kind: 'note', parts: [{ w: step.note, bold: false, code: false }] });
      blank();
      snap(1.4);
    } else if (step.say) {
      blank();
      let first = true;
      let shown = 0;
      for (const line of step.say) {
        if (line === '') {
          push({ kind: 'blank', parts: [] });
          continue;
        }
        const lead = line.match(/^(\s*(?:[-•]|\d+\.)\s+)/)?.[1] ?? '';
        wrap(line, COLS - 4, 2 + lead.length).forEach((r, i) => {
          push({ kind: 'say', first: first && i === 0, parts: r });
          shown++;
          if (shown % 4 === 0) snap(0.32);
        });
        first = false;
      }
      snap(step.hold ?? 3);
    }
  }
  return out;
}

function svg(cast, only = null) {
  const fr = frames(cast);
  const total = fr.reduce((t, f) => t + f.d, 0);
  const W = Math.round(PAD * 2 + CW * COLS);
  const H = TOP + ROWS * LH + PAD;
  let t = 0;
  const css = [];
  const groups = [];
  fr.forEach((f, i) => {
    const a = (t / total) * 100;
    const b = ((t + f.d) / total) * 100;
    t += f.d;
    css.push(`@keyframes k${i}{0%,${a.toFixed(3)}%{visibility:hidden}${a.toFixed(3)}%,${b.toFixed(3)}%{visibility:visible}${b.toFixed(3)}%,100%{visibility:hidden}}.f${i}{animation:k${i} ${total.toFixed(2)}s step-end infinite}`);
    const rows = f.rows.map((r, n) => {
      const y = TOP + n * LH + 14;
      const x0 = PAD;
      if (r.kind === 'blank') return '';
      const head = r.kind === 'user' ? (r.first ? '<tspan class="p">&gt; </tspan>' : '<tspan>  </tspan>')
        : r.kind === 'tool' ? (r.first ? '<tspan class="g">⏺ </tspan>' : '<tspan>  </tspan>')
        : r.kind === 'result' ? '<tspan class="d">  ⎿  </tspan>'
        : r.kind === 'say' ? (r.first ? '<tspan class="w">⏺ </tspan>' : '<tspan>  </tspan>')
        : '';
      const cls = r.kind === 'user' ? 'u' : r.kind === 'tool' ? 'tl' : r.kind === 'result' || r.kind === 'note' ? 'd' : 's';
      const body = r.parts.map((p) => `<tspan${p.bold ? ' class="b"' : p.code ? ' class="c"' : ''}>${esc(p.w)}</tspan>`).join('');
      const bg = r.kind === 'user' ? `<rect x="${PAD - 8}" y="${y - 14}" width="${W - 2 * PAD + 16}" height="${LH}" class="ub"/>` : '';
      const note = r.kind === 'note' ? `<text x="${W / 2}" y="${y}" class="n" text-anchor="middle">${esc(r.parts[0].w)}</text>` : '';
      return r.kind === 'note' ? note : `${bg}<text x="${x0}" y="${y}" class="${cls}" xml:space="preserve">${head}${body}</text>`;
    }).join('');
    // --frame N: that moment alone, drawn without the animation (to look at it).
    if (only === null || only === i) groups.push(`<g class="${only === null ? `f f${i}` : ''}">${rows}</g>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">${esc(cast.title)}</title><desc id="d">${esc(cast.desc ?? cast.title)}</desc>
<style>
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;fill:#d8d8d8}
.f{visibility:hidden}.p{fill:#d97757;font-weight:700}.u{fill:#f0f0f0}.ub{fill:#2a2a2e}.g{fill:#5fb878}.w{fill:#f0f0f0}
.tl{fill:#9aa0a6}.b{font-weight:700;fill:#ffffff}.c{fill:#c9a6ff}.d{fill:#7d828a}.n{fill:#7d828a;font-style:italic}
${css.join('\n')}
</style>
<rect width="${W}" height="${H}" rx="12" fill="#18181b"/>
<circle cx="22" cy="20" r="6" fill="#ff5f57"/><circle cx="42" cy="20" r="6" fill="#febc2e"/><circle cx="62" cy="20" r="6" fill="#28c840"/>
<text x="${W / 2}" y="24" text-anchor="middle" class="d">${esc(cast.window ?? 'Claude Code')}</text>
${groups.join('\n')}
</svg>
`;
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, transcript: { type: 'string' }, frame: { type: 'string' } } });
  const cast = JSON.parse(readFileSync(positionals[0], 'utf8'));
  if (values.transcript) {
    const missing = verify(cast, readFileSync(values.transcript, 'utf8'));
    if (missing.length) {
      console.error(`not in the transcript (${missing.length}):\n  ${missing.join('\n  ')}`);
      process.exit(1);
    }
    console.log('every line is in the transcript');
  }
  const out = svg(cast, values.frame !== undefined ? Number(values.frame) : null);
  writeFileSync(values.out, out);
  const fr = frames(cast);
  console.log(`${values.out}: ${fr.length} frames, ${fr.reduce((t, f) => t + f.d, 0).toFixed(1)} s, ${Math.round(out.length / 1024)} KB`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
