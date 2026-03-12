import { NextResponse } from "next/server";
import { lookupIndianPincode } from "@/lib/indiaAddress";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const pincode = searchParams.get("pincode") || "";
  const result = await lookupIndianPincode(pincode);

  if (!result.success) {
    const status = result.code === "INVALID_PINCODE" ? 400 : result.code === "PINCODE_NOT_FOUND" ? 404 : 502;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result);
}