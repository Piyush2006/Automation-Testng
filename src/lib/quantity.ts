export type Family = "volume" | "mass" | "count";

export type Amount = { value: number; unit: string; family: Family };

export type LotQuantity = {
  /** Containers on the row (Quantity column). */
  containers: number;
  /** Containers not yet consumed (Quantity Remaining, falling back to Quantity). */
  containersLeft: number;
  size?: Amount;
  left?: Amount;
  consumed?: Amount;
};

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const WORD = String.raw`([a-zA-Zµμ]+)?`;

const UNIT_TABLE: Record<string, { unit: string; family: Family; factor: number }> = {
  ml: { unit: "mL", family: "volume", factor: 1 },
  l: { unit: "mL", family: "volume", factor: 1000 },
  ul: { unit: "mL", family: "volume", factor: 0.001 },
  "µl": { unit: "mL", family: "volume", factor: 0.001 },
  "μl": { unit: "mL", family: "volume", factor: 0.001 },
  g: { unit: "g", family: "mass", factor: 1 },
  gm: { unit: "g", family: "mass", factor: 1 },
  mg: { unit: "g", family: "mass", factor: 0.001 },
  kg: { unit: "g", family: "mass", factor: 1000 },
  each: { unit: "each", family: "count", factor: 1 },
};

function toNumber(raw: string): number {
  return Number(raw.replace(",", "."));
}

function amount(rawValue: number, rawUnit: string | undefined): Amount {
  const key = (rawUnit ?? "").toLowerCase();
  const known = UNIT_TABLE[key];
  if (known) return { value: rawValue * known.factor, unit: known.unit, family: known.family };
  return { value: rawValue, unit: key || "units", family: "count" };
}

/**
 * Reads the Unit text Vyriad records per row:
 * "10 mL", "1Kg", "5 bags", "10x3mL", "1000 mL (750 mL)" (container size, then amount left in it).
 */
export function parseUnit(text: string): { size?: Amount; remainingPerContainer?: Amount } {
  const t = text.trim();
  if (!t || /^n\/?a$/i.test(t)) return {};

  let size: Amount | undefined;
  const multi = t.match(new RegExp(String.raw`^${NUM}\s*[x×]\s*${NUM}\s*${WORD}`, "i"));
  if (multi) {
    size = amount(toNumber(multi[1]!) * toNumber(multi[2]!), multi[3]);
  } else {
    const main = t.match(new RegExp(String.raw`${NUM}\s*${WORD}`));
    if (main) size = amount(toNumber(main[1]!), main[2]);
  }
  if (!size) return {};

  const paren = t.match(new RegExp(String.raw`\(\s*${NUM}\s*${WORD}\s*\)`));
  if (!paren) return { size };
  const remaining = amount(toNumber(paren[1]!), paren[2] ?? (size.family === "count" ? size.unit : undefined));
  if (remaining.family !== size.family || remaining.unit !== size.unit) return { size };
  return { size, remainingPerContainer: remaining };
}

function parseCount(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Amount left on one inventory row:
 * containers left × (amount left in a container, or the container size).
 */
export function lotQuantity(input: { quantity: string; remaining: string; unit: string }): LotQuantity {
  const containers = parseCount(input.quantity) ?? 1;
  const containersLeft = Math.min(parseCount(input.remaining) ?? containers, Math.max(containers, 0));
  const { size, remainingPerContainer } = parseUnit(input.unit);
  if (!size) return { containers, containersLeft };

  const perContainer = remainingPerContainer ?? size;
  const left: Amount = { ...size, value: containersLeft * perContainer.value };
  const usedContainers = Math.max(0, containers - containersLeft);
  const partial = Math.max(0, size.value - perContainer.value);
  const consumed: Amount = { ...size, value: usedContainers * size.value + containersLeft * partial };
  return { containers, containersLeft, size, left, consumed };
}

/**
 * Sandbox Materials Manager stores a numeric Quantity / Total Quantity / Quantity Left
 * and a separate Unit LIST (mL, uL, g, …). Prefer Quantity Left, then Total Quantity, then Quantity.
 */
export function lotQuantityFromFields(input: {
  quantity: string;
  totalQuantity: string;
  remaining: string;
  consumed: string;
  unit: string;
}): LotQuantity {
  const unitKey = input.unit.trim();
  const leftRaw = parseCount(input.remaining) ?? parseCount(input.totalQuantity) ?? parseCount(input.quantity);
  if (leftRaw === undefined) return { containers: 1, containersLeft: 1 };
  const left = amount(leftRaw, unitKey || undefined);
  const consumedRaw = parseCount(input.consumed);
  const consumed = consumedRaw === undefined ? undefined : amount(consumedRaw, unitKey || undefined);
  const sizeRaw = parseCount(input.quantity);
  const size = sizeRaw === undefined ? left : amount(sizeRaw, unitKey || undefined);
  return {
    containers: 1,
    containersLeft: 1,
    size,
    left,
    consumed,
  };
}

const FAMILY_ORDER: Record<Family, number> = { volume: 0, mass: 1, count: 2 };

export function sumAmounts(amounts: Array<Amount | undefined>): Amount[] {
  const totals = new Map<string, Amount>();
  for (const a of amounts) {
    if (!a) continue;
    const key = `${a.family}:${a.unit}`;
    const prev = totals.get(key);
    totals.set(key, prev ? { ...prev, value: prev.value + a.value } : { ...a });
  }
  return [...totals.values()].sort(
    (x, y) => FAMILY_ORDER[x.family] - FAMILY_ORDER[y.family] || x.unit.localeCompare(y.unit),
  );
}

export function formatAmount(a: Amount): string {
  const value = Math.round(a.value * 1000) / 1000;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${a.unit}`;
}

export function formatTotals(totals: Amount[]): string {
  return totals.map(formatAmount).join(" · ");
}
