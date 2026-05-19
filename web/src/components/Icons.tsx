import type { SVGProps, ReactNode } from 'react';

type Props = Omit<SVGProps<SVGSVGElement>, 'stroke'> & { size?: number; stroke?: number; children?: ReactNode };

const Base = ({ children, size = 16, stroke = 1.6, ...rest }: Props) => (
  <svg
    className="icon"
    role="img"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

export const IconHome = (p: Props) => <Base {...p}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V9.5z" /></Base>;
export const IconBox = (p: Props) => <Base {...p}><path d="M21 8L12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></Base>;
export const IconCheck = (p: Props) => <Base {...p}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Base>;
export const IconClipboard = (p: Props) => <Base {...p}><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h6" /></Base>;
export const IconSettings = (p: Props) => <Base {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></Base>;
export const IconBell = (p: Props) => <Base {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Base>;
export const IconSearch = (p: Props) => <Base {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></Base>;
export const IconStar = (p: Props) => <Base {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Base>;
export const IconFire = (p: Props) => <Base {...p}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 17c1.5 0 3-2.5 3-2.5 0 0 1.5 2.5 3 2.5a2.5 2.5 0 0 0 2.5-2.5c0-1.5-1-3-1-4.5C18.5 5 15 3 12 3s-6.5 2-6.5 7c0 1.5-1 3-1 4.5z" /></Base>;
export const IconPlus = (p: Props) => <Base {...p}><path d="M12 5v14M5 12h14" /></Base>;
export const IconDownload = (p: Props) => <Base {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></Base>;
export const IconCopy = (p: Props) => <Base {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Base>;
export const IconChevronDown = (p: Props) => <Base {...p}><path d="M6 9l6 6 6-6" /></Base>;
export const IconChevronRight = (p: Props) => <Base {...p}><path d="M9 6l6 6-6 6" /></Base>;
export const IconCheckCircle = (p: Props) => <Base {...p}><path d="M22 11.1V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></Base>;
export const IconAlertTriangle = (p: Props) => <Base {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></Base>;
export const IconXCircle = (p: Props) => <Base {...p}><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></Base>;
export const IconGrid = (p: Props) => <Base {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Base>;
export const IconList = (p: Props) => <Base {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Base>;
export const IconFilter = (p: Props) => <Base {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></Base>;
export const IconSidebar = (p: Props) => <Base {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></Base>;
export const IconChat = (p: Props) => <Base {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Base>;
export const IconRocket = (p: Props) => <Base {...p}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /></Base>;
export const IconCode = (p: Props) => <Base {...p}><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></Base>;
export const IconFile = (p: Props) => <Base {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></Base>;
export const IconClock = (p: Props) => <Base {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Base>;
export const IconUsers = (p: Props) => <Base {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></Base>;
export const IconArrowUp = (p: Props) => <Base {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Base>;
export const IconArrowDown = (p: Props) => <Base {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></Base>;
export const IconExternal = (p: Props) => <Base {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14L21 3" /></Base>;
export const IconBookmark = (p: Props) => <Base {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></Base>;
export const IconMore = (p: Props) => <Base {...p}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Base>;
export const IconSun = (p: Props) => <Base {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Base>;
export const IconMoon = (p: Props) => <Base {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Base>;
export const IconMonitor = (p: Props) => <Base {...p}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></Base>;
export const IconCamera = (p: Props) => <Base {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></Base>;
export const IconUpload = (p: Props) => <Base {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></Base>;
export const IconImage = (p: Props) => <Base {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></Base>;
export const IconTrash = (p: Props) => <Base {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Base>;
export const IconX = (p: Props) => <Base {...p}><path d="M18 6L6 18M6 6l12 12" /></Base>;
export const IconSparkles = (p: Props) => <Base {...p}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" /><path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9L19 14z" /><path d="M5 14l.7 2.1L8 17l-2.3.9L5 20l-.7-2.1L2 17l2.3-.9L5 14z" /></Base>;
export const IconStop = (p: Props) => <Base {...p}><rect x="6" y="6" width="12" height="12" rx="1" /></Base>;
export const IconRefresh = (p: Props) => <Base {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4" /></Base>;
export const IconSend = (p: Props) => <Base {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></Base>;
export const IconPencil = (p: Props) => <Base {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></Base>;
