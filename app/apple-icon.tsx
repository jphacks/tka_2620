import { ImageResponse } from "next/og";
import { AppMark } from "@/app/app-mark";

// The home-screen icon on an iPhone (「ホーム画面に追加」), so the predecessor keeps the seat one tap away.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppMark size={180} />, size);
}
