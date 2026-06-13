# Web interactive surfaces

How every clickable thing in this app gets the same hover / press feel on
web, with zero overhead on native.

If you are adding a new `Pressable`, you almost always want to follow this
pattern — both for visual consistency and because the user has come to
expect it everywhere else.

---

## TL;DR

```tsx
import {
  useWebHoverProps,
  webInteractive,
  interactiveWebPressScale,        // -3% scale, for chips / icon buttons
  interactiveWebPressScaleSubtle,  // -2% scale, for big rows / cards
} from "@/utils/interactiveSurface";

const styles = StyleSheet.create((theme) => ({
  myButton: {
    /* ... your base style ... */
    ...webInteractive,
  },
  myButtonHovered: { backgroundColor: theme.colors.surfaceHigh },
  myButtonPressed: { backgroundColor: theme.colors.surfacePressed },
}));

function MyButton() {
  const { isHovered, hoverProps } = useWebHoverProps();
  return (
    <Pressable
      {...hoverProps}
      onPress={...}
      style={({ pressed }) => [
        styles.myButton,
        isHovered && styles.myButtonHovered,
        pressed && styles.myButtonPressed,
        pressed && interactiveWebPressScale, // optional
      ]}
    >
      ...
    </Pressable>
  );
}
```

That's it. On native (`Platform.OS !== "web"`):
- `webInteractive` is `null` and spreads to nothing
- `interactiveWebPressScale*` are `null` and the conditional `&&` short-circuits
- `useWebHoverProps()` returns `{ isHovered: false, hoverProps: {} }` so no
  hover plumbing is wired and no extra renders happen

So you can use these primitives unconditionally — no `Platform.OS` branches
at the call site.

---

## API

All four exports live in `@/utils/interactiveSurface`.

### `webInteractive`

Spread into a `Pressable`'s **base** style. Adds two web-only effects:
- `cursor: "pointer"` — the universal "this is clickable" hint
- `transition: background-color, transform 120ms ease-out` — animates the
  cross-fade between default / hover / pressed and the optional scale

Native: `null`.

### `interactiveWebPressScale` and `interactiveWebPressScaleSubtle`

Layer into a Pressable's `style` array next to the `pressed` flag:

```tsx
pressed && interactiveWebPressScale,        // -3% (chip-grade)
pressed && interactiveWebPressScaleSubtle,  // -2% (row/header-grade)
```

Pick by element size — see "When to scale and how much" below.

Native: both `null`.

### `useWebHoverProps()`

Hook that returns `{ isHovered, hoverProps }`:
- `isHovered`: `boolean`. Always `false` on native; tracks the actual
  pointer state on web.
- `hoverProps`: spread onto a `Pressable`. Empty `{}` on native; carries
  `onHoverIn` / `onHoverOut` on web.

Always called at the top of the component (don't conditionally call it).
It's safe to call even in components that early-return — `React.useState`
runs unconditionally, only the returned shape differs between platforms.

---

## Conventions

### Hover background

Always use `theme.colors.surfaceHigh` for hover, regardless of element
type. The whole app relies on this to keep "I'm pointing at something
clickable" consistent. Exception: if the element's base color is already
`surfaceHigh` (e.g. `GridCard`), step up to `surfaceHighest`.

### Pressed background

Always use `theme.colors.surfacePressed` (or the existing
`surfacePressedOverlay` on translucent surfaces). Don't invent new tones.

### When to scale and how much

Scale fires on press, **on web only**, and only if you opt in.

| Element kind | Use | Why |
|---|---|---|
| Small interactive (chip, pill, icon button) | `interactiveWebPressScale` (0.97) | A noticeable nudge matches its "quick action" role |
| Larger button surface (card, header row, big toggle) | `interactiveWebPressScaleSubtle` (0.98) | -3% on a wide element reads as jittery; -2% feels grounded |
| List row (`SessionItem`, `ProjectCard`, `Item`, `CompactSessionRow`) | **no scale** | A row scaling would push its neighbors visibly; the column would shimmer as the cursor sweeps |

The 120ms transition is on `background-color, transform` — the scale
animates back to 1.0 smoothly when the user releases.

### `selected` always wins over `hover`

If your component has a "selected" state (route match, current item,
etc.), order your style array so hover is conditional on **not** being
selected:

```tsx
style={({ pressed }) => [
  styles.row,
  isHovered && !selected && styles.rowHovered,  // hover only if NOT selected
  selected && styles.rowSelected,
  pressed && styles.rowPressed,
]}
```

Without the `!selected` guard, mousing over a sibling row visually
unhighlights the selected row, and the user loses "I am here" cue.

### `disabled` / `loading` suppress hover

Don't show hover highlight on disabled or loading rows. The hover signal
contradicts the disabled state. Pattern:

```tsx
const showHover = isHovered && !disabled && !loading;
```

See `components/Item.tsx` for the canonical implementation.

### Don't nest Pressables

If you have a clickable header + clickable chips inside it, **do not**
wrap them in an outer Pressable. React-Native-Web maps `onPress` to
`onClick` which bubbles in the DOM — the chip's onPress will fire first
and then immediately get undone by the outer toggle.

Lay them out as sibling Pressables instead. See
`components/machine/SessionsAutomationHeader.tsx` for the working pattern
(title + chevron + chips all sibling Pressables).

---

## Reference implementations

If you're not sure what your component should look like, copy the closest
existing one:

| If your element is a... | Look at |
|---|---|
| Chip / pill / small badge button | `components/machine/SessionsAutomationHeader.tsx` → `SummaryChip` |
| Icon button | `components/machine/SessionsAutomationHeader.tsx` → `HeaderChevronPressable` |
| Section title that toggles | `components/machine/SessionsAutomationHeader.tsx` → `HeaderTitlePressable` |
| Dashboard card | `components/machine/AutomationSummarySection.tsx` → `GridCard` |
| List row | `components/SessionsList.tsx` → `SessionItem` |
| Generic settings row | `components/Item.tsx` |
| Project card | `components/project/ProjectCard.tsx` |

---

## Testing

The pure builder fragments (`buildWebInteractive`, `buildPressScale`) live
in `utils/interactiveSurfaceBuilders.ts` with unit tests in
`utils/interactiveSurfaceBuilders.test.ts`. They cover the per-platform
branches so a change to the constants is caught.

`useWebHoverProps` is **not** unit-tested — testing it requires either a
React renderer (not set up) or mocking `React.useState` (pollutes other
test files' module caches under vitest's worker pool). It's a ~10-line
wrapper and every branch is covered indirectly by the consuming
components' rendered output.

If you add another builder, add the test alongside it in the same
`interactiveSurfaceBuilders` files — keep them free of `react-native`
imports so rolldown doesn't choke on Flow syntax during the vitest run.

---

## FAQ

### Why a custom hook and not just `Pressable`'s built-in hover?

`Pressable` doesn't expose a `hovered` state in its `style` function on
RN-Web — only `pressed`. The hook closes that gap and gives us a single
place to short-circuit on native.

### Why `webInteractive` ships transition for `transform` even on elements without scale?

Cheap — the browser only runs the transition if `transform` actually
changes. Putting it in the shared base style means new elements that
later opt into scale get smooth animation without any extra wiring.

### Why two scales and not just one?

A 3% press scale on a small chip ≈ 1px nudge — perfect. The same 3% on a
wide settings row ≈ 5-6px nudge that the eye reads as "the row jumped",
not "I pressed it". 2% on big surfaces is the sweet spot. The two tokens
make the intent explicit at every call site.

### Can I add a new state (e.g. `focused` for keyboard nav)?

Yes — open `interactiveSurface.ts` and add a `useWebFocusProps()` mirror
of `useWebHoverProps`. Keep the same `{ isFocused, focusProps }` shape.
Update this doc with the new conventions.
