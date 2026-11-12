import { BrandLogo } from "./BrandLogo.js";

interface BrandBannerProps {
  alt?: string;
}

export function BrandBanner({ alt = "" }: BrandBannerProps) {
  const decorative = alt.length === 0;

  return (
    <span
      className="brand-banner"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative || undefined}
    >
      <BrandLogo className="brand-banner-mark" />
      <BrandLogo className="brand-banner-wordmark" variant="wordmark" />
    </span>
  );
}
