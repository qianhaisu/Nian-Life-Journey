import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 32,
        height: 32,
        background: "#C2A88A",
        borderRadius: 7,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#F9F6F0",
        fontSize: 20,
        fontWeight: 500,
        fontFamily: "serif",
      }}
    >
      年
    </div>,
    { ...size }
  );
}
