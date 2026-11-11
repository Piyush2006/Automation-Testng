import { AlertTriangle, FlaskConical, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChemicalSearch } from "@/components/ChemicalSearch";
import { CustodyGraph, CustodyGraphSkeleton, type GraphNode } from "@/components/CustodyGraph";
import { NodeSheet } from "@/components/NodeSheet";
import { SHEETS } from "@/config";
import { checkSchema, loadChain, resolveItem, type Chain, type ChemicalItem } from "@/lib/data";
import { connectScispot, errorMessage, labsheetUuid, readBootParams, type ScispotClient } from "@/lib/sdk";

const boot = readBootParams();

type Connection = { status: "connecting" } | { status: "ready"; sci: ScispotClient } | { status: "error"; message: string };

type ChainState =
  | { status: "idle" }
  | { status: "loading"; item: ChemicalItem }
  | { status: "ready"; chain: Chain }
  | { status: "error"; item: ChemicalItem; message: string }
  | { status: "notfound"; query: string };

function writeQuery(q: string) {
  try {
    window.location.hash = q ? `#/?q=${encodeURIComponent(q)}` : "#/";
  } catch {
    /* Sandboxed hosts may refuse; the deep link is a convenience. */
  }
}

export default function App() {
  const [connection, setConnection] = useState<Connection>({ status: "connecting" });
  const [schemaMissing, setSchemaMissing] = useState<string[]>([]);
  const [selected, setSelected] = useState<ChemicalItem | null>(null);
  const [chainState, setChainState] = useState<ChainState>({ status: "idle" });
  const [activeNode, setActiveNode] = useState<GraphNode | null>(null);
  const sheetUuids = useRef<Record<string, string>>({});
  const chainReq = useRef(0);
  const sci = connection.status === "ready" ? connection.sci : null;

  const select = useCallback(
    async (client: ScispotClient, item: ChemicalItem) => {
      const req = ++chainReq.current;
      setSelected(item);
      setActiveNode(null);
      setChainState({ status: "loading", item });
      writeQuery(item.id);
      try {
        const chain = await loadChain(client, item);
        if (req === chainReq.current) setChainState({ status: "ready", chain });
      } catch (e) {
        if (req === chainReq.current) setChainState({ status: "error", item, message: errorMessage(e) });
      }
    },
    [],
  );

  const connect = useCallback(async () => {
    setConnection({ status: "connecting" });
    try {
      const client = await connectScispot(boot);
      setConnection({ status: "ready", sci: client });
      void checkSchema(client).then(setSchemaMissing).catch(() => setSchemaMissing([]));
      for (const sheet of Object.values(SHEETS)) {
        if (!sheet) continue;
        void labsheetUuid(client, sheet)
          .then((uuid) => {
            if (uuid) sheetUuids.current[sheet] = uuid;
          })
          .catch(() => undefined);
      }
      if (boot.q) {
        const item = await resolveItem(client, boot.q).catch(() => null);
        if (item) void select(client, item);
        else setChainState({ status: "notfound", query: boot.q });
      }
    } catch (e) {
      setConnection({ status: "error", message: errorMessage(e) });
    }
  }, [select]);

  useEffect(() => {
    void connect();
  }, [connect]);

  const clear = () => {
    chainReq.current++;
    setSelected(null);
    setActiveNode(null);
    setChainState({ status: "idle" });
    writeQuery("");
  };

  const openSheet = async (sheet: string): Promise<string | null> => {
    if (!sheet) return "No labsheet configured for this node.";
    if (!sci?.openLabsheet) return "Opening Scispot works when the app runs inside Jazz.";
    try {
      let uuid = sheetUuids.current[sheet];
      if (!uuid) {
        uuid = (await labsheetUuid(sci, sheet)) ?? "";
        if (uuid) sheetUuids.current[sheet] = uuid;
      }
      if (!uuid) return `Could not find labsheet “${sheet}”.`;
      sci.openLabsheet(uuid, { newTab: true });
      return null;
    } catch {
      return "Opening Scispot works when the app runs inside Jazz.";
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-5xl min-w-0 items-center gap-3 px-6">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple text-white">
            <FlaskConical className="h-4 w-4" aria-hidden />
          </span>
          <p className="min-w-0 truncate text-subhead font-semibold text-navy">Chemical Chain of Custody</p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl min-w-0 px-6 py-6">
        <div className="mb-4">
          <p className="text-caption font-medium uppercase tracking-wide text-purple">Inventory</p>
          <h1 className="text-title font-bold text-navy">Find a chemical</h1>
          <p className="mt-1 text-body text-ink">
            Search by name or note to see every lot, its supplier, and the total quantity left.
          </p>
        </div>

        {schemaMissing.length > 0 && (
          <div className="mb-4 flex gap-2 rounded-xl border border-[#F1DE9C] bg-warning-wash p-3 text-body text-navy">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p className="min-w-0">
              Labsheet columns changed, so some values may be missing. Not found: {schemaMissing.join(", ")}.
            </p>
          </div>
        )}

        {connection.status === "error" ? (
          <div className="rounded-xl border border-line bg-white p-6">
            <p className="text-subhead font-semibold text-navy">Could not connect to Scispot</p>
            <p className="mt-1 text-body text-ink">{connection.message}</p>
            <button
              type="button"
              onClick={() => void connect()}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-action px-3 text-body font-medium text-white hover:bg-action-hover"
            >
              <RotateCw className="h-4 w-4" aria-hidden />
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="max-w-xl">
              <ChemicalSearch
                sci={sci}
                selected={selected}
                onSelect={(item) => sci && void select(sci, item)}
                onClear={clear}
                onSubmitTerm={(term) => (sci ? resolveItem(sci, term).catch(() => null) : Promise.resolve(null))}
              />
            </div>

            <section className="mt-6 min-w-0 rounded-xl border border-line bg-white p-6" aria-live="polite">
              {chainState.status === "idle" && (
                <div className="py-10 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-wash text-purple">
                    <FlaskConical className="h-6 w-6" aria-hidden />
                  </span>
                  <p className="mt-3 text-subhead font-semibold text-navy">Search for a chemical</p>
                  <p className="mx-auto mt-1 max-w-md text-body text-ink">
                    Pick one to see each lot, who supplied it, how much is left, and how the lots add up to the total.
                  </p>
                </div>
              )}
              {chainState.status === "loading" && <CustodyGraphSkeleton />}
              {chainState.status === "ready" && (
                <CustodyGraph chain={chainState.chain} onOpen={setActiveNode} />
              )}
              {chainState.status === "error" && (
                <div className="py-6 text-center">
                  <p className="text-subhead font-semibold text-navy">Could not load lots for {chainState.item.name}</p>
                  <p className="mt-1 text-body text-ink">{chainState.message}</p>
                  <button
                    type="button"
                    onClick={() => sci && void select(sci, chainState.item)}
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-body font-medium text-navy hover:bg-paper"
                  >
                    <RotateCw className="h-4 w-4" aria-hidden />
                    Try again
                  </button>
                </div>
              )}
              {chainState.status === "notfound" && (
                <div className="py-10 text-center">
                  <p className="text-subhead font-semibold text-navy">No chemical matches “{chainState.query}”</p>
                  <p className="mt-1 text-body text-ink">Search by name, note, or item ID.</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {activeNode && chainState.status === "ready" && (
        <NodeSheet
          chain={chainState.chain}
          node={activeNode}
          onClose={() => setActiveNode(null)}
          onOpenSheet={openSheet}
        />
      )}
    </div>
  );
}
