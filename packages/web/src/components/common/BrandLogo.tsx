import { useAppearance } from "@cyberos/ui";

const artwork = {
  symbol: { light: "/cyberos-icon.svg", dark: "/cyberos-icon-white.svg" },
  "symbol-small": { light: "/cyberos-icon-small.svg", dark: "/cyberos-icon-small-white.svg" },
  wordmark: { light: "/cyberos-wordmark.svg", dark: "/cyberos-wordmark-white.svg" }
} as const;

interface BrandLogoProps {
  variant?: keyof typeof artwork;
  className?: string;
  alt?: string;
}

export function BrandLogo({ variant = "symbol-small", className, alt = "" }: BrandLogoProps) {
  const { mode } = useAppearance();
  return <img className={className} src={artwork[variant][mode]} alt={alt} aria-hidden={alt ? undefined : true} />;
}
