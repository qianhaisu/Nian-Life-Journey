import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: "#C2A88A",
        borderRadius: 38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#F9F6F0",
        fontSize: 110,
        fontWeight: 500,
        fontFamily: "serif",
      }}
    >
      年
    </div>,
    { ...size }
  );
}
