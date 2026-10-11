# Comail Bulwark builds the standalone webmail bundle with pinned npm dependencies
# and Google Fonts. Refresh npmDepsHash when package-lock.json changes; refresh
# the font hash only when the layout's font declarations change.
{
  description = "comail-themed Bulwark webmail (Next.js JMAP client)";

  inputs = {
    # Pinned to the comail monorepo's nixpkgs rev so this build reproduces the
    # monorepo's known-good bulwark derivation (node/toolchain parity — a newer
    # unstable node pulled the @swc/core musl binding on the glibc linux builder
    # and broke `next build`). The monorepo overrides this via
    # inputs.comail-bulwark.inputs.nixpkgs.follows when it consumes this flake.
    nixpkgs.url = "github:NixOS/nixpkgs/68d8aa3d661f0e6bd5862291b5bb263b2a6595c9";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        lib = nixpkgs.lib;

        # --- (1) Hermetic Google-Fonts FOD -------------------------------------
        # next/font/google (app/(main)/layout.tsx: Geist, Geist Mono, Young
        # Serif, Atkinson Hyperlegible) fetches CSS + woff2 at build time, which
        # the Nix sandbox forbids. NEXT_FONT_GOOGLE_MOCKED_RESPONSES points
        # next/font at a JS module that returns the pre-fetched CSS instead.
        # The fetcher script (nix/bulwark-google-fonts-fetcher.js) reads
        # $OUT_DIR and writes mock-responses.js + the woff2 binaries. Fixed
        # output → network is allowed; the recursive hash pins every byte.
        # Hash pinned from the monorepo: identical font declarations → identical
        # bytes. Do NOT regenerate unless layout.tsx's font declarations change.
        bulwarkGoogleFontMocks = pkgs.runCommand "bulwark-google-font-mocks" {
          outputHashAlgo = "sha256";
          outputHashMode = "recursive";
          outputHash = "sha256-2sicALM/j6JHVFMcO4akQHhrxlyvdlGTpVbE1u/B6gI=";
          nativeBuildInputs = [ pkgs.curl pkgs.cacert pkgs.nodejs ];
        } ''
          export OUT_DIR=$out
          export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
          export CURL_CA_BUNDLE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
          node ${./nix/bulwark-google-fonts-fetcher.js}
        '';

        # Source = the Next.js app's build inputs ONLY — byte-identical to the
        # comail monorepo's in-tree `web-bulwark/` src, which is the build that
        # is known-good on the linux/glibc nix runner. This repo's root adds
        # standalone-flake infrastructure (flake.nix/flake.lock, nix/, .gitea/,
        # .github/, .git/, screenshots/, Dockerfile, *.md, FINDINGS-*, result,
        # setup.sh, …) that the in-tree src does NOT carry. Leaving them in the
        # source closure is the one observable difference between the working
        # in-tree build and this failing standalone one (chainlink #1444): npm's
        # arborist changes project-root / git-dependency handling when a `.git`
        # dir sits at the install root, which perturbs how the nested
        # `next-intl/node_modules/@swc/core` resolves its optional native
        # binding on linux (it loads the musl `.node` on a glibc system). None
        # of the excluded paths are `next build` inputs, so dropping them cannot
        # change the build output — it only removes the delta.
        #
        # We exclude the standalone-flake infra + generated/build-artifact
        # paths (keeping every app file, so the closure matches the in-tree
        # src). `maybeMissing` keeps evaluation safe in a clean clone where the
        # generated paths are absent.
        src = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.difference
            ./. (lib.fileset.unions [
              # --- standalone-flake infrastructure (not in the in-tree src) ---
              ./flake.nix
              ./flake.lock
              ./nix
              (lib.fileset.maybeMissing ./.gitea)
              (lib.fileset.maybeMissing ./.github)
              (lib.fileset.maybeMissing ./screenshots)
              ./Dockerfile
              ./docker-compose.yml
              ./.dockerignore
              ./setup.sh
              # FINDINGS-*.md are untracked working-tree docs, not flake
              # inputs; exclude them if present so they never leak into the
              # build source. (lib.fileset.glob + maybeMissing isn't a thing,
              # so list the known ones.)
              (lib.fileset.maybeMissing ./FINDINGS-flake.md)
              (lib.fileset.maybeMissing ./FINDINGS-swc.md)
              # --- generated / build artifacts (absent in a clean clone) ---
              (lib.fileset.maybeMissing ./node_modules)
              (lib.fileset.maybeMissing ./.next)
              (lib.fileset.maybeMissing ./coverage)
              (lib.fileset.maybeMissing ./tsconfig.tsbuildinfo)
              (lib.fileset.maybeMissing ./.husky/_)
              (lib.fileset.maybeMissing ./result)
            ]);
        };

        # --- (2) The webmail package (Next.js standalone output) ---------------
        # npmDepsHash is generated by prefetch-npm-deps from package-lock.json.
        bulwark = pkgs.buildNpmPackage {
          pname = "comail-bulwark";
          version = "1.13.0";
          inherit src;
          npmDepsHash = "sha256-eeujzskJ1JNiikDsPaYPgYc2dfcYG0NZX/wiWyuqitg=";
          # package.json build script is `next build --turbopack`; the
          # production build must use webpack (turbopack's output tracing /
          # standalone emit is not byte-equivalent and historically mishandles
          # the @/* alias). Swap the script in place before the build.
          postPatch = ''
            substituteInPlace package.json \
              --replace '"next build --turbopack"' '"next build --webpack"'
          '';
          # NAPI-RS probes can choose musl when the sandbox has no /usr/bin/ldd.
          # Force GNU bindings on Linux; this branch is unused on Darwin.
          # package.json pins SWC before compressed native carriers, which
          # reject Nix's unmapped sandbox-root owner.
          preBuild = ''
            while IFS= read -r f; do
              substituteInPlace "$f" \
                --replace 'const isMusl = () => {' 'const isMusl = () => { return false;'
            done < <(grep -rl 'const isMusl = () => {' node_modules 2>/dev/null)
          '';
          env = {
            NEXT_TELEMETRY_DISABLED = "1";
            NEXT_FONT_GOOGLE_MOCKED_RESPONSES = "${bulwarkGoogleFontMocks}/mock-responses.js";
          };
          # Next standalone: server.js + traced node_modules + .next (manifests)
          # land in .next/standalone; .next/static (client chunks) and public/
          # are NOT traced, so copy them in beside server.js to form a
          # self-contained output tree that `node server.js` can serve.
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r .next/standalone/. $out/
            mkdir -p $out/.next
            cp -r .next/static $out/.next/static
            cp -r public $out/public
            runHook postInstall
          '';
          dontNpmCheck = true;
          meta.description = "comail-themed Bulwark webmail (Next.js JMAP client)";
          meta.mainProgram = "server.js";
          meta.license = lib.licenses.agpl3Only;
        };
      in
      {
        packages = {
          inherit bulwark;
          default = bulwark;
        };

        # Node 22 matches the version pinned by .github/workflows/*-release.yml
        # and satisfies next@16's Node >=20.9 requirement.
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_22 ];
          shellHook = ''
            echo "comail-bulwark dev shell — node $(node -v), npm $(npm -v)"
          '';
        };

        formatter = pkgs.nixpkgs-fmt;
      });
}
