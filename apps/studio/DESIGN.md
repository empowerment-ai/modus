---
name: Modus Studio
description: An open-source process manager where the map you draw is what runs, what's simulated and what's monitored.
colors:
  brand-indigo: "#4f46e5"
  brand-indigo-deep: "#4338ca"
  brand-indigo-soft: "#6366f1"
  brand-indigo-mist: "#eef2ff"
  brand-indigo-veil: "#e0e7ff"
  brand-indigo-line: "#c7d2fe"
  canvas: "#f6f7fb"
  surface: "#ffffff"
  ink: "#0f172a"
  ink-deepest: "#020617"
  slate-body: "#475569"
  slate-muted: "#64748b"
  slate-faint: "#94a3b8"
  dot-grid: "#cbd5e1"
  hairline: "#e2e8f0"
  control-stroke: "#cbd5e1"
  wash: "#f1f5f9"
  bottleneck-rose: "#e11d48"
  queue-amber: "#f59e0b"
  done-emerald: "#059669"
  app-tint-fleet: "#0891b2"
  app-tint-security: "#0d9488"
typography:
  display:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "68px"
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: "-0.035em"
    fontFeature: "'cv11', 'ss01'"
  headline:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body-lead:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  body-dense:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.33
  label:
    fontFamily: "Inter Variable, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "'tnum'"
rounded:
  xs: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  control-sm: "28px"
  control-md: "32px"
  control-lg: "44px"
  gutter: "24px"
  dot-grid: "20px"
  section: "112px"
components:
  button-primary:
    backgroundColor: "{colors.brand-indigo}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "{spacing.control-md}"
  button-primary-hover:
    backgroundColor: "{colors.brand-indigo-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#334155"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "{spacing.control-md}"
  button-ghost:
    textColor: "{colors.slate-body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "{spacing.control-md}"
  button-primary-landing:
    backgroundColor: "{colors.brand-indigo}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "0 20px"
    height: "{spacing.control-lg}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "{spacing.control-md}"
  badge:
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  step-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    width: "228px"
  count-badge:
    backgroundColor: "{colors.brand-indigo}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
    height: "28px"
  nav-rail-item-active:
    backgroundColor: "{colors.brand-indigo-mist}"
    textColor: "{colors.brand-indigo-deep}"
    rounded: "{rounded.lg}"
    width: "64px"
---

# Design System: Modus Studio

## Overview

**Creative North Star: "The Working Floor"**

Modus looks like the inside of an organization at work, seen from above: a cool dot-grid canvas, white step cards laid on it, live counts ticking in round badges, and one rose tag where the work is piling up. Everything is slate and white so that the few colored things (indigo actions, heat on a count, a bottleneck, an app's own color) carry meaning. The material is the product's own: the Studio's process map is the house pattern, and every other surface borrows from it rather than inventing decoration.

The system has two registers on one set of tokens. **Operate** (Studio and Workspace) is dense and quiet: 28 to 32px controls, 11 to 14px type, hairline borders, flat surfaces, information first. **Persuade** (the landing page in front of the app) is the same world at a larger scale: 44px actions, a 68px display line, 16px-radius showcase cards, and sections paced at 112px, but still dot grid, white cards, slate type and indigo. The landing page proves the product by showing it (a live invoice map, sample organizations as doors) rather than describing it.

Depth is restrained: hairline borders and a near-invisible shadow at rest, a deeper lift only for things that float over the work (menus, modals, the hero map).

**Key Characteristics:**
- Cool canvas (dot grid) under white cards with slate hairlines.
- Indigo is the one action color; status hues (rose, amber, emerald) only signal state.
- Each sample application owns a tint, used for its icon tile, bullet dots and its own door.
- Inter Variable everywhere, tight negative tracking at display sizes, tabular numerals for counts and IDs.
- Motion is functional: tokens travel along edges, counts pop, the bottleneck pulses; all of it stops under reduced motion.

## Colors

A slate-and-white field with one indigo accent and a small, strict set of status hues.

### Primary
- **Working Indigo** (brand-indigo): the primary button, selected states, active count badges, focus outline (via brand-indigo-soft), links and record numbers in brand-700. It is the only color that means "act here".
- **Pressed Indigo** (brand-indigo-deep): hover on primary actions; text on indigo-mist chips and the active nav-rail item.
- **Indigo Mist / Veil / Line** (brand-indigo-mist, -veil, -line): selected rows, active nav, the "Your design" block on the landing page and its dashed connector.

### Secondary
- **App tints** (brand-indigo for Invoice, app-tint-fleet for Fleet, app-tint-security for Security): each sample application carries its own color. It appears as the app's icon tile, its bullet dots, a faint top wash on its sample card, its "Open in the Studio" door, and its dot in the application switcher. App tints never replace indigo for generic actions.

### Tertiary (status)
- **Bottleneck Rose** (bottleneck-rose): the bottleneck tag, reject tokens, overloaded count badges, destructive actions. Rose means "this is where it hurts".
- **Queue Amber** (queue-amber): warm count heat, waiting work, what-if callouts (amber-50 surface, amber-800 text), "in progress" status.
- **Done Emerald** (done-emerald): start nodes, completed results, live/"working now" indicators.

### Neutral
- **Canvas** (canvas): the app and hero background; carries the dot grid (dot-grid, 20px pitch).
- **Surface** (surface): every card, panel, header and modal.
- **Ink / Deepest Ink** (ink, ink-deepest): body text and headings; ink-deepest is also the single dark band on the landing page.
- **Slate body / muted / faint** (slate-body, slate-muted, slate-faint): secondary text, metadata, placeholder and idle edge handles.
- **Hairline** (hairline): card borders and dividers. **Control stroke** (control-stroke): input and secondary-button borders. **Wash** (wash): ghost hover, segmented-control track, zero-count badges.

### Named Rules
**The One Action Color Rule.** Indigo is for actions and selection. Status hues never style a button except rose on a destructive one.

**The Status Means State Rule.** Rose, amber and emerald appear only when the data says so (a bottleneck, heat, a completed result). Never as decoration.

**The App Owns Its Tint Rule.** An application's color follows it everywhere it appears, and only there.

## Typography

**Display Font:** Inter Variable (self-hosted, with Inter and the system sans as fallback)
**Body Font:** Inter Variable
**Label/Mono Font:** the platform monospace (ui-monospace, SF Mono, Menlo) for record numbers, the simulated clock and terminal fragments

**Character:** One neutral, highly legible family with stylistic alternates on (cv11, ss01); hierarchy comes from size, weight 600 and tracking, never from a second face.

### Hierarchy
- **Display** (600, 40 / 56 / 68px by breakpoint, 1.04, -0.035em): the landing page's three-beat headline only, one line per beat.
- **Headline** (600, 30px mobile to 40px, 1.1, -0.02em): landing section heads, balanced wrapping.
- **Title** (600, 24px, -0.015em): role rows and the closing call on the landing page; 15 to 17px semibold titles name cards and samples; 16px semibold titles modals.
- **Body lead** (400, 18px, 1.625): landing intros, capped near 34rem / 42rem.
- **Body** (400, 14px; 15px on the landing page): Operate default text, buttons and inputs.
- **Body dense** (12 to 13px): list rows, step-card text, mode tabs.
- **Label** (500, 11px; 10.5px in the nav rail): badges, field hints, count chips. Panel section titles use 11px semibold uppercase with wide tracking inside Operate panels only.

### Named Rules
**The One Family Rule.** Inter Variable carries every role; monospace is reserved for identifiers, clocks and code.

**The Tabular Count Rule.** Every live number (counts, clocks, record IDs) uses tabular numerals so values don't jitter as they change.

## Layout

Operate is a full-height app shell: a 52px white top bar (logo tile, Studio/Workspace segmented switch, application picker, simulated clock in a dark mono pill), a 76px icon-over-label nav rail in the Studio, and a canvas or content pane filling the rest. Density is high: 28px small and 32px default controls, 6 to 10px gaps.

The landing page sits in a centered container (max 72rem, 16 / 24 / 32px side padding) under a sticky 64px translucent white header. Sections alternate surfaces (canvas hero with dot grid fading out, white samples, canvas roles, white model, one ink-deepest band, white footer) and pace at 80px, then 112px from the small breakpoint. Content grids are asymmetric two-column splits (0.8/1.2, 1.05/1, 0.9/1.1) and a three-up of sample cards; everything stacks to one column below the large breakpoint.

Spacing follows Tailwind's 4px step; the dot grid is 20px on canvases and 16px inside the hero map frame.

## Elevation & Depth

Hybrid and mostly flat. Surfaces at rest are separated by hairline borders plus the faintest shadow (shadow-xs or shadow-sm). Real lift is reserved for things floating over the work: dropdowns (shadow-xl), modals (shadow-2xl over a 40% slate scrim with a 1px blur), and on the landing page the hero map frame and the primary action's indigo glow. A selected step card gets an indigo border and a 2px indigo-200 ring rather than more shadow.

### Shadow Vocabulary
- **Hairline lift** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): inputs, secondary buttons, Operate cards.
- **Resting card** (`box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)`): step cards, primary buttons, count badges, active segment.
- **Map controls** (`box-shadow: 0 1px 2px rgb(15 23 42 / 0.08)`): React Flow controls and minimap.
- **Indigo glow** (`box-shadow: 0 6px 16px -6px rgb(79 70 229 / 0.6)`): the landing page's large primary action only.
- **Showcase** (`box-shadow: 0 24px 60px -24px rgb(30 27 75 / 0.35)`): the framed live map in the landing hero.

### Named Rules
**The Float Only Over Work Rule.** Large shadows belong to things that sit above the canvas (menus, modals, the showcase map). Cards on the floor stay nearly flat.

## Shapes

Softly rounded rectangles throughout, radius growing with the object: 4px on badges, 6px on Operate controls, 8px on cards, landing buttons and logo tiles, 12px on step cards, modals and landing fragments, 16px on landing showcase cards; pills for count badges, the bottleneck tag, toggles and status dots. Borders are 1px slate hairlines; the model diagram on the landing page uses a 2px dashed indigo-line connector. Subflow step cards show a tinted card offset 5px behind them, a stack of pages, not a drop shadow.

## Components

### Buttons
Compact and quiet in Operate, larger and warmer on the landing page.
- **Shape:** gently rounded (6px in Operate, 8px on the landing page).
- **Primary:** indigo fill, white 500-weight text, 32px tall with 12px padding (28px / 8px small). Landing primary: 44px, 20px padding, 15px semibold, indigo glow, a trailing arrow that nudges 2px right on hover.
- **Hover / Focus:** fill deepens to pressed indigo; global focus is a 2px indigo-soft outline at 1px offset.
- **Secondary:** white with control-stroke border, slate-700 text, border darkens on hover. **Ghost:** text only, wash on hover. **Subtle:** wash fill. **Danger:** white with rose text and border.
- **App door:** on sample cards, the app tint fills the "Open in the Studio" button (brightens 10% on hover); the companion "Work as [person]" button is a bordered two-line door.

### Chips
- **Badge:** 11px medium text, 4px radius, a 50-tint surface with 700 text per tone (slate, brand, green, amber, red, sky, violet).
- **Bottleneck tag:** rose-600 pill, white 10px uppercase semibold with an alert glyph, hung over the card's top edge and pulsing.

### Cards / Containers
- **Corner Style:** 8px (Operate), 12px (step cards, fragments), 16px (landing sample cards).
- **Background:** surface on canvas.
- **Shadow Strategy:** hairline lift or resting card (see Elevation).
- **Border:** 1px hairline.
- **Internal Padding:** 10 to 20px; landing cards 20px.

### Inputs / Fields
- **Style:** 32px, white, control-stroke border, 6px radius, 10px horizontal padding, hairline lift.
- **Focus:** border turns indigo-soft with a 2px 20% indigo ring.
- **Error / Disabled:** disabled goes to slate-50 with slate-500 text; required marked with a rose asterisk. Labels sit above in 12px medium slate-600.

### Navigation
- **App top bar:** 52px white with hairline bottom; Studio/Workspace segmented switch on a wash track, active segment white with resting shadow.
- **Nav rail:** 64px icon-over-label buttons, 10.5px labels; active is indigo-mist with pressed-indigo text and a heavier icon stroke.
- **Landing header:** sticky, 90% white with backdrop blur, 14px medium slate links, a bordered "Open the Studio" button.

### Step Card (signature)
The process map's unit and the system's emblem. White, 12px radius, hairline border, resting shadow, 228 to 258px wide; a 32px tinted icon tile by step kind (indigo human, violet automated, sky, teal subflow, orange timer, emerald start); a 28px round count badge whose fill is its heat (wash when empty, indigo, amber, rose) and that pops when the value changes; a footer line of live figures. Work travels between cards as 10px indigo tokens with a soft halo (rose when rejected). The landing hero redraws this map in SVG at the same scale, on a 16px dot grid, with a floating what-if callout.

### Simulated Clock
A slate-900 pill with light monospace tabular text in the top bar: the only dark element in Operate, marking time as the product's own instrument.

## Do's and Don'ts

### Do:
- **Do** put new surfaces on canvas with white hairline cards; reach for the dot grid where the surface shows a process or a live system.
- **Do** keep indigo for actions and selection, and let an app's tint follow that app.
- **Do** use the step card, count badge and bottleneck tag as the vocabulary for showing the product, including on persuasion surfaces.
- **Do** use tabular numerals for every live number and monospace for record IDs and clocks.
- **Do** wrap every animation in the reduced-motion guard already in the stylesheet, and keep the 2px indigo focus outline visible.
- **Do** keep Operate controls at 28 / 32px and persuasion actions at 44px.

### Don't:
- **Don't** use rose, amber or emerald decoratively; they are state.
- **Don't** add a second typeface or a system display face; Inter Variable is self-hosted so every machine renders the same.
- **Don't** add large shadows to cards resting on the canvas; lift is for menus, modals and the showcase map.
- **Don't** introduce dark surfaces beyond the simulated clock in Operate, terminal and code fragments, and the one open-source band on the landing page.
- **Don't** put uppercase tracked labels above landing-page headings; uppercase micro-labels belong to dense Operate panels only.
