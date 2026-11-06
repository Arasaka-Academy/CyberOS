// Generated from packages/tokens/src/index.ts. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.

export interface Palette { bg: string; ink: string; muted: string; line: string; soft: string; accent: string; accent2: string }
export type Mode = 'light' | 'dark';
export type ThemeMode = Mode | 'system';
export type Locale = 'en' | 'zh-CN';
export const schemes = {
  neon: {
    light: { bg:'#FFFFFF',ink:'#1E1517',muted:'#6B4A47',line:'#DCC3BF',soft:'#EFE1DE',accent:'#C2362B',accent2:'#0E7C86' },
    dark: { bg:'#1E1517',ink:'#93E4EA',muted:'#C9A19C',line:'#5A3A3C',soft:'#3E2729',accent:'#E0574B',accent2:'#93E4EA' }
  },
  mono: {
    light: { bg:'#FFFFFF',ink:'#000000',muted:'#555555',line:'#BDBDBD',soft:'#DADADA',accent:'#000000',accent2:'#000000' },
    dark: { bg:'#000000',ink:'#FFFFFF',muted:'#A6A6A6',line:'#4A4A4A',soft:'#333333',accent:'#FFFFFF',accent2:'#FFFFFF' }
  },
  graphite: {
    light: { bg:'#FFFFFF',ink:'#141414',muted:'#5C5C5C',line:'#C4C4C4',soft:'#E3E3E3',accent:'#4A4A4A',accent2:'#7A7A7A' },
    dark: { bg:'#000000',ink:'#E8E8E8',muted:'#9E9E9E',line:'#4D4D4D',soft:'#262626',accent:'#BDBDBD',accent2:'#8C8C8C' }
  },
  synthwave: {
    light: { bg:'#FFFFFF',ink:'#000000',muted:'#555555',line:'#F9C8E0',soft:'#FCE4F0',accent:'#EC4899',accent2:'#C62828' },
    dark: { bg:'#000000',ink:'#F0C7C7',muted:'#A6A6A6',line:'#5E1D3D',soft:'#3B1226',accent:'#EC4899',accent2:'#DA7373' }
  },
  bloodline: {
    light: { bg:'#FFFFFF',ink:'#1A0A0A',muted:'#6E4A47',line:'#E6C4C4',soft:'#F5E1E1',accent:'#9E0B16',accent2:'#C1121F' },
    dark: { bg:'#0B0505',ink:'#EAD7D2',muted:'#9C7470',line:'#4A1A1A',soft:'#2A0E0E',accent:'#D01A2A',accent2:'#FF4D4D' }
  },
  terminal: {
    light: { bg:'#FFFFFF',ink:'#0B1410',muted:'#3D5A48',line:'#BFD6C7',soft:'#DCEBE1',accent:'#0F7A45',accent2:'#0F7A45' },
    dark: { bg:'#0B1410',ink:'#7BF0A8',muted:'#9FC4AE',line:'#2F5A43',soft:'#1C3528',accent:'#7BF0A8',accent2:'#7BF0A8' }
  },
  amber: {
    light: { bg:'#FFFFFF',ink:'#1A1206',muted:'#6B5330',line:'#E2D0B2',soft:'#F0E4CF',accent:'#B86A00',accent2:'#C2410C' },
    dark: { bg:'#140E05',ink:'#FFB347',muted:'#C9A06A',line:'#4A3416',soft:'#33240E',accent:'#FFB347',accent2:'#FF6B35' }
  }
} satisfies Record<string, Record<Mode, Palette>>;
export type Scheme = keyof typeof schemes;
export interface Theme extends Palette { accentText: string; onAccent: string; onAccent2: string; onInk: string; success: string; warning: string; danger: string; info: string }

function luminance(hex: string) {
  const channels = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
  return (channels[0] ?? 0)*.2126 + (channels[1] ?? 0)*.7152 + (channels[2] ?? 0)*.0722;
}
export function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function readableOn(background: string) {
  return contrast(background,'#000000') > contrast(background,'#FFFFFF') ? '#000000' : '#FFFFFF';
}
export function createTheme(scheme: Scheme = 'neon', mode: Mode = 'dark', custom: Partial<Palette> = {}): Theme {
  const base = schemes[scheme]?.[mode] ?? schemes.neon.dark;
  const palette: Palette = { ...base };
  for (const key of Object.keys(base) as (keyof Palette)[]) {
    const value = custom[key];
    if (value && /^#[0-9a-f]{6}$/i.test(value)) palette[key] = value;
  }
  // A custom background must not accidentally hide body or helper text.
  if (contrast(palette.ink,palette.bg) < 4.5) palette.ink = readableOn(palette.bg);
  if (contrast(palette.ink,palette.soft) < 4.5) palette.soft = palette.bg;
  const text = (color: string) => Math.min(contrast(color,palette.bg),contrast(color,palette.soft)) >= 4.5 ? color : palette.ink;
  palette.muted = text(palette.muted);
  return { ...palette, accentText: text(palette.accent), onAccent: readableOn(palette.accent), onAccent2: readableOn(palette.accent2), onInk: palette.bg,
    success: text(mode==='dark'?'#8EE3AA':'#236B3A'), warning: text(mode==='dark'?'#FFC36A':'#885000'),
    danger: text(mode==='dark'?'#FF9389':'#B3261E'), info: palette.ink };
}
export const geometry = { cut: 12, cutSmall: 8, stroke: 2, hair: 1, bracket: 16, touch: 44 } as const;
export const spacing = { xs:4, sm:6, md:10, lg:14, xl:18, '2xl':24, '3xl':32, '4xl':48, '5xl':64 } as const;
export const fontSets = [
  { id:'oxanium', name:'Oxanium', display:'Oxanium', body:'Oxanium' },
  { id:'chakra', name:'Chakra Petch', display:'ChakraPetch', body:'ChakraPetch' },
  { id:'tomorrow', name:'Tomorrow', display:'Tomorrow', body:'Tomorrow' },
  { id:'rajdhani', name:'Rajdhani', display:'Rajdhani', body:'Rajdhani' },
  { id:'orbitron', name:'Orbitron', display:'Orbitron', body:'Exo2' },
  { id:'turret', name:'Turret Road', display:'TurretRoad', body:'TurretRoad' },
  { id:'michroma', name:'Michroma', display:'Michroma', body:'Electrolize' },
  { id:'audiowide', name:'Audiowide', display:'Audiowide', body:'ShareTech' },
  { id:'wallpoet', name:'Wallpoet', display:'Wallpoet', body:'ShareTech' },
  { id:'russo', name:'Russo One', display:'RussoOne', body:'ShareTech' },
  { id:'iceland', name:'Iceland', display:'Iceland', body:'Iceland' },
  { id:'terminal', name:'Terminal', display:'VT323', body:'VT323' },
  { id:'arcade', name:'Arcade', display:'PressStart2P', body:'VT323' },
  { id:'system', name:'System fonts', display:'system-ui', body:'system-ui' }
] as const;
