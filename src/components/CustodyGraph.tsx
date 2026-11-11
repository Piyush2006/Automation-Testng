import { Building2, CircleCheck, FlaskConical, Package } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { filled, type Chain, type Lot } from "@/lib/data";
import { formatAmount, formatTotals, type Amount } from "@/lib/quantity";

export type GraphNode = { kind: "item" } | { kind: "lot"; lot: Lot } | { kind: "vendor"; lot: Lot };

const TREE_MAX_LOTS = 3;
const TREE_MIN_WIDTH = 640;
const BRANCH_MAX_REM = 19;

const TONES = {
  item: { wash: "bg-purple-wash", icon: "text-purple", Icon: FlaskConical },
  lot: { wash: "bg-lot-wash", icon: "text-lot", Icon: Package },
  vendor: { wash: "bg-vendor-wash", icon: "text-vendor", Icon: Building2 },
} as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function NodeCard({
  tone,
  kicker,
  title,
  children,
  onClick,
}: {
  tone: keyof typeof TONES;
  kicker: string;
  title: string;
  children?: ReactNode;
  onClick: () => void;
}) {
  const { wash, icon, Icon } = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-white p-4 text-left transition-colors hover:border-purple-soft"
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${wash} ${icon}`}>
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-caption font-medium uppercase tracking-wide text-mist">{kicker}</span>
        <span className="line-clamp-2 break-words text-subhead font-bold text-navy" title={title}>
          {title}
        </span>
        {children && <span className="mt-0.5 block text-body text-ink">{children}</span>}
      </span>
    </button>
  );
}

function ItemNode({ chain, onOpen }: { chain: Chain; onOpen: (n: GraphNode) => void }) {
  return (
    <NodeCard tone="item" kicker="Inventory item" title={chain.item.name} onClick={() => onOpen({ kind: "item" })}>
      Total quantity left:{" "}
      {chain.totals.length ? (
        <strong className="font-bold text-navy">{formatTotals(chain.totals)}</strong>
      ) : (
        <span className="text-mist">not recorded</span>
      )}
    </NodeCard>
  );
}

export function lotTitle(lot: Lot): { kicker: string; title: string } {
  const lotNumber = filled(lot.lotNumber);
  return lotNumber ? { kicker: "Lot no.", title: lotNumber } : { kicker: "Inventory row", title: lot.internalId };
}

function LotNode({ lot, onOpen }: { lot: Lot; onOpen: (n: GraphNode) => void }) {
  const { kicker, title } = lotTitle(lot);
  return (
    <NodeCard tone="lot" kicker={kicker} title={title} onClick={() => onOpen({ kind: "lot", lot })}>
      Quantity left:{" "}
      {lot.quantity.left ? (
        <strong className="font-bold text-navy">{formatAmount(lot.quantity.left)}</strong>
      ) : (
        <span className="text-mist">not recorded</span>
      )}
      {!lot.linked && (
        <span className="mt-1.5 block w-fit rounded-full bg-warning-wash px-2 py-0.5 text-caption font-medium text-[#8A6A0B]">
          Matched by name
        </span>
      )}
    </NodeCard>
  );
}

function hasVendor(lot: Lot): boolean {
  return Boolean(filled(lot.manufacturer) || filled(lot.catalog));
}

function VendorNode({ lot, onOpen }: { lot: Lot; onOpen: (n: GraphNode) => void }) {
  const manufacturer = filled(lot.manufacturer);
  const catalog = filled(lot.catalog);
  return (
    <NodeCard
      tone="vendor"
      kicker="Vendor"
      title={manufacturer || `Catalog ${catalog}`}
      onClick={() => onOpen({ kind: "vendor", lot })}
    >
      {manufacturer && catalog ? `Catalog: ${catalog}` : null}
    </NodeCard>
  );
}

const V = ({ className = "h-6" }: { className?: string }) => (
  <div className={`mx-auto w-px bg-hair ${className}`} aria-hidden />
);

function TreeLayout({ chain, onOpen }: { chain: Chain; onOpen: (n: GraphNode) => void }) {
  const k = chain.lots.length;
  return (
    <div>
      <div className="mx-auto w-full max-w-sm">
        <ItemNode chain={chain} onOpen={onOpen} />
      </div>
      <V />
      <div
        className="relative mx-auto grid"
        style={{ gridTemplateColumns: `repeat(${k}, minmax(0, 1fr))`, maxWidth: `${k * BRANCH_MAX_REM}rem` }}
      >
        {k > 1 && (
          <div
            className="absolute top-0 h-px bg-hair"
            style={{ left: `${50 / k}%`, right: `${50 / k}%` }}
            aria-hidden
          />
        )}
        {chain.lots.map((lot) => (
          <div key={lot.uuid} className="min-w-0 px-2">
            <V />
            <LotNode lot={lot} onOpen={onOpen} />
            {hasVendor(lot) && (
              <>
                <V className="h-8" />
                <VendorNode lot={lot} onOpen={onOpen} />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListLayout({ chain, onOpen }: { chain: Chain; onOpen: (n: GraphNode) => void }) {
  return (
    <div>
      <ItemNode chain={chain} onOpen={onOpen} />
      <ol className="mt-3 pl-8">
        {chain.lots.map((lot, i) => {
          const last = i === chain.lots.length - 1;
          return (
            <li key={lot.uuid} className={`relative ${last ? "" : "pb-3"}`}>
              <span
                className="absolute -left-5 -top-3 w-px bg-hair"
                style={{ height: last ? "calc(2.5rem + 0.75rem)" : "calc(100% + 0.75rem)" }}
                aria-hidden
              />
              <span className="absolute -left-5 top-10 h-px w-5 bg-hair" aria-hidden />
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <LotNode lot={lot} onOpen={onOpen} />
                {hasVendor(lot) && <VendorNode lot={lot} onOpen={onOpen} />}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function sameUnit(a: Amount, b: Amount) {
  return a.family === b.family && a.unit === b.unit;
}

function ReconcileBanner({ chain }: { chain: Chain }) {
  if (!chain.totals.length) return null;
  const several = chain.lots.filter((l) => l.quantity.left).length > 1;
  const unlinked = chain.lots.filter((l) => !l.linked);
  return (
    <div className="mx-auto mt-6 flex max-w-2xl gap-3 rounded-xl border border-[#E2D9F7] bg-purple-wash p-4">
      <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-purple" aria-hidden />
      <div className="min-w-0 border-l border-[#D6CBF3] pl-3">
        <p className="text-body font-semibold text-navy">
          {several ? "Lot quantities reconcile to inventory total" : "Lot quantity is the inventory total"}
        </p>
        {chain.totals.map((total) => {
          const terms = chain.lots
            .map((l) => l.quantity.left)
            .filter((a): a is Amount => Boolean(a && sameUnit(a, total)));
          return (
            <p key={`${total.family}:${total.unit}`} className="text-body text-navy">
              {terms.map(formatAmount).join(" + ")} = <strong className="font-bold">{formatAmount(total)}</strong>
            </p>
          );
        })}
        {chain.unmeasured.length > 0 && (
          <p className="mt-1 text-caption text-ink">
            Not counted (no amount in Unit): {chain.unmeasured.map((l) => l.internalId).join(", ")}
          </p>
        )}
        {unlinked.length > 0 && (
          <p className="mt-1 text-caption text-ink">
            Matched by name, not linked yet: {unlinked.map((l) => l.internalId).join(", ")}. Set Chemical Item on
            those inventory rows to link them.
          </p>
        )}
      </div>
    </div>
  );
}

export function CustodyGraph({ chain, onOpen }: { chain: Chain; onOpen: (n: GraphNode) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tree = chain.lots.length <= TREE_MAX_LOTS && (width === 0 || width >= TREE_MIN_WIDTH);
  return (
    <div ref={ref} className="min-w-0">
      {chain.lots.length === 0 ? (
        <>
          <div className="mx-auto w-full max-w-sm">
            <ItemNode chain={chain} onOpen={onOpen} />
          </div>
          <p className="mx-auto mt-6 max-w-md text-center text-body text-ink">
            No Materials Manager rows match this item name yet
            to add lots here.
          </p>
        </>
      ) : tree ? (
        <TreeLayout chain={chain} onOpen={onOpen} />
      ) : (
        <ListLayout chain={chain} onOpen={onOpen} />
      )}
      <ReconcileBanner chain={chain} />
    </div>
  );
}

export function CustodyGraphSkeleton() {
  const Block = () => (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4">
      <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-line" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3 w-1/3 animate-pulse rounded bg-line" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-line" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-line" />
      </div>
    </div>
  );
  return (
    <div aria-busy="true" aria-label="Loading chain of custody">
      <div className="mx-auto w-full max-w-sm">
        <Block />
      </div>
      <V />
      <div className="relative mx-auto grid max-w-[38rem] grid-cols-2">
        <div className="absolute left-1/4 right-1/4 top-0 h-px bg-hair" aria-hidden />
        {[0, 1].map((i) => (
          <div key={i} className="min-w-0 px-2">
            <V />
            <Block />
            <V className="h-8" />
            <Block />
          </div>
        ))}
      </div>
      <div className="mx-auto mt-6 h-[76px] max-w-2xl animate-pulse rounded-xl bg-purple-wash" />
    </div>
  );
}
