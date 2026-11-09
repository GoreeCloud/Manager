import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Manager declares its existing Apache-2.0 repository license in package metadata", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.private, true, "Source license does not make the internal package publishable");
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.match(readme, /## License\s+The source code in this repository is released under the \*\*Apache License, Version 2\.0\*\*/);
});
