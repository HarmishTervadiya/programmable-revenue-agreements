import { readFileSync } from "node:fs";

/** JSON quantities use decimal strings so consumers never lose integer precision. */
export function decode(value: any): any {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, decode(item)]),
    );
  return value;
}
export const vectors = decode(
  JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8")),
);
