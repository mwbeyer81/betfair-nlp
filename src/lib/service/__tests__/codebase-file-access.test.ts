import { join } from "path";
import { CodebaseFileAccess } from "../codebase-file-access";

const FIXTURE_ROOT = join(__dirname, "fixtures", "codebase-file-access", "root");

describe("CodebaseFileAccess", () => {
  let access: CodebaseFileAccess;

  beforeEach(() => {
    access = new CodebaseFileAccess(FIXTURE_ROOT);
  });

  describe("constructor", () => {
    it("throws if the root directory doesn't exist", () => {
      expect(() => new CodebaseFileAccess(join(__dirname, "does-not-exist"))).toThrow(
        /Codebase snapshot not found/
      );
    });
  });

  describe("listDirectory", () => {
    it("lists the allowlisted top-level entries", () => {
      const result = access.listDirectory("");
      expect(result).toContain("src/");
      expect(result).toContain("ml/");
      expect(result).toContain("README.md");
    });

    it("hides denied top-level entries even though they physically exist", () => {
      const result = access.listDirectory("");
      expect(result).not.toContain("AGENTS.md");
      expect(result).not.toContain("config/");
    });

    it("lists entries under an allowlisted subdirectory", () => {
      const result = access.listDirectory("src/lib/dao");
      expect(result).toContain("example-dao.ts");
    });

    it("hides a denied-segment directory nested under an allowlisted one", () => {
      const result = access.listDirectory("src/lib/service");
      expect(result).toContain("example-service.ts");
      expect(result).not.toContain("__tests__/");
      expect(result).not.toContain("node_modules/");
    });

    it("returns a friendly message for a file path", () => {
      const result = access.listDirectory("README.md");
      expect(result).toMatch(/is a file, not a directory/);
    });
  });

  describe("readFile — allowlisted content", () => {
    it("reads an allowlisted file with line numbers", () => {
      const result = access.readFile("src/lib/dao/example-dao.ts");
      expect(result).toContain("1: export class ExampleDao");
    });

    it("reads a specific line range", () => {
      const result = access.readFile("src/lib/dao/example-dao.ts", 2, 2);
      expect(result).toBe("2:   findWidgetById(id: string) {");
    });

    it("reads the one specifically-allowlisted command file", () => {
      const result = access.readFile("src/commands/precompute-trainer-form.ts");
      expect(result).toContain("precomputeTrainerForm");
    });

    it("reads ml/train_and_predict.py", () => {
      const result = access.readFile("ml/train_and_predict.py");
      expect(result).toContain("def train");
    });

    it("reads README.md", () => {
      const result = access.readFile("README.md");
      expect(result).toContain("Fixture App");
    });

    it("returns a friendly message for a directory path", () => {
      const result = access.readFile("src/lib/dao");
      expect(result).toMatch(/is a directory, not a file/);
    });
  });

  describe("readFile — rejections", () => {
    it("rejects a sibling file in the same directory that isn't allowlisted", () => {
      expect(() => access.readFile("src/commands/precompute-horse-form.ts")).toThrow(
        /not in the allowlisted set/
      );
    });

    it("rejects a path under a directory that isn't allowlisted at all", () => {
      expect(() => access.readFile("src/server/router.ts")).toThrow(/not in the allowlisted set/);
    });

    it("rejects a denied top-level file", () => {
      expect(() => access.readFile("AGENTS.md")).toThrow(/not in the allowlisted set/);
    });

    it("rejects a denied top-level directory", () => {
      expect(() => access.readFile("config/secret.json")).toThrow(/not in the allowlisted set/);
    });

    it("rejects a denied-segment file nested under an allowlisted directory", () => {
      expect(() => access.readFile("src/lib/service/__tests__/hidden.ts")).toThrow(
        /not in the allowlisted set/
      );
      expect(() => access.readFile("src/lib/service/node_modules/dep.ts")).toThrow(
        /not in the allowlisted set/
      );
    });

    it("rejects an absolute path", () => {
      expect(() => access.readFile("/etc/passwd")).toThrow(/Invalid path/);
    });

    it("rejects a path containing a '..' traversal segment", () => {
      expect(() => access.readFile("src/lib/dao/../../../outside-secret.txt")).toThrow(
        /Invalid path/
      );
    });

    it("rejects a symlink that escapes the root even though it sits inside an allowlisted directory", () => {
      expect(() => access.readFile("src/lib/dao/escape-link.ts")).toThrow(
        /escapes the codebase root/
      );
    });

    it("rejects a path that doesn't exist", () => {
      expect(() => access.readFile("src/lib/dao/nonexistent.ts")).toThrow(
        /No such file or directory/
      );
    });
  });

  describe("readFile — size and line caps", () => {
    const bigFileFixture = join(__dirname, "fixtures", "codebase-file-access", "root", "src", "lib", "service", "big-file.ts");

    beforeAll(() => {
      const fs = require("fs");
      // > 30_000 bytes so the size cap kicks in.
      fs.writeFileSync(bigFileFixture, "x".repeat(31_000));
    });

    afterAll(() => {
      const fs = require("fs");
      fs.unlinkSync(bigFileFixture);
    });

    it("refuses a whole-file read over the byte cap without a line range", () => {
      const result = access.readFile("src/lib/service/big-file.ts");
      expect(result).toMatch(/over the 30000-byte read limit/);
    });

    it("allows reading a slice of an oversized file via startLine/endLine", () => {
      const result = access.readFile("src/lib/service/big-file.ts", 1, 1);
      expect(result).toContain("1: " + "x".repeat(31_000));
    });

    it("clamps a requested range past the end of the file", () => {
      const result = access.readFile("src/lib/dao/example-dao.ts", 3, 999);
      // example-dao.ts's raw content has 6 lines via split("\n") (5 lines of
      // code plus the trailing empty line from the file's final newline) —
      // requesting up to 999 should just stop at 6, i.e. lines 3-6.
      expect(result.split("\n")).toHaveLength(4);
    });

    it("reports when startLine itself is past the end of the file", () => {
      const result = access.readFile("src/lib/dao/example-dao.ts", 999, 1000);
      expect(result).toMatch(/past the end/);
    });
  });

  describe("searchCode", () => {
    it("finds a match in an allowlisted file with line number and context", () => {
      const result = access.searchCode("MARKER_LINE");
      expect(result).toContain("src/lib/service/example-service.ts:");
      expect(result).toContain("MARKER_LINE");
    });

    it("returns a no-matches message for a query with no hits", () => {
      const result = access.searchCode("ThisStringDefinitelyDoesNotExistAnywhere");
      expect(result).toMatch(/No matches/);
    });

    it("never finds a match inside a denied-segment file, even though the content is unique", () => {
      const result = access.searchCode("SECRET_TEST_MARKER");
      expect(result).toMatch(/No matches/);
    });

    it("never finds a match inside a non-allowlisted sibling file", () => {
      const result = access.searchCode("NOT_ALLOWLISTED_MARKER");
      expect(result).toMatch(/No matches/);
    });

    it("never finds a match in a directory that isn't allowlisted at all", () => {
      const result = access.searchCode("AUTH_SECRET_NEVER_EXPOSED");
      expect(result).toMatch(/No matches/);
    });

    it("rejects an empty query", () => {
      const result = access.searchCode("   ");
      expect(result).toMatch(/requires a non-empty query/);
    });

    it("caps results and notes truncation when there are more matches than the cap", () => {
      const fs = require("fs");
      const manyMatchesFixture = join(
        __dirname,
        "fixtures",
        "codebase-file-access",
        "root",
        "src",
        "lib",
        "service",
        "many-matches.ts"
      );
      const lines = Array.from({ length: 25 }, (_, i) => `const line${i} = "FIND_ME_MARKER";`);
      fs.writeFileSync(manyMatchesFixture, lines.join("\n"));

      try {
        const result = access.searchCode("FIND_ME_MARKER");
        // Count result BLOCKS (each starts with "path:lineNumber"), not raw
        // marker occurrences — since every line in the fixture matches,
        // each result's context snippet also shows neighboring matching
        // lines, so a raw substring count would over-count.
        const blockCount = (result.match(/many-matches\.ts:\d+/g) || []).length;
        expect(blockCount).toBeLessThanOrEqual(20);
        expect(result).toMatch(/more matches not shown/);
      } finally {
        fs.unlinkSync(manyMatchesFixture);
      }
    });
  });
});
