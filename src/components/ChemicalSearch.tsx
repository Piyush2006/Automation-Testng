import { ChevronDown, FlaskConical, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { SEARCH_DEBOUNCE_MS } from "@/config";
import { searchItems, type ChemicalItem } from "@/lib/data";
import { errorMessage, type ScispotClient } from "@/lib/sdk";

type Props = {
  sci: ScispotClient | null;
  selected: ChemicalItem | null;
  onSelect: (item: ChemicalItem) => void;
  onClear: () => void;
  /** Enter on a typed term with no highlighted option. Resolves to null when nothing matches. */
  onSubmitTerm: (term: string) => Promise<ChemicalItem | null>;
};

type LoadState = "idle" | "initial" | "refresh" | "more";

function Highlight({ text, term }: { text: string; term: string }) {
  const q = term.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-purple">{text.slice(at, at + q.length)}</span>
      {text.slice(at + q.length)}
    </>
  );
}

export function ChemicalSearch({ sci, selected, onSelect, onClear, onSubmitTerm }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<ChemicalItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [load, setLoad] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [noMatch, setNoMatch] = useState("");
  const [active, setActive] = useState(-1);
  const reqRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const statusId = useId();

  const fetchPage = useCallback(
    async (q: string, nextPage: number, mode: LoadState) => {
      if (!sci) return;
      const req = ++reqRef.current;
      setLoad(mode);
      setError("");
      try {
        const result = await searchItems(sci, q, nextPage);
        if (req !== reqRef.current) return;
        setItems((prev) => {
          if (nextPage === 1) return result.items;
          const seen = new Set(prev.map((i) => i.uuid));
          return [...prev, ...result.items.filter((i) => !seen.has(i.uuid))];
        });
        setPage(nextPage);
        setHasMore(result.hasMore);
        if (nextPage === 1) setActive(result.items.length ? 0 : -1);
      } catch (e) {
        if (req === reqRef.current) setError(errorMessage(e));
      } finally {
        if (req === reqRef.current) setLoad("idle");
      }
    },
    [sci],
  );

  const openList = () => {
    if (!sci) return;
    setOpen(true);
    setNoMatch("");
    void fetchPage(term, 1, items.length ? "refresh" : "initial");
  };

  const close = useCallback(() => {
    reqRef.current++;
    setOpen(false);
    setLoad("idle");
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void fetchPage(term, 1, items.length ? "refresh" : "initial");
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (item: ChemicalItem) => {
    close();
    setTerm("");
    onSelect(item);
  };

  const onKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const q = term.trim();
      const exact = items.find((i) => i.name.toLowerCase() === q.toLowerCase() || i.id.toLowerCase() === q.toLowerCase());
      if (exact) return pick(exact);
      if (active >= 0 && items[active]) return pick(items[active]!);
      if (!q) return;
      const resolved = await onSubmitTerm(q);
      if (resolved) pick(resolved);
      else setNoMatch(`No chemical matches "${q}".`);
    }
  };

  const onScroll = () => {
    const el = listRef.current;
    if (!el || load !== "idle" || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) void fetchPage(term, page + 1, "more");
  };

  const status =
    load === "initial"
      ? "Loading chemicals…"
      : load === "refresh"
        ? "Updating results…"
        : error
          ? error
          : noMatch || (items.length ? "" : "No matches");

  return (
    <div ref={rootRef} className={`relative w-full min-w-0 ${open ? "z-30" : "z-10"}`}>
      <div className="relative">
        <button
          type="button"
          onClick={() => (open ? close() : openList())}
          disabled={!sci}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          className="flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-white pl-3 pr-10 text-left text-body text-navy transition-colors hover:border-hair disabled:cursor-not-allowed disabled:bg-paper"
        >
          <Search className="h-4 w-4 shrink-0 text-mist" aria-hidden />
          <span className={`min-w-0 flex-1 truncate ${selected ? "font-medium" : "text-mist"}`}>
            {selected ? selected.name : sci ? "Search for a chemical" : "Connecting to Scispot…"}
          </span>
          {!selected && <ChevronDown className="h-4 w-4 shrink-0 text-mist" aria-hidden />}
        </button>
        {selected && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selected chemical"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-mist hover:bg-paper hover:text-navy"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-xl border border-line bg-white shadow-pop">
          <div className="border-b border-line p-2">
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setNoMatch("");
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-describedby={status ? statusId : undefined}
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              placeholder="Type a name, note, or item ID…"
              className="h-9 w-full rounded-md border border-line px-3 text-body text-navy outline-none placeholder:text-mist focus:border-action"
            />
            {status ? (
              <p id={statusId} className="px-1 pt-2 text-caption text-mist" aria-live="polite">
                {status}
              </p>
            ) : null}
          </div>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Chemicals"
            aria-busy={load !== "idle"}
            onScroll={onScroll}
            className="max-h-80 overflow-y-auto py-1"
          >
            {load === "initial" && !items.length
              ? Array.from({ length: 5 }, (_, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2" aria-hidden>
                    <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-line" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="h-3.5 w-2/5 animate-pulse rounded bg-line" />
                      <div className="h-3 w-3/5 animate-pulse rounded bg-line" />
                    </div>
                  </li>
                ))
              : items.map((item, index) => (
                  <li
                    key={item.uuid}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(item)}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${index === active ? "bg-purple-wash" : ""}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-wash text-purple">
                      <FlaskConical className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-navy">
                        <Highlight text={item.name} term={term} />
                      </span>
                      <span className="block truncate text-caption text-ink">
                        {[item.id, item.synonyms].filter(Boolean).join(" · ") || "\u00a0"}
                      </span>
                    </span>
                  </li>
                ))}
            {load === "more" && <li className="px-3 py-2 text-caption text-mist">Loading more…</li>}
            {load === "idle" && hasMore && items.length > 0 && (
              <li className="px-3 py-2 text-caption text-mist">Scroll for more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
