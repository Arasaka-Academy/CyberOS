# React Bits TextType

- Source: https://github.com/DavidHDev/react-bits
- Commit: `9d9c687dc4f55b23539aa5417b703078047efa74`
- Files: `src/ts-default/TextAnimations/TextType/TextType.tsx` and `TextType.css`
- License: the complete upstream MIT + Commons Clause license is in `LICENSE.md`.

CyberOS adapts TextType's grapheme-based typing, caret and reduced-motion behavior
for continuously appended Agent replies. The streaming controller uses animation
frames and adaptive pacing; Markdown is supplied through a render callback.
CSS replaces the GSAP caret animation. Looping, deletion, simulated mistakes,
multi-sentence rotation and decorative character effects are omitted. Original
colors and typography are inherited from the CyberOS theme.
