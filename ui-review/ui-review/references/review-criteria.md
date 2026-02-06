# UI Review Criteria

Use this checklist when evaluating screenshots. Score each area and provide specific feedback.

## 1. Layout & Spacing

- Content centered and properly constrained (max-width)
- Consistent padding/margins across breakpoints
- No horizontal scrollbar at any viewport
- Content doesn't overflow containers
- Proper use of whitespace (not too cramped, not too sparse)
- Grid/flex layouts adapt properly to viewport width

## 2. Typography

- Text readable at all sizes (min 14px body on mobile)
- Headings scale appropriately across breakpoints
- Line length comfortable (45-75 characters for body text)
- No text truncation that hides important content
- Proper hierarchy (h1 > h2 > h3 visually distinct)

## 3. Navigation & Interactive Elements

- Touch targets minimum 44x44px on mobile
- Navigation accessible and usable at all sizes
- Hover states don't break on touch devices
- Buttons and links clearly distinguishable
- Forms usable and properly sized at all viewports

## 4. Visual Consistency

- Colors and contrast consistent across viewports
- Images/media scale properly (no stretching, no overflow)
- Icons properly sized and aligned
- Borders, shadows, and decorative elements consistent
- No layout shifts or jumps between breakpoints

## 5. Scroll Behavior

- Page scrolls smoothly (no janky scroll)
- Sticky/fixed elements don't overlap content
- Scroll position makes sense after navigation
- No unnecessary horizontal scroll
- Content below the fold is discoverable
- Infinite scroll or pagination works correctly

## 6. Responsive Breakpoint Transitions

- Layout transitions are smooth between breakpoints
- No "in-between" states where layout breaks
- Sidebar/menu collapse behavior is clean
- Cards/grids reflow logically
- Images and media adapt to container size

## 7. Content Priority

- Most important content visible above the fold
- Mobile prioritizes essential content
- Secondary content properly hidden or collapsed on small screens
- CTAs visible and prominent at all sizes

## Scoring

For each area, assign:
- **Pass**: No issues found
- **Minor**: Cosmetic issues, not blocking
- **Major**: Usability or visual issues that need fixing
- **Critical**: Broken layout or unusable UI

## Report Template

```markdown
## UI Review: [Route] at [Width]x[Height]

### Overall Score: [Pass/Minor/Major/Critical]

### Layout & Spacing: [Score]
[Specific findings]

### Typography: [Score]
[Specific findings]

### Navigation & Interactive: [Score]
[Specific findings]

### Visual Consistency: [Score]
[Specific findings]

### Scroll Behavior: [Score]
[Specific findings]

### Breakpoint Transitions: [Score]
[Specific findings]

### Content Priority: [Score]
[Specific findings]

### Actionable Recommendations
1. [Highest priority fix]
2. [Next priority fix]
3. ...
```
