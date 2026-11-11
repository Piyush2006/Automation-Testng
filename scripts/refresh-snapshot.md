# Refreshing the Scispot schema snapshot

`tests/deps/scispot-snapshot.json` is the recorded state of Scispot that the
dependency guard compares against. A stale snapshot means a stale guard, so
refresh it whenever a labsheet may have changed — and always before trusting a
green `npm run test:deps`.

## How

Ask an agent connected to the Scispot MCP server to run, for each sheet in
`SHEETS` (src/config.ts):

    get_labsheet_schema(labsheet: "List of Inventory Items")
    get_labsheet_schema(labsheet: "A. Materials Manager")
    get_labsheet_schema(labsheet: "SUP. Suppliers")

Then write each result into `sheets` as `{ name, type }` pairs in position
order, copy any `references` arrays for LIST columns into `listOptions`, and set
`capturedAt` to today.

Finally:

    npm run test:deps

A failure names the column that moved and the user-visible consequence.

## Why it is not automated here

The Jazz BFF session (`sas_…`) that the app itself uses is minted inside the
Scispot iframe and cannot be obtained from a terminal. The guide names
`create_jazz_dev_session(app_id)` for exactly this, but that tool is not
installed on this MCP server. Until it is, the refresh is one agent command
rather than a CI step.

With a workspace API key available to CI, this becomes a script that fetches the
three schemas directly and rewrites the snapshot — at which point `deps:refresh`
can run on a schedule and open a PR when Scispot drifts.
