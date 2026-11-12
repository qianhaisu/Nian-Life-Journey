import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: "linear-gradient(135deg, #2563EB 0%, #3B82F6 54%, #60A5FA 100%)",
        borderRadius: 42,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFFFFF",
        fontSize: 106,
        fontWeight: 700,
        fontFamily: "sans-serif",
      }}
    >
      年
    </div>,
    { ...size }
  );
}
