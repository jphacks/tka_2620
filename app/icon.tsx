import { ImageResponse } from "next/og";
import { AppMark } from "@/app/app-mark";

// The browser tab's icon and the installed app's icons (app/manifest.ts): /icon/32, /icon/192 and /icon/512.
export function generateImageMetadata() {
  return [32, 192, 512].map((side) => ({
    id: String(side),
    size: { width: side, height: side },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const side = Number(await id);
  return new ImageResponse(<AppMark size={side} padded={side > 32} />, {
    width: side,
    height: side,
  });
}
