import { describe, expect, it } from "vitest";
import { fmtUsdc, fmtTokens, fmtBps } from "@/lib/format";

describe("fmtUsdc", () => {
  it("renders two decimals by default", () => {
    expect(fmtUsdc(49_000_000_000n)).toBe("49,000.00");
  });
  it("omits the dot when decimals = 0 (no '60,000.' bug)", () => {
    expect(fmtUsdc(60_000_000_000n, 0)).toBe("60,000");
    expect(fmtUsdc(0n, 0)).toBe("0");
    expect(fmtUsdc(50_000_000n, 0)).toBe("50");
  });
  it("handles negatives", () => {
    expect(fmtUsdc(-1_500_000n, 0)).toBe("−1");
  });
});

describe("fmtTokens / fmtBps", () => {
  it("trims .00", () => {
    expect(fmtTokens(1_000_000_000n)).toBe("1,000");
  });
  it("formats bps", () => {
    expect(fmtBps(7000)).toBe("70%");
    expect(fmtBps(250)).toBe("2.5%");
  });
});
