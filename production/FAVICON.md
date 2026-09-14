# ARENA favicon asset

Final project asset: `dist/assets/arena-favicon.png` (transparent RGBA PNG).
The supplied source remains unchanged in the owner's Downloads folder:
`Black White Minimal Simple Modern Pixel Neon  Modern AI Logo (47).png`.

Produced using the built-in image_gen tool (not the CLI). The source had an opaque #f4f4f4 background; the resulting image has transparent corners and internal negative space, with a larger symbol footprint. Only the browser favicon uses this asset; header/footer branding keeps its existing source.

Final prompt:

> Use case: background-extraction. Edit the supplied ARENA logo into a production PNG favicon. Preserve the exact original geometric symbol, all straight edges, proportions, cutouts and solid purple #7d6db3 color. Remove the light grey background completely: actual fully transparent alpha, including all negative spaces, not a checkerboard illustration. Enlarge and center the existing symbol on a square canvas so its bounding box fills about 90% of both canvas dimensions, leaving roughly 5% transparent padding at each side. Crisp antialiased flat edges suitable for a small browser favicon. No text, no shadows, no gradients, no new shapes. Output a transparent PNG. This is only background removal and tighter framing, do not redesign the mark.
