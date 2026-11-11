/**
 * Stand-in for the Scispot Jazz BFF SDK, served to the browser in place of
 * https://eks.scispot.io/.../jazz-app-bff-v1.js
 *
 * The app loads this exactly where it loads the real SDK and calls
 * window.Scispot.connect() exactly as in production, so no token, no login
 * and no network are needed. The fixture is injected before this runs, as
 * window.__SCISPOT_FIXTURE__ (see stub.ts).
 *
 * It mirrors the real API's rules, not a convenient version of them:
 *   - `Contains` on an ID_BARCODE column is rejected, as Scispot rejects it.
 *   - page/pageSize slicing and `total` behave as the BFF does.
 * A stand-in that is more forgiving than the real thing produces tests that
 * pass and prove nothing.
 */
(function () {
  function record(kind, payload) {
    window.__CALLS__ = window.__CALLS__ || { list: [], schema: [], rows: [], search: [] };
    window.__CALLS__[kind].push(payload);
  }

  function fixture() {
    return window.__SCISPOT_FIXTURE__ || { sheets: {} };
  }

  function sheetOf(name) {
    var s = fixture().sheets[name];
    if (!s) throw new Error('Labsheet "' + name + '" was not found.');
    return s;
  }

  function headersOf(sheet) {
    return sheet.columns.map(function (c) { return c.name; });
  }

  function typeOf(sheet, column) {
    for (var i = 0; i < sheet.columns.length; i++) {
      if (sheet.columns[i].name === column) return sheet.columns[i].type;
    }
    return undefined;
  }

  /** Row objects -> the wire shape: headers[0] is "uuid". */
  function toPage(sheet, rows, total, name) {
    var headers = headersOf(sheet);
    return {
      headers: ["uuid"].concat(headers),
      rows: rows.map(function (r, i) {
        return [r.__uuid || name + "-row-" + i].concat(
          headers.map(function (h) { return r[h] === undefined ? "" : r[h]; }),
        );
      }),
      total: total,
    };
  }

  function text(v) {
    return v === undefined || v === null ? "" : String(v);
  }

  function matches(sheet, row, filter) {
    var value = text(row[filter.column]);
    var want = text(filter.value);
    var op = filter.operator;

    if (op === "Contains" || op === "Does_Not_Contain") {
      // Scispot refuses substring operators on a barcode/ID column.
      if (typeOf(sheet, filter.column) === "ID_BARCODE") {
        throw new Error('Operator "Contains" is not supported for column type ID_BARCODE.');
      }
      var hit = value.toLowerCase().indexOf(want.toLowerCase()) !== -1;
      return op === "Contains" ? hit : !hit;
    }
    // NOTE: case-sensitivity of Equals on a TEXT column is one of the six
    // checks that still need a live session. Treated as insensitive here,
    // which is what the app's own re-check at data.ts:145 assumes.
    if (op === "Equals") return value.toLowerCase() === want.toLowerCase();
    if (op === "Not_Equals") return value.toLowerCase() !== want.toLowerCase();
    if (op === "Empty") return value === "";
    throw new Error('Unsupported operator "' + op + '".');
  }

  function slice(rows, page, pageSize) {
    var p = page || 1;
    var size = pageSize || 25;
    return rows.slice((p - 1) * size, p * size);
  }

  window.Scispot = {
    connect: function (opts) {
      var fx = fixture();
      window.__SCISPOT_CONNECT__ = opts || {};

      if (fx.failConnect) {
        return Promise.reject(new Error(fx.failConnect));
      }

      var client = {
        labsheets: {
          list: function (o) {
            record("list", o || {});
            var search = (o && o.search) || "";
            var all = Object.keys(fx.sheets).map(function (n) {
              return { uuid: "uuid-" + n.replace(/\W+/g, "-").toLowerCase(), name: fx.sheets[n].nameAs || n };
            });
            var hits = all.filter(function (ls) {
              return !search || ls.name.toLowerCase().indexOf(search.toLowerCase()) !== -1;
            });
            return Promise.resolve({ labsheets: hits });
          },

          schema: function (name) {
            record("schema", { sheet: name });
            try {
              var sheet = sheetOf(name);
              return Promise.resolve({ columns: sheet.columns.slice() });
            } catch (e) {
              return Promise.reject(e);
            }
          },

          rows: function (name, o) {
            record("rows", { sheet: name, page: o.page, pageSize: o.pageSize });
            try {
              var sheet = sheetOf(name);
              if (fx.failSheet === name) throw new Error(fx.failMessage || "Scispot request failed.");
              var all = sheet.rows;
              return Promise.resolve(toPage(sheet, slice(all, o.page, o.pageSize), all.length, name));
            } catch (e) {
              return Promise.reject(e);
            }
          },

          search: function (name, o) {
            record("search", { sheet: name, filters: o.filters, match: o.match, page: o.page, pageSize: o.pageSize });
            try {
              var sheet = sheetOf(name);
              if (fx.failSheet === name) throw new Error(fx.failMessage || "Scispot request failed.");
              var filters = (o && o.filters) || [];
              var match = (o && o.match) || "all";
              var hits = sheet.rows.filter(function (row) {
                if (!filters.length) return true;
                var results = filters.map(function (f) { return matches(sheet, row, f); });
                return match === "any"
                  ? results.some(Boolean)
                  : results.every(Boolean);
              });
              return Promise.resolve(toPage(sheet, slice(hits, o.page, o.pageSize), hits.length, name));
            } catch (e) {
              return Promise.reject(e);
            }
          },
        },
      };

      if (!fx.omitOpenLabsheet) {
        client.openLabsheet = function (uuid, o) {
          window.__OPENED__ = window.__OPENED__ || [];
          window.__OPENED__.push({ uuid: uuid, newTab: !!(o && o.newTab) });
        };
      }

      return Promise.resolve(client);
    },
  };
})();
