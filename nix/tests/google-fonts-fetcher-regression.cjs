// Replay captured HTTP bytes through the real fetcher, without network access.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { gunzipSync } = require("node:zlib");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../bulwark-google-fonts-fetcher.js"), "utf8");
const fixture = JSON.parse(gunzipSync(fs.readFileSync(
  path.join(__dirname, "fixtures/google-fonts.json.gz"),
)));
const expectedHash = "sha256-2sicALM/j6JHVFMcO4akQHhrxlyvdlGTpVbE1u/B6gI=";
const failedHash = "sha256-mLSXAXmS7edvfmVwluyUd6N7Sk9DwqktaAUESwSxWlc=";
const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";

// Each bit selects Google's C4 variant for one of the seven latin-ext blocks.
function cssVariant(mask) {
  let index = 0;
  return Object.fromEntries(Object.entries(fixture.css).map(([url, css]) => [
    url, css.replaceAll("U+20AD-20C0", () =>
      mask & (1 << index++) ? "U+20AD-20C4" : "U+20AD-20C0"),
  ]));
}

async function replay({ css = fixture.css, mutateFont = false, script = source } = {}) {
  const files = new Map();
  const requests = [];
  const responses = new Map(Object.entries(css).map(([url, value]) => [url, Buffer.from(value)]));
  fixture.fonts.forEach((font, index) => {
    const data = Buffer.from(font.base64, "base64");
    if (mutateFont && index === 0) data[data.length - 1] ^= 1;
    responses.set(font.url, data);
  });
  const context = {
    Buffer,
    console: { error(error) { throw error; } },
    process: {
      env: { OUT_DIR: "/fixture-output" },
      stderr: { write() {} },
      exit(code) { throw new Error(`fetcher exited ${code}`); },
    },
    require(name) {
      if (name === "fs") return {
        mkdirSync() {},
        writeFileSync(filename, bytes) {
          files.set(path.relative("/fixture-output", filename), Buffer.from(bytes));
        },
      };
      if (name === "path") return path;
      assert.equal(name, "child_process", "unexpected dependency");
      return {
        execFileSync(command, args) {
          assert.equal(command, "curl");
          assert.deepEqual(Array.from(args.slice(0, 5)), ["-sS", "-L", "--fail", "-A", userAgent]);
          const url = args[5];
          assert.equal(args.length, 6);
          assert.ok(responses.has(url), `unreviewed URL: ${url}`);
          requests.push(url);
          return responses.get(url);
        },
      };
    },
  };
  await vm.runInNewContext(script, context, { filename: "bulwark-google-fonts-fetcher.js", timeout: 5000 });
  assert.equal(requests.length, 25, "four CSS fetches and 21 unique font fetches");
  assert.equal(files.size, 22);
  return files;
}

function recursiveHash(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bulwark-font-test-"));
  try {
    for (const [name, bytes] of files) {
      const filename = path.join(directory, name);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, bytes);
    }
    // The same recursive NAR hash enforced by the fixed-output derivation.
    return execFileSync("nix", ["hash", "path", "--sri", directory], { encoding: "utf8" }).trim();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("captured original responses reproduce the unchanged recursive integrity hash", async () => {
  assert.equal(recursiveHash(await replay()), expectedHash);
});

test("all 128 observed CSS variants reproduce identical CSS and font bytes", async () => {
  const baseline = await replay();
  assert.equal(Object.values(fixture.css).join("").match(/U\+20AD-20C0/g).length, 7);
  for (let mask = 0; mask < 128; mask++) {
    assert.deepEqual(await replay({ css: cssVariant(mask) }), baseline, `range mask ${mask}`);
  }
});

test("the failed CI response is restored to the original hash", async () => {
  // Geist and all four Atkinson Hyperlegible blocks had C4; Mono and Serif had C0.
  const css = cssVariant(0b1111001);
  assert.equal(recursiveHash(await replay({ css })), expectedHash);
  // A negative control reproduces the actual CI hash without normalization.
  const original = source.replace('.replaceAll("U+20AD-20C4", "U+20AD-20C0")', "");
  assert.notEqual(original, source);
  assert.equal(recursiveHash(await replay({ css, script: original })), failedHash);
});

test("a changed font binary is rejected by the original integrity hash", async () => {
  assert.notEqual(recursiveHash(await replay({ css: cssVariant(127), mutateFont: true })), expectedHash);
});

test("unreviewed CSS changes remain rejected by the original integrity hash", async () => {
  const css = Object.fromEntries(Object.entries(fixture.css).map(([url, value]) => [
    url, value.replaceAll("U+20AD-20C0", "U+20AD-20C5"),
  ]));
  assert.notEqual(recursiveHash(await replay({ css })), expectedHash);
});

test("all four Next.js mock keys resolve the 21 unmodified local font binaries", async () => {
  const files = await replay({ css: cssVariant(127) });
  const module = { exports: {} };
  vm.runInNewContext(files.get("mock-responses.js").toString(), {
    module, __dirname: "/fixture-output",
  });
  assert.deepEqual(Object.keys(module.exports), Object.keys(fixture.css));
  const paths = Object.values(module.exports).flatMap(css =>
    [...css.matchAll(/src: url\((.*?)\)/g)].map(match => match[1]));
  assert.equal(paths.length, 21);
  for (const [index, font] of fixture.fonts.entries()) {
    assert.ok(paths.includes(`/fixture-output/fonts/font-${index}.woff2`));
    assert.deepEqual(files.get(`fonts/font-${index}.woff2`), Buffer.from(font.base64, "base64"));
  }
});

test("the original font integrity pin and recursive enforcement remain in the flake", () => {
  const flake = fs.readFileSync(path.join(__dirname, "../../flake.nix"), "utf8");
  assert.ok(flake.includes(`outputHash = "${expectedHash}";`));
  assert.ok(flake.includes('outputHashMode = "recursive";'));
});
