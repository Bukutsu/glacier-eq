I can see the image. Here is the detailed description:

## Image description

**Layout**: Desktop EQ band editor, 8 band rows visible, full viewport width (~1280px). No right-side tools panel visible. Each row has columns: BAND# | TYPE (PK/HS/LS/HP/LP buttons) | FREQ slider+stepper | GAIN slider+stepper | Q slider+stepper | (remove × — not visible).

**Red highlight location**: A red rectangle at the far-right edge of the viewport, spanning roughly the last ~75px of every band row (x ≈ 1190–1264, full height of the 8 rows). It outlines the rightmost cells of every row.

**What is cut off**:

1. **Q stepper input** — Every row's Q stepper shows only the leading digit and decimal point, e.g. `0.`, `1.`, `0.`, `3.`, `0.`, `2.`, `2.`, `1.`. The full values should be `0.53`, `1.41`, `0.66`, `3.22`, `0.93`, `2.76`, `2.01`, `1.30` (matching the pattern in the parent's commit). The rest of the stepper (remaining digits + `−` and `+` buttons) is clipped at the right edge.

2. **Remove × button** — The 6th column (the remove/trash icon) is completely missing from every row. Not clipped, not cut — entirely outside the visible area.

3. **A thin vertical scrollbar** is visible at the very right edge of the viewport, indicating the content horizontally overflows the container (so `overflow:hidden` on `.bands-card` may not be the clipper — the viewport itself is the clipper, and the band rows are wider than the workspace allows).

**Why it overflows**: My new 6-column grid `32px 168px minmax(140px,1fr) minmax(150px,1fr) minmax(130px,1fr) 32px` with 5×14px gaps has a total minimum width of **722px** (32+168+140+150+130+32 + 70 gaps). The TYPE column is 168px (much wider than the 5 type buttons need — they only need ~120px), and the three 1fr columns have 130–150px minimums. In a 1280px viewport with workspace + left-pane + card padding eating into the available width, the sum of minimums likely exceeds the container. The Q stepper (fixed 90px) sits in the last 1fr column, and the remove button (32px) is the last cell — both get pushed past the viewport edge.

**Adjacent columns that fit fine**: FREQ steppers show full values (`28`, `107`, `192`, `391`, `770`, `3000`, `3291`, `4570`) with `−`/`+` buttons visible. GAIN steppers similarly complete (`6.33`, `0.87`, `4.28`, `0.29`, `3.48`, `0.24`, `2.29`, `4.52`). The cutoff starts at the Q stepper.

**Type column visual note**: The 5 type buttons (PK/HS/LS/HP/LP) are spread very wide with large gaps between them because the 168px column forces them apart. They would look fine in ~120–130px.

---

## Suggested fix (for the parent)

The grid needs to shrink. Two changes in `src/styles/editor.css`:

1. **Reduce TYPE column** from 168px → ~120px (type buttons still fit comfortably, and we recover 48px).
2. **Drop the hard minimums on the 1fr columns** — use `minmax(0, 1fr)` instead of `minmax(140px, 1fr)` etc. Add `min-width: 0` to the cell internals (`.freq-cell`, `.gain-cell`, `.q-cell`, `.type-buttons`, stepper inputs) so the grid items can actually compress.

New grid:
```css
grid-template-columns: minmax(0, 28px) minmax(0, 120px) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 28px);
gap: 12px;
```

Also remove or relax `overflow: hidden` on `.bands-card` to a safer `min-width: 0` so the grid can negotiate width with its parent.

---