import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { join, relative, resolve, sep } from "path";

// The three tools the chat agent gets: enumerate, search, and read. All
// read-only, all scoped to an explicit allowlist under the codebase
// snapshot (see scripts/build-codebase-snapshot.sh) — never the live repo,
// never anything outside this directory.

const ALLOWED_PATHS = [
  "src/lib/dao",
  "src/lib/service",
  "src/commands/precompute-trainer-form.ts",
  "ml/train_and_predict.py",
  "README.md",
];

// Checked even though nothing in ALLOWED_PATHS should ever overlap these —
// defense in depth if the allowlist is ever widened carelessly later.
const DENIED_PATHS = ["AGENTS.md", "config", ".git", ".env", "node_modules"];

// Same idea, but matched as a path SEGMENT anywhere in the path (not just a
// prefix from the root) — catches e.g. "src/lib/service/__tests__" even
// though "src/lib/service" itself is allowlisted as a whole directory. The
// primary control is scripts/build-codebase-snapshot.sh simply never
// copying these; this is the second line of defense.
const DENIED_SEGMENTS = ["__tests__", "node_modules", ".git"];

const MAX_FILE_BYTES = 30_000;
const MAX_LINES_RETURNED = 800;
const MAX_SEARCH_RESULTS = 20;
const MAX_SEARCH_CONTEXT_LINES = 2;

function normalize(relPath: string): string {
  return relPath.split(sep).join("/");
}

function isAllowlisted(relPath: string): boolean {
  const normalized = normalize(relPath);
  if (DENIED_PATHS.some(d => normalized === d || normalized.startsWith(`${d}/`))) {
    return false;
  }
  const segments = normalized.split("/");
  if (segments.some(s => DENIED_SEGMENTS.includes(s))) {
    return false;
  }
  return ALLOWED_PATHS.some(a => normalized === a || normalized.startsWith(`${a}/`));
}

export class CodebaseFileAccess {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(__dirname, "codebase-snapshot");
    if (!existsSync(this.root)) {
      throw new Error(
        `Codebase snapshot not found at ${this.root} — run scripts/build-codebase-snapshot.sh`
      );
    }
  }

  /**
   * Resolves a caller-supplied relative path against the root, rejecting
   * anything that escapes it (including via a symlink) or isn't allowlisted.
   * Throws on any violation — callers (the tool loop) catch and turn this
   * into tool-content text rather than letting it propagate as a crash.
   */
  private resolveAndValidate(requestedPath: string): { real: string; rel: string } {
    const cleaned = requestedPath.trim();
    if (cleaned === "") {
      return { real: realpathSync(this.root), rel: "" };
    }
    if (cleaned.startsWith("/") || cleaned.split(/[\\/]/).includes("..")) {
      throw new Error(`Invalid path: "${requestedPath}"`);
    }

    const candidate = resolve(this.root, cleaned);
    if (!existsSync(candidate)) {
      throw new Error(`No such file or directory: "${requestedPath}"`);
    }

    // realpath dereferences symlinks — a symlink under an allowlisted dir
    // that points outside the root must still be caught here, not just a
    // lexical ".." check on the input string.
    const real = realpathSync(candidate);
    const realRoot = realpathSync(this.root);
    const rel = relative(realRoot, real);

    if (rel.startsWith("..") || resolve(realRoot, rel) !== real) {
      throw new Error(`Path escapes the codebase root: "${requestedPath}"`);
    }
    if (!isAllowlisted(rel)) {
      throw new Error(`Path is not in the allowlisted set: "${requestedPath}"`);
    }

    return { real, rel };
  }

  listDirectory(path: string): string {
    const { real, rel } = this.resolveAndValidate(path);
    const stat = statSync(real);
    if (!stat.isDirectory()) {
      return `"${path}" is a file, not a directory. Use read_file instead.`;
    }

    const entries = readdirSync(real, { withFileTypes: true })
      .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .filter(name => {
        const childRel = rel ? `${rel}/${name.replace(/\/$/, "")}` : name.replace(/\/$/, "");
        // A denied path/segment could in principle sit inside an
        // allowlisted directory (e.g. if the allowlist is ever widened) —
        // filter it out of listings too, not just direct reads.
        const normalized = normalize(childRel);
        if (DENIED_PATHS.some(d => normalized === d || normalized.startsWith(`${d}/`))) return false;
        if (normalized.split("/").some(s => DENIED_SEGMENTS.includes(s))) return false;
        return true;
      })
      .sort();

    if (entries.length === 0) {
      return `(empty directory: "${path || "."}")`;
    }
    return entries.join("\n");
  }

  readFile(path: string, startLine?: number, endLine?: number): string {
    const { real } = this.resolveAndValidate(path);
    const stat = statSync(real);
    if (stat.isDirectory()) {
      return `"${path}" is a directory, not a file. Use list_directory instead.`;
    }
    if (stat.size > MAX_FILE_BYTES && startLine === undefined && endLine === undefined) {
      return `File is ${stat.size} bytes, over the ${MAX_FILE_BYTES}-byte read limit. Re-request with startLine/endLine to read a slice.`;
    }

    const lines = readFileSync(real, "utf-8").split("\n");
    const from = Math.max(1, startLine ?? 1);
    const to = Math.min(lines.length, endLine ?? lines.length, from + MAX_LINES_RETURNED - 1);
    if (from > lines.length) {
      return `File only has ${lines.length} lines; startLine ${from} is past the end.`;
    }

    return lines
      .slice(from - 1, to)
      .map((line, i) => `${from + i}: ${line}`)
      .join("\n");
  }

  searchCode(query: string): string {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return "search_code requires a non-empty query.";
    }

    const results: string[] = [];

    const walk = (dirReal: string, dirRel: string) => {
      if (results.length >= MAX_SEARCH_RESULTS) return;
      for (const entry of readdirSync(dirReal, { withFileTypes: true })) {
        const entryRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        if (!isAllowlisted(entryRel) && !ALLOWED_PATHS.some(a => a.startsWith(entryRel))) {
          continue;
        }
        const entryReal = join(dirReal, entry.name);
        if (entry.isDirectory()) {
          walk(entryReal, entryRel);
        } else if (isAllowlisted(entryRel)) {
          searchFile(entryReal, entryRel);
        }
        if (results.length >= MAX_SEARCH_RESULTS) return;
      }
    };

    const searchFile = (fileReal: string, fileRel: string) => {
      let content: string;
      try {
        content = readFileSync(fileReal, "utf-8");
      } catch {
        return; // not a text file / unreadable — skip silently
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && results.length < MAX_SEARCH_RESULTS; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        const from = Math.max(0, i - MAX_SEARCH_CONTEXT_LINES);
        const to = Math.min(lines.length - 1, i + MAX_SEARCH_CONTEXT_LINES);
        const snippet = lines
          .slice(from, to + 1)
          .map((l, j) => `${from + j + 1}: ${l}`)
          .join("\n");
        results.push(`${fileRel}:${i + 1}\n${snippet}`);
      }
    };

    walk(realpathSync(this.root), "");

    if (results.length === 0) {
      return `No matches for "${query}".`;
    }
    // results.length hitting the cap is treated as "possibly truncated" —
    // simpler and cheaper than tracking an exact count of every match ever
    // seen across every file, at the cost of an occasional false-positive
    // note when a search happens to have exactly MAX_SEARCH_RESULTS matches
    // and no more.
    const truncated = results.length >= MAX_SEARCH_RESULTS;
    return (
      results.join("\n\n") +
      (truncated ? `\n\n(more matches not shown — narrow your query)` : "")
    );
  }
}
