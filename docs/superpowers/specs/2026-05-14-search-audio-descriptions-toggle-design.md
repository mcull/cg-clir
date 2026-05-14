# Search — "With Audio Descriptions" Toggle — Design

**Date:** 2026-05-14
**Status:** Ready for implementation
**Branch:** `feat/search-audio-descriptions-toggle`

---

## Goal

Add a single binary filter to the `/collection` (and `/ephemera`) search that narrows results to artworks that have an audio description. The filter is exposed in the existing `FilterBar` as an icon + iOS-style toggle switch + small result-count, and is fully round-trippable via the URL param `audio=1`.

The audio description program is small at launch (~20 of 2,000+ works), so the count is part of the control's visual affordance — it sets expectations before the user toggles.

---

## User flow

1. User loads `/collection`. The audio toggle renders at the right end of the filter-pill row, in the OFF state, with a muted count showing how many works in the current filtered set have audio.
2. User clicks the toggle. URL updates to `?audio=1` (preserving any other filters), server re-runs the query, results re-render filtered to audio-only works.
3. User shares the URL. Recipient lands on the same filtered view; the toggle renders ON.
4. User clicks the toggle again. `audio` param is dropped from the URL, results re-render unfiltered (by audio).
5. User paginates while the filter is on. Pagination links preserve `audio=1`.

---

## URL state

| Param | Type | Values | Canonical emission |
|---|---|---|---|
| `audio` | boolean | absence = false; `1`, `true`, `yes` (case-insensitive) = true; anything else = false | `audio=1` when on; param omitted when off |

**Parsing is liberal; emission is canonical.** This keeps old shared links working if we ever change formats and ensures we never emit `audio=0` / `audio=false` (which would just be noise in the URL).

The param composes with all existing filters (`q`, `theme`, `format`, `medium`, `decade`, `artist`, `sort`, `page`) via standard AND semantics — audio is just another conjunct.

---

## Filter semantics

`(audio_url IS NOT NULL) AND (other filters…)` when `audio=1`. No constraint when off.

`audio_origin` (`'human'` vs `'tts'`) is **not** part of this filter — both count as "has audio descriptions" for v1. A future enhancement could split them.

---

## Visual & interaction

### Layout

The control sits **inline at the right end of the filter-pill row** in `FilterBar`, after the Sort dropdown. On mobile, it wraps naturally with the rest of the filter pills.

```
[ Search artwork & artists  ⌕ ]  [Theme▾] [Format▾] [Artist▾] [Decade▾] [Sort▾]  🎧 ⚪ 23
                                                                                  ^^^^^^^
                                                                            new audio toggle
```

### Anatomy

A single button containing three sub-elements, left to right:

1. **Headphones icon** from `lucide-react` (16-18px, `currentColor`)
2. **Toggle switch** — Tailwind-built iOS-style pill: ~32×18px, `bg-gray-300` when off, `bg-emerald-600` when on, white knob translates ~14px on toggle, ~150ms transition
3. **Count** — small muted text (`text-xs text-gray-500`), e.g. `23`

Whole control is a single `<button role="switch">` for accessibility — clicking anywhere on icon/switch/count toggles. The label "With audio descriptions" lives in `aria-label`; on hover, a native `title` tooltip shows `"With audio descriptions — 23 works"`.

### Count semantics

The count is **the number of works with audio descriptions in the current filtered set, ignoring the audio filter itself.** So:

- On `/collection` with no other filters: shows the total number of audio works in the catalog (~20-23).
- On `/collection?theme=animals`: shows the number of audio works that also match `theme=animals`.
- When the toggle is ON, the count equals the result set size.
- When the toggle is OFF, the count is "how many you'd get if you turned this on, given current filters."

This mirrors the existing facet-count convention used by the multi-select dropdowns (counts assume all *other* filters are applied; the dimension's own filter is excluded from its own counts).

### States

| Condition | Treatment |
|---|---|
| `audio` param off, count > 0 | Toggle visible, off, count muted |
| `audio` param on, count > 0 | Toggle visible, on (green), count in same muted style |
| Count = 0 | Toggle visibly disabled (`opacity-40`, `cursor-not-allowed`), clicking does nothing. Prevents the user from filtering themselves into an empty state from an active filter combination. |
| `audio` param on but combined with other filters yields 0 results | Toggle still shows the count (0). User clears the toggle or other filters to escape. |

### No active-filter chip

Unlike the multi-select filters, the audio toggle does **not** render a chip in the `ActiveFilterChips` row below. The toggle's own visual state (green vs gray) is the canonical "is this filter active" affordance — a duplicate chip would be confusingly redundant.

"Clear all" in `ActiveFilterChips` does **not** clear the audio toggle (it's not a chip; consistent with how `q` and `sort` are also preserved). Users clear the toggle by clicking the toggle itself.

---

## Accessibility

- **Role:** `<button role="switch" aria-checked={value}>`
- **Label:** `aria-label="With audio descriptions"` (the count is *not* part of the label, since it changes constantly and would create chatty announcements; it's announced via `aria-describedby` pointing at the count text)
- **Disabled state:** `aria-disabled="true"` when count is 0
- **Keyboard:** Space and Enter toggle; standard button focus behavior; visible focus ring
- **Color:** off/on distinction is reinforced by the knob position, not color alone (passes WCAG 1.4.1)
- **Touch target:** minimum 32×32px hit area around the visible switch

---

## Components & files

### New

| File | Purpose |
|---|---|
| `src/components/AudioFilterToggle.tsx` | The client component: headphones icon + switch + count. Props: `value: boolean`, `count: number`, `onChange(next: boolean) => void`. Pure presentational + click handling. |

### Modified

| File | Change |
|---|---|
| `src/lib/filter-state.ts` | Add `audio: boolean` to `FilterState`. Parse `audio` param liberally (`1`/`true`/`yes` → true). Emit `audio=1` in `toQueryString` only when true (omit otherwise). |
| `src/lib/collection-query.ts` | When `filters.audio === true`, add `.not("audio_url", "is", null)` to the artwork query. Also compute the audio-works count (number of rows matching all *other* current filters AND `audio_url IS NOT NULL`) and include it in the returned result alongside the existing facet counts. |
| `src/components/FilterBar.tsx` | Render `<AudioFilterToggle>` at the right end of the filter row, after Sort. Wire `value` to `filters.audio`, `count` to `facetCounts.audio`, `onChange` to update state and trigger `router.push` with the new query string. |
| `src/components/Pagination.tsx` | Add `audio` to `preserveParams` so page links keep the filter. |
| `package.json` | Add dependency: `lucide-react@^0.x` (latest stable). |

### Not modified

- `src/components/ActiveFilterChips.tsx` — no change. Audio toggle is not a chip.
- Database schema — no migrations. `artworks.audio_url` already exists.
- `/ephemera` route — gets the toggle for free since it reuses `FilterBar`. Ephemera works generally won't have audio, so the count will be 0 most of the time and the control will render disabled. This is correct behavior; no special-case needed.

---

## Edge cases

| Case | Handling |
|---|---|
| User visits `/collection?audio=1` but zero audio works exist (e.g., empty DB) | Toggle renders ON, count = 0, results empty. Existing empty-state UI shows. User can click the toggle to clear it, or use "Clear filters" in the empty state. |
| User has filters active that exclude all audio works | Toggle renders disabled (count = 0). User clears other filters to enable it again. |
| User passes `audio=0`, `audio=false`, `audio=anything` | Parsed as false. Param is stripped on next URL emission. |
| User passes `audio=` (empty value) | Parsed as false. Stripped. |
| `/ephemera` route with no audio works in ephemera | Toggle renders disabled. Correct. |
| User toggles on, paginates to page 3, then toggles off | Page param resets to 1 (consistent with how every other filter change resets pagination — that behavior already exists in `FilterBar`'s `onChange` flow). |

---

## Testing

### Unit (vitest)

In `src/lib/__tests__/filter-state.test.ts` (or wherever existing tests live):

- `parseSearchParams({ audio: '1' })` → `{ audio: true, ... }`
- `parseSearchParams({ audio: 'true' })` → `{ audio: true, ... }`
- `parseSearchParams({ audio: 'yes' })` → `{ audio: true, ... }`
- `parseSearchParams({ audio: '0' })` → `{ audio: false, ... }`
- `parseSearchParams({})` → `{ audio: false, ... }`
- `toQueryString({ audio: true, ... })` includes `audio=1`
- `toQueryString({ audio: false, ... })` does NOT include `audio` key

In `src/lib/__tests__/collection-query.test.ts` (creating if absent, otherwise extending):

- When `filters.audio === true`, the Supabase query builder calls `.not("audio_url", "is", null)`. Mock the supabase client and assert the call.
- When `filters.audio === false`, the builder does NOT call `.not("audio_url", ...)`.
- Facet count returns `audio` key whose value is the count of audio works given other current filters (not counting the audio filter itself).

### Component (vitest + jsdom or react testing library, whichever the project already uses)

- `AudioFilterToggle` renders the count.
- Clicking fires `onChange(true)` when value is false, `onChange(false)` when true.
- `aria-checked` matches `value`.
- `aria-label` is `"With audio descriptions"`.
- When `count === 0`, the button is `aria-disabled="true"` and click does nothing.

### Manual smoke (in browser, dev server)

1. Visit `/collection`. Verify toggle renders, count is correct, off.
2. Click toggle. URL becomes `?audio=1`. Results filter to audio works.
3. Paginate (if there are enough audio works to paginate). URL preserves `audio=1`.
4. Open artwork detail from filtered results, hit browser back. Toggle state restored.
5. Copy URL with `?audio=1`, open in incognito. Toggle renders ON.
6. Apply a theme filter that excludes all audio works. Toggle becomes disabled with count 0.
7. Apply `theme=animals` + `audio=1`. URL has both params; results match both.
8. On `/ephemera`, verify toggle renders (likely disabled, count 0).

---

## Out of scope (explicit)

- **Distinguishing human-recorded vs TTS audio** in the filter UI. Both count as "has audio descriptions" for v1. A future split would likely be a small additional control (radio: All / Human / TTS).
- **Visible audio affordance on artwork result cards.** Showing a small headphones glyph on cards that have audio is a worthy enhancement, but it's a separate visual decision (overlay vs. badge vs. corner icon) that warrants its own design pass.
- **"Without audio" filter** — no demand and the UI cost (a 3-state control or a separate negation) isn't worth it.
- **Analytics on toggle usage.** PostHog page-view tracking already captures the URL param indirectly; explicit event tracking can be a follow-up.
- **Search query expansion to mention "audio" / "audio description" / "narration" matches** — the toggle is the canonical way to find audio works; FTS expansion is unnecessary.
- **Caching the facet count.** Adding `count(*) WHERE audio_url IS NOT NULL` to each request is cheap at our scale (sub-ms with an appropriate partial index, and probably fine without one given the small audio set). Revisit if the catalog grows 10x.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `lucide-react` adds a dependency for a single icon | Lucide is tree-shakable (per-icon ESM exports), so the bundle adds only the `Headphones` glyph (~1 KB). Acceptable, and sets us up for the next icon need without re-litigating the library choice. |
| With only ~20 audio works, users may toggle on and feel the site is broken ("only 20 results?") | The visible count next to the toggle sets expectations before clicking. Mitigation is part of the design, not an after-the-fact fix. |
| Tailwind-built iOS toggle is fiddly to get pixel-perfect across browsers | Use a tested pattern (Tailwind UI's headless switch idiom or a single-element pill with absolutely-positioned knob). Visual review on Chrome, Safari, Firefox before merging. |
| Facet count query adds one extra trip to Supabase per page render | The query is `count(*) WHERE audio_url IS NOT NULL AND <other filters>`. At ~3k rows, sub-100ms. If we ever notice it on the timeline, we can fold it into the existing facet-count query block as a parallel promise. |
| The toggle visually competes with the existing pill buttons (different control type in the same row) | Intentional — it *is* a different control (binary vs multi-select). The icon + count combination gives it a distinct silhouette that reads as "different kind of filter." Visual review during implementation will confirm. |

---

## Notes for the plan

- The `AudioFilterToggle` component should be self-contained and unit-testable in isolation. Don't reach into `FilterState` from within it — it takes `value`/`count`/`onChange` and that's all.
- When wiring into `FilterBar`, follow the same pattern the existing dropdowns use: update local `FilterState`, call the existing helper that emits the new URL and calls `router.push`. Don't introduce a new state management path.
- For the iOS toggle styling, prefer a single `<span>` for the track and a single `<span>` for the knob (positioned absolutely). Avoid native `<input type="checkbox">` because styling the native control is brittle and we want full control over the visual.
- The headphones icon size should match the existing dropdown chevrons' optical weight — start at 16px and adjust.
