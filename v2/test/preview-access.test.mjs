import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PREVIEW_READING_FLAG, previewReadingEnabled } from "../lib/preview-access.ts";

test("a deployment that says nothing does not serve the private reading surface", () => {
  assert.equal(previewReadingEnabled({}), false);
  assert.equal(previewReadingEnabled({ [PREVIEW_READING_FLAG]: undefined }), false);
});

test("only an explicitly affirmative value opens it", () => {
  for (const value of ["1", "true", "TRUE", "on", "yes", " true "]) {
    assert.equal(previewReadingEnabled({ [PREVIEW_READING_FLAG]: value }), true, value);
  }
});

test("anything else reads as closed, including the shapes a typo takes", () => {
  for (const value of ["", " ", "0", "false", "FALSE", "off", "no", "ture", "enabled", "null", "undefined"]) {
    assert.equal(previewReadingEnabled({ [PREVIEW_READING_FLAG]: value }), false, JSON.stringify(value));
  }
});

test("both preview routes gate after renderOnDemand and before the archive read", () => {
  // Order is the whole behaviour here, and both ends of it can break silently.
  //
  // Gate before renderOnDemand(): the build prerenders the route, evaluates the gate at build time
  // where the flag is unset, and freezes a 404 into static HTML — the switch then does nothing at
  // runtime. That happened; it showed up only as `/preview` changing from ƒ to ○ in the build
  // output, and no test caught it.
  //
  // Gate after the archive read: a request to a surface this deployment does not serve still costs
  // it a database read.
  for (const file of ["app/preview/page.tsx", "app/preview/[year]/page.tsx"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /previewReadingEnabled\(\)\) notFound\(\)/, `${file} has no gate`);
    const onDemand = source.indexOf("await renderOnDemand()");
    const gate = source.indexOf("previewReadingEnabled()) notFound()");
    const read = source.indexOf("loadFamilyArchiveOnDemand()", gate);
    assert.ok(onDemand > -1 && gate > -1 && read > -1, `${file} is missing one of the three calls`);
    assert.ok(onDemand < gate, `${file} gates before renderOnDemand() — the build will freeze a 404`);
    assert.ok(gate < read, `${file} reads the archive before checking the gate`);
  }
});
