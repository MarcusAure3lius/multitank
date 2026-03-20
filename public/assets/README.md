# Asset Slots

Drop images into the folders below and the client will discover them automatically through `/assets/manifest.json`.

Supported image formats:

- `.png`
- `.webp`
- `.jpg`
- `.jpeg`
- `.svg`

## World

These are optional. If a file is missing, the game falls back to the procedural canvas look.

- `backgrounds/arena-floor.*`
  Used as a repeating floor tile across the whole map.
- `backgrounds/arena-grid.*`
  Used as a repeating grid overlay across the whole map.
- `world/obstacle-block.*`
  Drawn over obstacle rectangles.
- `world/objective-ring.*`
  Drawn over the capture point.

## Tank Sprites

The client looks for hull and turret sprites separately so the turret can still rotate independently.

Folders:

- `sprites/tanks/hulls/`
- `sprites/tanks/turrets/`

Naming order used by the client:

1. `{classId}-{teamId}.*`
2. `{classId}-default.*`
3. `default.*`

Current class IDs:

- `striker`
- `scout`
- `vanguard`

Current team IDs:

- `alpha`
- `bravo`
- `neutral`

Examples:

- `sprites/tanks/hulls/striker-alpha.png`
- `sprites/tanks/turrets/striker-alpha.png`
- `sprites/tanks/hulls/scout-default.webp`
- `sprites/tanks/turrets/default.svg`

You can add just one default hull or turret first, then layer in class and team specific art later.
