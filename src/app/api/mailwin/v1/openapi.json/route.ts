import { NextResponse } from "next/server";
import { mailwinOpenApi } from "@/server/mailwin/openapi";

/** Öffentlich: Die Spezifikation enthält keine Daten, nur den Vertrag. */
export function GET() {
  return NextResponse.json(mailwinOpenApi(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
