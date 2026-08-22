import { describe, expect, it, vi } from "vitest";
import { streamRows, type RowStreamPage } from "./sheet-stream";

/** A fetchPage stub that serves `pages` in order and records its calls. */
function pagedFetcher(pages: RowStreamPage[]) {
  const calls: (string | null)[] = [];
  const fetchPage = vi.fn(async (cursor: string | null) => {
    calls.push(cursor);
    const page = pages.shift();
    if (!page) throw new Error("test fetcher exhausted");
    return page;
  });
  return { fetchPage, calls };
}

describe("streamRows", () => {
  it("single chunk: one cursor-less fetch, one progress call, rows returned", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const { fetchPage, calls } = pagedFetcher([{ data: rows, nextCursor: null, total: 2 }]);
    const onChunk = vi.fn();

    const out = await streamRows(fetchPage, onChunk);

    expect(out).toEqual(rows);
    expect(calls).toEqual([null]);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith(rows, 2, 2);
  });

  it("multi chunk: follows nextCursor until null and accumulates in arrival order", async () => {
    const { fetchPage, calls } = pagedFetcher([
      { data: [1, 2], nextCursor: "c1", total: 5 },
      { data: [3, 4], nextCursor: "c2" },
      { data: [5], nextCursor: null },
    ]);
    const onChunk = vi.fn();

    const out = await streamRows(fetchPage, onChunk);

    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual([null, "c1", "c2"]);
    expect(onChunk).toHaveBeenCalledTimes(3);
  });

  it("progress: loaded is cumulative and total from the FIRST response is echoed on every chunk", async () => {
    const { fetchPage } = pagedFetcher([
      { data: [1, 2], nextCursor: "c1", total: 5 },
      // A total on a cursored response is out of contract — it must be ignored.
      { data: [3, 4], nextCursor: "c2", total: 999 },
      { data: [5], nextCursor: null },
    ]);
    const seen: [number, number | null][] = [];

    await streamRows(fetchPage, (_rows, loaded, total) => seen.push([loaded, total]));

    expect(seen).toEqual([[2, 5], [4, 5], [5, 5]]);
  });

  it("progress: total reports null when the first response carried none", async () => {
    const { fetchPage } = pagedFetcher([{ data: [1], nextCursor: null }]);
    const seen: (number | null)[] = [];

    await streamRows(fetchPage, (_rows, _loaded, total) => seen.push(total));

    expect(seen).toEqual([null]);
  });

  it("zero rows: resolves empty and still reports one progress call", async () => {
    const { fetchPage } = pagedFetcher([{ data: [], nextCursor: null, total: 0 }]);
    const onChunk = vi.fn();

    await expect(streamRows(fetchPage, onChunk)).resolves.toEqual([]);
    expect(onChunk).toHaveBeenCalledWith([], 0, 0);
  });

  it("throws when the server repeats the cursor it was just asked for", async () => {
    const { fetchPage } = pagedFetcher([
      { data: [1], nextCursor: "loop" },
      { data: [2], nextCursor: "loop" }, // same string twice in a row
    ]);

    await expect(streamRows(fetchPage, vi.fn())).rejects.toThrow(/repeated a cursor/);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("throws on a cursor cycle even with other cursors in between (A -> B -> A)", async () => {
    const { fetchPage } = pagedFetcher([
      { data: [1], nextCursor: "A" },
      { data: [2], nextCursor: "B" },
      { data: [3], nextCursor: "A" },
    ]);

    await expect(streamRows(fetchPage, vi.fn())).rejects.toThrow(/repeated a cursor/);
  });

  it("throws on an empty chunk that still claims a nextCursor (no forward progress)", async () => {
    const { fetchPage } = pagedFetcher([
      { data: [1], nextCursor: "c1" },
      { data: [], nextCursor: "c2" },
    ]);

    await expect(streamRows(fetchPage, vi.fn())).rejects.toThrow(/no forward progress/);
  });

  it("throws on a malformed page whose data is not an array", async () => {
    const fetchPage = async () => ({ data: "nope" } as unknown as RowStreamPage);

    await expect(streamRows(fetchPage, vi.fn())).rejects.toThrow(/not an array/);
  });

  it("propagates a fetch error untouched, after earlier chunks were reported", async () => {
    const boom = new Error("HTTP 500");
    const onChunk = vi.fn();
    const fetchPage = vi.fn(async (cursor: string | null) => {
      if (cursor === null) return { data: [1, 2], nextCursor: "c1" };
      throw boom;
    });

    await expect(streamRows(fetchPage, onChunk)).rejects.toBe(boom);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith([1, 2], 2, null);
  });
});
