import React from 'react';
import { MARK_PATHS, MARK_VIEWBOX } from './brandMarkPaths';

/**
 * JJELOTECH SYSTEMS brand marks.
 *
 * The mark — a rising sun over a forward chevron — is drawn from the vector
 * master in logo/favicon.svg (generated into brandMarkPaths.ts by
 * scripts/brand-assets.mjs), so it scales cleanly and needs no image request.
 * It reads on light and dark surfaces alike: the sun and chevron carry their
 * own colour, and nothing in the mark depends on the background.
 *
 * Replacing the artwork: overwrite logo/favicon.svg and run
 * `node scripts/brand-assets.mjs` in apps/frontend. See public/logos/README.md.
 */

export const BRAND_NAME = 'JJELOTECH SYSTEMS';
export const BRAND_TAGLINE = 'Engineering the Dawn of Enterprise Systems';

/** The mark on its own — no wordmark. */
export const JjeloTechMark: React.FC<{ className?: string; idSuffix?: string; title?: string }> = ({
  className = '',
  title,
}) => (
  <svg
    viewBox={MARK_VIEWBOX}
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role={title ? 'img' : 'presentation'}
    aria-label={title}
    aria-hidden={title ? undefined : true}
  >
    {MARK_PATHS.map((p, i) => <path key={i} fill={p.fill} d={p.d} />)}
  </svg>
);

/**
 * The wordmark as type: "JJELOTECH" over "SYSTEMS", letter-spaced. Set in
 * text rather than traced outlines so it takes the theme's colours and stays
 * sharp at every size.
 */
export const JjeloTechWordmark: React.FC<{ size?: 'sm' | 'md' | 'lg'; tagline?: boolean; className?: string }> = ({
  size = 'md',
  tagline = false,
  className = '',
}) => {
  const name = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' }[size];
  const sub = { sm: 'text-[9px]', md: 'text-[10px]', lg: 'text-xs' }[size];
  return (
    <span className={`flex flex-col leading-none ${className}`}>
      <span className={`font-extrabold tracking-[0.08em] ${name}`}>JJELOTECH</span>
      <span className={`font-semibold tracking-[0.42em] text-accent-500 mt-1 ${sub}`}>SYSTEMS</span>
      {tagline && <span className="text-xs text-muted mt-1.5 tracking-normal">{BRAND_TAGLINE}</span>}
    </span>
  );
};

/** Full lockup: mark plus wordmark. */
export const JjeloTechLogo: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  tagline?: boolean;
  className?: string;
  idSuffix?: string;
}> = ({ size = 'md', showText = true, tagline = false, className = '' }) => {
  const mark = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-16 h-16' }[size];
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <JjeloTechMark className={`${mark} flex-shrink-0`} title={showText ? undefined : BRAND_NAME} />
      {showText && <JjeloTechWordmark size={size} tagline={tagline} />}
    </div>
  );
};

/** The mark on a dark tile, as in the app icon, for tight spots. */
export const JjeloTechIcon: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string }> = ({
  size = 'md',
  className = '',
}) => {
  const box = { sm: 'w-6 h-6', md: 'w-8 h-8', lg: 'w-12 h-12' }[size];
  return (
    <div className={`${box} rounded-lg bg-[#0b1020] flex items-center justify-center flex-shrink-0 ${className}`}>
      <JjeloTechMark className="w-[80%] h-[80%]" title={BRAND_NAME} />
    </div>
  );
};

export { JjeloTechMark as default };
