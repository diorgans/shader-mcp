---
name: shader-scenes
description: Design live, animated WebGPU shader backgrounds and effects (gradients, halftone, glow, grain) and export them as React code. Use when someone asks for a shader, animated background, generative visual, hero effect, or a mood like "make it look like a jazz bar / neon / retro print".
---

# Shader scenes

Requires the shader-mcp server. If its tools (list_shaders, describe_shader, create_scene, export_code) are missing, tell the user to add it:
`claude mcp add shader-mcp -- npx -y shader-mcp`

## Workflow
1. Turn the request into a mood: palette, motion, texture.
2. Call list_shaders. Pick one generator (bottom layer) and 1-3 filters.
3. Call describe_shader on your picks before setting values. Several settings work the opposite way from what their names suggest.
4. Call create_scene with 2-4 layers. Write every value as a string. Fix any errors and resubmit.
5. Give the user the preview link (needs a WebGPU browser: recent Chrome, Edge or Safari).
6. Offer export_code for a React component.

## Taste rules
- 2-4 layers beats 6. Contrast comes from the palette, not more layers.
- Iterate from the preview: change one or two settings at a time.
