## verdict

1. Modal layering — resolved. Both inspect-desktop.png and inspect-390px.png visibly show the preview dialog and its close control above the dimmed console. Source places .design-preview-dialog at z-index:50 above the overlay at 40. The captures are valid for their stated viewport and scroll positions.
2. Keyboard inspection — resolved. Source gives the expanded HTML iframe tabIndex=0 while keeping inline thumbnails out of the tab sequence. Both recaptures visibly show focus on the child prototype button; the 390px view shows the long preview scrolled to its bottom. The supplied real keyboard verification records Tab into the preview, Shift+Tab back to Close preview, Escape closure and focus restoration to Inspect preview. No response was submitted; the fixture remains design-input.

No regressions attributable to these two fixes are visible in the supplied recaptures. This verdict scores only the two named material fixes; it does not establish live Fable creative quality or image generation.

## remaining

Clear for the two scored fixes.

disposition: ship
