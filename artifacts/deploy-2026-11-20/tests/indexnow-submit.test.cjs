"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const selection = import("../netlify/functions/lib/indexnow-selection.mjs");

const urls = {
  a: "https://aeogeosearch.com/a/",
  b: "https://aeogeosearch.com/b/",
  c: "https://aeogeosearch.com/c/",
};

test("selects every entry when there is no ledger yet", async () => {
  const { selectChangedEntries } = await selection;
  const entries = [
    { loc: urls.a, lastmod: "2026-11-01" },
    { loc: urls.b, lastmod: "" },
  ];

  assert.deepEqual(
    selectChangedEntries(entries, {}).map((entry) => entry.loc),
    [urls.a, urls.b],
  );
});

test("skips entries whose lastmod matches the submitted ledger", async () => {
  const { selectChangedEntries } = await selection;
  const entries = [
    { loc: urls.a, lastmod: "2026-11-01" },
    { loc: urls.b, lastmod: "2026-11-02" },
  ];

  assert.deepEqual(
    selectChangedEntries(entries, {
      [urls.a]: "2026-11-01",
      [urls.b]: "2026-11-02",
    }),
    [],
  );
});

test("selects an edited page even when its lastmod is older than today", async () => {
  const { selectChangedEntries } = await selection;
  const entries = [
    { loc: urls.a, lastmod: "2025-01-01" },
    { loc: urls.b, lastmod: "2026-11-02" },
  ];

  assert.deepEqual(
    selectChangedEntries(entries, {
      [urls.a]: "2024-12-31",
      [urls.b]: "2026-11-02",
    }).map((entry) => entry.loc),
    [urls.a],
  );
});

test("selects new URLs and URLs with a removed lastmod", async () => {
  const { selectChangedEntries } = await selection;
  const entries = [
    { loc: urls.a, lastmod: "2026-11-01" },
    { loc: urls.b, lastmod: "" },
    { loc: urls.c, lastmod: "2026-11-03" },
  ];

  assert.deepEqual(
    selectChangedEntries(entries, {
      [urls.a]: "2026-11-01",
      [urls.b]: "2026-11-02",
    }).map((entry) => entry.loc),
    [urls.b, urls.c],
  );
});

test("records only the submitted URLs and preserves the rest of the ledger", async () => {
  const { mergeSubmitted } = await selection;
  const entries = [
    { loc: urls.a, lastmod: "2026-11-01" },
    { loc: urls.b, lastmod: "2026-11-02" },
    { loc: urls.c, lastmod: "2026-11-03" },
  ];

  const next = mergeSubmitted(
    entries,
    {
      [urls.a]: "2026-10-01",
      [urls.c]: "2026-11-03",
    },
    new Set([urls.b]),
  );

  assert.deepEqual(next, {
    [urls.a]: "2026-10-01",
    [urls.b]: "2026-11-02",
    [urls.c]: "2026-11-03",
  });
});

test("normalizes URL keys so selection and recording agree", async () => {
  const { selectChangedEntries, mergeSubmitted } = await selection;
  const entry = { loc: "https://AEOGEOSEARCH.com/a/", lastmod: "2026-11-01" };
  const key = new URL(entry.loc).href;

  assert.deepEqual(selectChangedEntries([entry], { [key]: "2026-11-01" }), []);
  assert.deepEqual(mergeSubmitted([entry], {}, new Set([key])), {
    [key]: "2026-11-01",
  });
});
