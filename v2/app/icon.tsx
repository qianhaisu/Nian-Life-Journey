import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 32,
        height: 32,
        background: "linear-gradient(135deg, #2563EB 0%, #3B82F6 54%, #60A5FA 100%)",
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFFFFF",
        fontSize: 19,
        fontWeight: 700,
        fontFamily: "sans-serif",
      }}
    >
      年
    </div>,
    { ...size }
  );
}
