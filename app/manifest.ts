import type { MetadataRoute } from "next";

// Installable from the browser (「ホーム画面に追加」): it opens standalone on the start page, in the notebook's colours
// (--paper in styles/tokens.css), with the key-tag icons from app/icon.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "代々 Daidai",
    short_name: "代々",
    description: "知識は人ではなく、席に受け継がれる。",
    lang: "ja",
    start_url: "/",
    display: "standalone",
    background_color: "#F9FAFB",
    theme_color: "#F9FAFB",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
