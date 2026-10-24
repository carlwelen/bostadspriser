import { ImageResponse } from "next/og";
import { SOCIAL_IMAGE_ALT } from "./siteMetadata";

export const alt = SOCIAL_IMAGE_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Static brand artwork: no database queries, remote assets or invented price data. */
export default function SocialImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#0b0d12", color: "white" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 34, fontWeight: 700 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 72, height: 72, borderRadius: 16, background: "#27272a" }}>
          <svg viewBox="0 0 20 20" width="46" height="46" fill="none">
            <path d="M3 14V8M3 14H17M7 14V5M11 14V10M15 14V3" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <span>Bostadspriser</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 64, fontWeight: 700, lineHeight: 1.15 }}>
        <span>Slutpriser och prisutveckling</span>
        <span>i Stockholms innerstad</span>
      </div>
      <div style={{ display: "flex", fontSize: 25, color: "#d4d4d8" }}>Östermalm · Vasastan · Norrmalm · Södermalm</div>
    </div>, size
  );
}
