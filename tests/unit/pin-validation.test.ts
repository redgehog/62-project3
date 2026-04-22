import { describe, it, expect } from "vitest";

// The PIN regex used in cashier-login action
const isValidPin = (pin: string) => /^\d{4,8}$/.test(pin);

describe("PIN validation", () => {
  it("accepts a 4-digit PIN", () => {
    expect(isValidPin("1234")).toBe(true);
  });

  it("accepts an 8-digit PIN", () => {
    expect(isValidPin("12345678")).toBe(true);
  });

  it("accepts 5, 6, and 7-digit PINs", () => {
    expect(isValidPin("12345")).toBe(true);
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("1234567")).toBe(true);
  });

  it("rejects a 3-digit PIN (too short)", () => {
    expect(isValidPin("123")).toBe(false);
  });

  it("rejects a 9-digit PIN (too long)", () => {
    expect(isValidPin("123456789")).toBe(false);
  });

  it("rejects alphabetic characters", () => {
    expect(isValidPin("abcd")).toBe(false);
  });

  it("rejects mixed alphanumeric", () => {
    expect(isValidPin("1234a")).toBe(false);
  });

  it("rejects PIN with spaces", () => {
    expect(isValidPin("12 34")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidPin("")).toBe(false);
  });

  it("rejects a PIN with leading/trailing spaces", () => {
    expect(isValidPin(" 1234")).toBe(false);
    expect(isValidPin("1234 ")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidPin("12#4")).toBe(false);
    expect(isValidPin("1234!")).toBe(false);
  });
});
