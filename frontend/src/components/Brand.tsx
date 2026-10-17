import "./brand.css";

/** Font-independent version of the selected d. mark. */
export function BrandMark({ decorative = false }: { decorative?: boolean }) {
  return (
    <svg
      className="dotori-mark"
      viewBox="0 0 96 96"
      fill="currentColor"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "dotori studio"}
      aria-hidden={decorative || undefined}
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M57 7c3.87 0 7 3.13 7 7v42c0 16.57-13.43 30-30 30S4 72.57 4 56s13.43-30 30-30c5.87 0 11.34 1.69 16 4.6V14c0-3.87 3.13-7 7-7ZM34 41c-8.28 0-15 6.72-15 15s6.72 15 15 15 15-6.72 15-15-6.72-15-15-15Z"
      />
      <circle cx="82" cy="77" r="9" />
    </svg>
  );
}
export function BrandWordmark() {
  return <span className="dotori-wordmark">dotori studio</span>;
}
