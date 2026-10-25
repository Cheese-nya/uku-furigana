import React from 'react';

/** SF Symbols–style line icons: 24px grid, 1.75 stroke, round caps. */
type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function make(paths: React.ReactNode, filled = false) {
  return function Icon({ size = 18, className = '', ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`shrink-0 ${className}`}
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconEdit = make(<><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>);
export const IconBooks = make(<><rect x="4" y="4" width="4.5" height="16" rx="1" /><rect x="10" y="4" width="4.5" height="16" rx="1" /><path d="m16.6 5.2 3.2-.8 2.7 14.5-3.2.8z" /></>);
export const IconRead = make(<><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z" /><path d="M12 6.5v13" /></>);
export const IconStack = make(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);
export const IconGear = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
export const IconMore = make(<><circle cx="5.5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" /></>);
export const IconMoreVertical = make(<><circle cx="12" cy="5.5" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="18.5" r="1.3" fill="currentColor" /></>);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconStar = make(<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" />);
export const IconStarFill = make(<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" />, true);
export const IconChevronDown = make(<path d="m7 10 5 5 5-5" />);
export const IconChevronLeft = make(<path d="m15 5-7 7 7 7" />);
export const IconChevronRight = make(<path d="m9 5 7 7-7 7" />);
export const IconShare = make(<><path d="M12 15V3.5M8 7.5l4-4 4 4" /><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" /></>);
export const IconImport = make(<><path d="M12 3.5V15M8 11l4 4 4-4" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>);
export const IconTextFormat = make(<><path d="m3 18 5-12 5 12M4.7 14h6.6" /><path d="M15.5 12.2a3 3 0 0 1 5.5 1.6V18m0-2.6c0 1.6-1.2 2.8-2.8 2.8-1.4 0-2.4-.8-2.4-2 0-1.3 1.1-2 2.6-2H21" /></>);
export const IconDictionary = make(<><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5v-15Z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /><path d="M9 8h6M9 11.5h4" /></>);
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconDoc = make(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></>);
export const IconLink = make(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const IconPaste = make(<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h4" /></>);
export const IconTrash = make(<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />);
export const IconWarning = make(<><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4.5M12 17.5v.01" /></>);
export const IconRuby = make(<><path d="M5 20h14M8 20V11h8v9M12 11v9" /><path d="M7 5.5h2.5M11 5.5h2M15 5.5h2" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>);
export const IconMoon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />);
export const IconGlobe = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9s1.3-6.2 3.8-9Z" /></>);
export const IconHeart = make(<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" />);
export const IconPulse = make(<path d="M3 12h4l2.5-6 5 12 2.5-6h4" />);
export const IconRefresh = make(<><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></>);
export const IconBookmark = make(<path d="M6.5 3.5h11v17L12 16.5l-5.5 4v-17Z" />);
export const IconFolder = make(<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.4l2 2H19A1.5 1.5 0 0 1 20.5 9v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V7Z" />);
export const IconBug = make(<><rect x="8" y="8" width="8" height="10" rx="4" /><path d="M9.5 5 8 3.2M14.5 5l1.5-1.8" /><path d="M8 11.5H4.5M16 11.5h3.5M8 15l-3.2 1.8M16 15l3.2 1.8M8.4 8.6 4.8 7.4M15.6 8.6l3.6-1.2" /></>);
export const IconMessage = make(<path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12Z" />);
export const IconUsers = make(<><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" /><path d="M15.8 5.7a3.2 3.2 0 0 1 0 6.1" /><path d="M17.4 14.5c2.1.6 3.6 2.4 3.6 5" /></>);
export const IconTranslate = make(<><path d="M3.5 5.5h9M8 3.5v2M5.5 5.5c.6 3.2 2.8 5.8 6 7" /><path d="M10.5 5.5c-.6 3.4-2.8 6-6.5 7.5" /><path d="m12.5 20.5 4-10 4 10M14 17h5" /></>);
export const IconCopy = make(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>);
export const IconDownload = make(<><path d="M12 4v10" /><path d="m7.5 10 4.5 4.5L16.5 10" /><path d="M5 19h14" /></>);

export function IconXLogo({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function IconGitHub({ size = 16, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" />
    </svg>
  );
}
