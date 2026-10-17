import { handleMyNotes } from "@/lib/engine/notes";

// GET /api/me/notes (F4.2): 自分のメモ, every note the caller wrote, withdrawn ones included. The flow lives in
// lib/engine/notes.ts; the handler acts as the caller (Bearer token).
export function GET(request: Request): Promise<Response> {
  return handleMyNotes(request);
}
