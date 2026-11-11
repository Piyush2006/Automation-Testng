import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SHEETS } from "@/config";
import { filled, type Chain, type Lot } from "@/lib/data";
import { formatAmount, formatTotals } from "@/lib/quantity";
import { lotTitle, type GraphNode } from "./CustodyGraph";

type Field = { label: string; value: string };

type Props = {
  chain: Chain;
  node: GraphNode;
  onClose: () => void;
  /** Open the labsheet that owns this node. Pass the exact sheet name for that kind. */
  onOpenSheet: (sheet: string) => Promise<string | null> | string | null;
};

function containersLine(lot: Lot): string {
  const unit = filled(lot.unitText);
  const count = lot.quantityText || String(lot.quantity.containers);
  if (!unit) return count ? `${count} container${count === "1" ? "" : "s"}` : "";
  const left =
    lot.quantity.containersLeft !== lot.quantity.containers ? ` (${lot.quantity.containersLeft} left)` : "";
  return `${count} × ${unit}${left}`;
}

/** Each node kind opens only its own labsheet — never share inventory for vendor/item. */
function sheetFor(node: GraphNode): { sheet: string; label: string } | null {
  if (node.kind === "item") {
    return { sheet: SHEETS.items, label: `Open ${SHEETS.items}` };
  }
  if (node.kind === "lot") {
    return { sheet: SHEETS.inventory, label: `Open ${SHEETS.inventory}` };
  }
  if (!SHEETS.vendors) return null;
  return { sheet: SHEETS.vendors, label: `Open ${SHEETS.vendors}` };
}

function describe(chain: Chain, node: GraphNode) {
  const open = sheetFor(node);

  if (node.kind === "item") {
    const fields: Field[] = [
      { label: "Item ID", value: chain.item.id },
      { label: "Total quantity left", value: formatTotals(chain.totals) },
      { label: "Lots", value: String(chain.lots.length) },
      { label: "Synonyms", value: chain.item.synonyms },
    ];
    return {
      kicker: "Inventory item",
      title: chain.item.name,
      fields,
      copy: { label: "Copy item ID", value: chain.item.id },
      open,
      status: "",
    };
  }

  const lot = node.lot;
  if (node.kind === "vendor") {
    const fields: Field[] = [
      { label: "Manufacturer", value: filled(lot.manufacturer) },
      { label: "Catalog number", value: filled(lot.catalog) },
      { label: "Supplied lot", value: filled(lot.lotNumber) },
      { label: "Product", value: lot.description },
      { label: "Inventory row", value: lot.internalId },
    ];
    return {
      kicker: "Vendor",
      title: filled(lot.manufacturer) || filled(lot.catalog),
      fields,
      copy: filled(lot.catalog) ? { label: "Copy catalog number", value: filled(lot.catalog) } : null,
      open,
      status: "",
    };
  }

  const { kicker, title } = lotTitle(lot);
  const fields: Field[] = [
    { label: "Product", value: lot.description },
    { label: "Inventory row", value: lot.internalId },
    { label: "Lot number", value: filled(lot.lotNumber) },
    { label: "Quantity left", value: lot.quantity.left ? formatAmount(lot.quantity.left) : "" },
    { label: "Quantity consumed", value: lot.quantity.consumed ? formatAmount(lot.quantity.consumed) : "" },
    { label: "Containers", value: containersLine(lot) },
    { label: "Expiration date", value: filled(lot.expiry) },
    { label: "Location", value: filled(lot.location) },
    { label: "Manufacturer", value: filled(lot.manufacturer) },
    { label: "Catalog number", value: filled(lot.catalog) },
    { label: "RIN number", value: filled(lot.rin) },
    { label: "Chemical Item link", value: lot.linked ? "" : "Not set; matched by product name" },
  ];
  return {
    kicker,
    title,
    fields,
    copy: { label: "Copy inventory ID", value: lot.internalId },
    open,
    status: filled(lot.qc),
  };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

const QC_TONES: Record<string, string> = {
  good: "bg-[#E3F8EF] text-[#0E7A50]",
  warn: "bg-warning-wash text-[#8A6A0B]",
  bad: "bg-danger-wash text-[#B3261E]",
};

export function NodeSheet({ chain, node, onClose, onOpenSheet }: Props) {
  const view = describe(chain, node);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    setCopied(false);
    setNotice("");
  }, [node]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fields = view.fields.filter((f) => f.value);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="node-sheet-title">
      <button type="button" className="absolute inset-0 bg-navy/20" aria-label="Close details" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-white">
        <header className="flex items-start gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-wide text-mist">{view.kicker}</p>
            <h2 id="node-sheet-title" className="break-words text-title font-bold text-navy">
              {view.title}
            </h2>
            {view.status && (
              <span
                className={`mt-2 inline-block rounded-full px-2 py-0.5 text-caption font-medium ${
                  QC_TONES[view.status.toLowerCase()] ?? "bg-lilac text-ink"
                }`}
              >
                QC {view.status}
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-mist hover:bg-paper hover:text-navy"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <dl className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {fields.map((f) => (
            <div key={f.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 border-b border-line py-2.5 last:border-0">
              <dt className="text-caption font-medium text-mist">{f.label}</dt>
              <dd className="break-words text-body font-medium text-navy">{f.value}</dd>
            </div>
          ))}
        </dl>

        <footer className="space-y-2 border-t border-line px-6 py-4">
          {notice && <p className="text-caption text-ink">{notice}</p>}
          <div className="flex flex-nowrap items-center gap-2">
            {view.copy && (
              <button
                type="button"
                onClick={async () => setCopied(await copyText(view.copy!.value))}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-body font-medium text-navy hover:bg-paper"
              >
                {copied ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                {copied ? "Copied" : view.copy.label}
              </button>
            )}
            {view.open && (
              <button
                type="button"
                title={view.open.label}
                onClick={() => {
                  void Promise.resolve(onOpenSheet(view.open!.sheet)).then((msg) => setNotice(msg ?? ""));
                }}
                className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-action px-2.5 text-body font-medium text-white hover:bg-action-hover"
              >
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{view.open.label}</span>
              </button>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}
