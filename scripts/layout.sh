#!/usr/bin/env bash
# Banda's folders as ADR 0062 names them (decision 11; step R0 of the
# architecture vision): the window is a client, a module is an App or the
# platform's, and the contract is the SDK's. Folders only: every id, crate
# and package keeps its name.
#
#   scripts/layout.sh
#
# It moves whichever of the old folders are there, then aims every path to
# them again, in each tracked file but the ADRs and the research, which keep
# the paths of their day. cargo fmt and prettier then wrap what a longer
# path made too long. A second run changes nothing. It needs git and Node.
#
# A branch made before the move runs it where the old folders still are,
# then takes main's run, then the rest of main:
#
#   git fetch origin
#   script=$(git log -1 --format=%H --diff-filter=A origin/main -- scripts/layout.sh)
#   run=$(git rev-list --reverse --ancestry-path "$script..origin/main" | head -1)
#   git rebase "$script"
#   scripts/layout.sh && git commit -qam "chore(layout): run it"
#   git -c merge.directoryRenames=true rebase -X theirs "$run"
#   git rebase origin/main
#
# The first rebase is the branch's usual one, up to the script; the run
# then moves the branch's files and aims its paths from where they were.
# The second meets main's run alone: where a line the branch changed is
# one the move changed too, it keeps the branch's (-X theirs), which the
# branch's own run aims after. A file the branch added moves with its
# folder, or, in a folder new with the branch, with the branch's run. The
# last is the usual one again. What is left is the branch's own change,
# with the paths in its own lines aimed in a run commit of its own, if it
# has any; then pnpm install links the packages where they are.
#
# What it cannot move or aim, it names at the end: a folder in app/ or
# modules/ that is not on its list, as a module a branch added, and each
# line that names it; code it edits that a branch changed; and a `../`
# path that named something and, aimed again, names nothing. A path that
# starts at the root with `look/`, `settings/` or `contract/` is aimed
# only where what it names is there.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Each old folder, and where it goes.
MOVES="\
app/web client/web
app/desktop client/desktop
app/desktop-kit client/desktop-kit
app/ui client/ui
app/ghostty client/ghostty
modules/agents apps/agents
modules/browser apps/browser
modules/files apps/files
modules/git apps/git
modules/pulls apps/pulls
modules/terminal apps/terminal
modules/workspaces platform/workspaces
modules/harnesses platform/harnesses
modules/keys platform/keys
modules/notifications platform/notifications
modules/problems platform/problems
modules/sharing platform/sharing
modules/skill platform/skill
look platform/look
settings platform/settings
contract sdk/contract"
# The old folders' own folders, app/ and modules/.
parents=$(sed -n 's|^\([^ /]*\)/.*|\1|p' <<<"$MOVES" | sort -u)

# What this run moves, a folder or a file at a time: `from to`.
moved=""
while read -r from to; do
  [[ -n $(git ls-files -- "$from") ]] || continue
  if [[ ! -e $to ]]; then
    mkdir -p "$(dirname "$to")"
    git mv "$from" "$to"
    moved+="$from $to"$'\n'
    continue
  fi
  # The new folder is there already: what is left in the old one is what a
  # branch added in it.
  while IFS= read -r -d '' file; do
    mkdir -p "$(dirname "$to${file#"$from"}")"
    git mv "$file" "$to${file#"$from"}"
    moved+="$file $to${file#"$from"}"$'\n'
  done < <(git ls-files -z -- "$from")
  find "$from" -depth -type d -empty -delete
done <<<"$MOVES"
for parent in $parents; do rmdir "$parent" 2>/dev/null || true; done

# The paths, aimed again. Prints `changed <file>` for each file it changed
# and `left <what>` for each it could not.
said=$(MOVES=$MOVES MOVED=$moved node --input-type=module - <<'JS'
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { posix } from "node:path"

const pairs = (text) =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "))
const moves = pairs(process.env.MOVES)
const movedNow = pairs(process.env.MOVED)

const under = (path, folder) => path === folder || path.startsWith(`${folder}/`)
/** Where `path` is in the new layout. */
const now = (path) => {
  for (const [from, to] of moves)
    if (under(path, from)) return to + path.slice(from.length)
  return path
}
/** Where `path` was in the old layout. */
const before = (path) => {
  for (const [from, to] of moves)
    if (under(path, to)) return from + path.slice(to.length)
  return path
}
const isOld = (path) => moves.some(([from]) => under(path, from))
/** The old top folders, which hold nothing once moved. */
const tops = new Set(moves.map(([from]) => from.split("/")[0]))
const folderOf = (file) => (file.includes("/") ? posix.dirname(file) : "")
const depth = (folder) => (folder ? folder.split("/").length : 0)
const joined = (...parts) => {
  const path = posix.normalize(parts.filter(Boolean).join("/") || ".")
  return path === "." ? "" : path
}
/** Whether `chain`, read in `folder`, names something in the repository,
 * where it is now: up to a glob's `*`, a template's `${` or a link's `#`. */
const names = (folder, chain) => {
  const path = posix.join(folder || ".", chain.replace(/[*$#?].*$/, ""))
  return !path.startsWith("..") && existsSync(now(path))
}

/**
 * A `../` chain written in a folder that was `base0` and is `base1`,
 * aimed again at where its target is now. A chain that stays in its own
 * moved folder, or climbs above the repository, is left as it is; so is
 * one that reaches no moved folder, unless its own folder moved deeper.
 * One that climbed to the root climbs to it still, so a path reads as the
 * tree: `../../../platform/look`, not `../../look`.
 */
function aim(chain, base0, base1) {
  const parts = chain.split("/")
  let up = 0
  while (parts[up] === "..") up++
  const above = base0 ? base0.split("/") : []
  if (up > above.length) return chain
  const top = above.slice(0, above.length - up).join("/")
  const rest = parts.slice(up)
  const target = joined(top, ...rest)
  const home = moves.find(([from]) => under(base0, from))
  if (home && under(target, home[0])) return chain
  let aimed
  if (isOld(target)) aimed = now(target)
  else if (
    depth(base0) !== depth(base1) &&
    top === "" &&
    (!rest.join("") || (existsSync(rest[0]) && !tops.has(rest[0])))
  )
    aimed = target
  else return chain
  let path =
    top === ""
      ? posix.join(...Array(depth(base1)).fill(".."), aimed || ".")
      : posix.relative(base1 || ".", aimed || ".") || "."
  if (chain.endsWith("/") && !path.endsWith("/")) path += "/"
  return path
}

/** A `../` chain, or a bare `..` in quotes or at a line's end: not a
 * spread's `...`, a slice's `[..n]` or a struct's `..rest`. */
const CHAIN =
  /(?<![\w./@-])\.\.(?=[/"'`]|$)(?:\/\.\.)*(?:\/[^\s"'`()[\]<>;:,]*)?/g

/** The folder a Rust crate's `CARGO_MANIFEST_DIR` names, for `file`. */
function crateOf(file) {
  let folder = folderOf(file)
  while (folder && !existsSync(`${folder}/Cargo.toml`))
    folder = folderOf(folder)
  return folder
}

/** Old folders of two parts, which name nothing else: written anywhere. */
const PLAIN = moves
  .filter(([from]) => from.includes("/"))
  .map(([from, to]) => [new RegExp(`(?<![\\w.@-])${from}(?![\\w-])`, "g"), to])
/** Old folders of one word, which other things share a name with: only
 * from the repository's root, and only to a path that is there. */
const WORDS = moves
  .filter(([from]) => !from.includes("/"))
  .map(([from]) => from)
const ROOTED = new RegExp(
  `(?<![\\w./@-])(${WORDS.join("|")})/([\\w.-]+(?:/[\\w.-]+)*)`,
  "g"
)
/** A glob over an old folder's parts, `modules/*`, and the folders those
 * parts went to: the line is written once for each. */
const GLOBS = [
  ...new Set(
    moves
      .filter(([from]) => from.includes("/"))
      .map(([from]) => from.split("/")[0])
  ),
].map((parent) => [
  new RegExp(`(?<![\\w.@-])${parent}/\\*`, "g"),
  [
    ...new Set(
      moves
        .filter(([from]) => from.startsWith(`${parent}/`))
        .map(([, to]) => to.split("/")[0])
    ),
  ],
])

function rewrite(file, text) {
  const moved = movedNow.some(([, to]) => under(file, to))
  const lines = text.split("\n")
  const out = []
  // pnpm's lockfile: an importer's links are from its own folder.
  let importers = false
  let importer = null
  for (const [at, line] of lines.entries()) {
    let base1 = folderOf(file)
    if (/CARGO_MANIFEST_DIR/.test(`${lines[at - 1]} ${line}`))
      base1 = crateOf(file)
    let base0 = moved ? before(base1) : base1
    if (file === "pnpm-lock.yaml") {
      if (/^\S/.test(line)) importers = line === "importers:"
      const key = importers && /^ {2}(\S+):$/.exec(line)
      if (key) {
        importer = key[1] === "." ? "" : key[1]
        out.push(`  ${now(importer) || "."}:`)
        continue
      }
      if (importers && importer !== null)
        [base0, base1] = [importer, now(importer)]
    }
    /** A chain, aimed again. One in a moved folder that this run did not
     * move, as a branch that rebased first has it, was written where its
     * file was when it names nothing from here. */
    const aimed = (chain) => {
      const again = aim(chain, base0, base1)
      if (again !== chain || base0 !== base1 || names(base1, chain))
        return again
      const old = before(base1)
      const then = old === base1 ? chain : aim(chain, old, base1)
      return names(base1, then) ? then : chain
    }
    let each = [line]
    for (const [glob, tos] of GLOBS)
      each = each.flatMap((one) =>
        one.search(glob) < 0
          ? [one]
          : tos.map((to) => one.replace(glob, `${to}/*`))
      )
    for (let next of each) {
      next = next.replace(CHAIN, aimed)
      for (const [old, to] of PLAIN) next = next.replace(old, to)
      next = next.replace(ROOTED, (path, word, rest) => {
        const tail = /\.*$/.exec(rest)[0]
        const named = `${now(word)}/${rest.slice(0, rest.length - tail.length)}`
        return existsSync(named) ? named + tail : path
      })
      // A `../` path changed here that named something and names nothing.
      if (next !== line) {
        const was = [...line.matchAll(CHAIN)].map(([chain]) => chain)
        const old = base0 === base1 ? before(base1) : base0
        for (const [i, [chain]] of [...next.matchAll(CHAIN)].entries())
          if (was[i] && names(old, was[i]) && !names(base1, chain))
            console.log(`left ${file}:${at + 1}: ${chain} names nothing`)
      }
      out.push(next)
    }
  }
  return out.join("\n")
}

// pnpm keeps its importers in order.
function sorted(lock) {
  return lock.replace(/^importers:\n\n([\s\S]*?)\n\n(?=\S)/m, (_, body) => {
    const name = (block) => block.trim().split(":")[0]
    const blocks = body.split(/\n\n(?= {2}\S)/)
    blocks.sort((a, b) => (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0))
    return `importers:\n\n${blocks.join("\n\n")}\n\n`
  })
}

// What no rule above can aim: lists of folders that name them bare, and
// the code that walks the modules' folder, which is two folders now. Each
// is found as written on main the day of the move; one a branch changed
// is left for its author, and named at the end.
const EDITS = [
  [
    "Cargo.toml",
    /^members = \[(.*)\]$/m,
    (_, list) => {
      const members = [...list.matchAll(/"([^"]+)"/g)].map(([, m]) => now(m))
      return `members = [${members
        .sort()
        .map((m) => `"${m}"`)
        .join(", ")}]`
    },
  ],
  ["pnpm-workspace.yaml", /^ {2}- contract$/m, "  - sdk/contract"],
  ...[
    "client/web/src/actions/declared.test.ts",
    "client/web/src/named-keys.test.ts",
  ].map((file) => [
    file,
    `  ...readdirSync(join(root, "modules"))
    .map((module) => join(root, "modules", module, "pane/src"))
    .filter((folder) => existsSync(folder)),`,
    `  ...["apps", "platform"]
    .flatMap((bucket) =>
      readdirSync(join(root, bucket)).map((module) =>
        join(root, bucket, module, "pane/src")
      )
    )
    .filter((folder) => existsSync(folder)),`,
  ]),
  [
    "client/web/src/architecture.test.ts",
    `/** The modules' window parts, the page's and main's, by their packages'
 * names. */
const packages = readdirSync(join(root, "modules")).flatMap((module) =>
  ["pane", "desktop"].flatMap((part) => {
    const file = join(root, "modules", module, part, "package.json")`,
    `/** Each module's folder, by its id: an App's in apps/, the platform's in
 * platform/ (ADR 0062, decision 11), with its \`module.toml\`. */
const folders = new Map(
  ["apps", "platform"].flatMap((bucket) =>
    readdirSync(join(root, bucket))
      .map((module) => [module, join(root, bucket, module)] as const)
      .filter(([, folder]) => existsSync(join(folder, "module.toml")))
  )
)

/** The modules' window parts, the page's and main's, by their packages'
 * names. */
const packages = [...folders.values()].flatMap((folder) =>
  ["pane", "desktop"].flatMap((part) => {
    const file = join(folder, part, "package.json")`,
  ],
  [
    "client/web/src/architecture.test.ts",
    "from `[unstable]` in `modules/<module>/module.toml`.",
    "from `[unstable]` in its module's `module.toml`.",
  ],
  [
    "client/web/src/architecture.test.ts",
    `function marksOf(module: string): string[] {
  const text = readFileSync(
    join(root, "modules", module, "module.toml"),
    "utf8"
  )`,
    `function marksOf(module: string): string[] {
  const folder = folders.get(module)
  if (!folder) return []
  const text = readFileSync(join(folder, "module.toml"), "utf8")`,
  ],
  [
    "client/web/src/architecture.test.ts",
    `  const held = readdirSync(join(root, "modules"))
    .filter((module) =>
      existsSync(join(root, "modules", module, "module.toml"))
    )
    .flatMap((module) => marksOf(module).map((mark) => \`\${module}.\${mark}\`))`,
    `  const held = [...folders.keys()].flatMap((module) =>
    marksOf(module).map((mark) => \`\${module}.\${mark}\`)
  )`,
  ],
  [
    "client/web/src/modules.test.ts",
    `    const folder = join(import.meta.dirname, "../../../modules", module.id)
    expect(existsSync(join(folder, "module.toml")), module.id).toBe(true)
    if (written(join(folder, "window.json"), windowOf(module)))`,
    `    const folder = ["apps", "platform"]
      .map((bucket) => join(import.meta.dirname, "../../..", bucket, module.id))
      .find((folder) => existsSync(join(folder, "module.toml")))
    expect(folder, module.id).toBeDefined()
    if (folder && written(join(folder, "window.json"), windowOf(module)))`,
  ],
  [
    "client/web/src/problems/keep.ts",
    ` * script's map names its sources, \`/src/…\` or \`/modules/…\`; a built
 * script with no map, the bundle's name without its hash. A library's or
 * another origin's is none.`,
    ` * script's map names its sources, \`/src/…\`, \`/apps/…\` or \`/platform/…\`;
 * a built script with no map, the bundle's name without its hash. A
 * library's or another origin's is none.`,
  ],
  [
    "sdk/contract/src/problems.ts",
    "const PARTS = /\\/((?:app|modules|contract)\\/.*)$/",
    "const PARTS = /\\/((?:client|apps|platform|sdk)\\/.*)$/",
  ],
  [
    "kernel/tests/architecture.rs",
    `fn modules() -> Vec<String> {
    std::fs::read_dir(repository().join("modules"))
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// Every folder under \`modules/\` is a name the kernel's source must not
/// contain: the kernel reaches modules only through the Module trait.`,
    `/// Each module's folder, with its \`module.toml\`: an App's under \`apps/\`,
/// the platform's under \`platform/\` (ADR 0062, decision 11).
fn modules() -> Vec<PathBuf> {
    ["apps", "platform"]
        .iter()
        .filter_map(|bucket| std::fs::read_dir(repository().join(bucket)).ok())
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|path| path.join("module.toml").exists())
        .collect()
}

/// Every module's folder is a name the kernel's source must not contain:
/// the kernel reaches modules only through the Module trait.`,
  ],
  [
    "kernel/tests/architecture.rs",
    `        for module in modules() {
            for needle in [`,
    `        for folder in modules() {
            let module = folder.file_name().unwrap().to_string_lossy();
            for needle in [`,
  ],
  [
    "kernel/tests/architecture.rs",
    `    for module in modules() {
        let mut files = Vec::new();
        sources(&repository().join("modules").join(&module), &mut files);`,
    `    for folder in modules() {
        let mut files = Vec::new();
        sources(&folder, &mut files);`,
  ],
  [
    "platform/settings/src/lib.rs",
    `        let modules = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../modules");
        for module in std::fs::read_dir(modules).unwrap().flatten() {
            let id = module.file_name().to_string_lossy().into_owned();
            if module.path().join("window.json").exists() {
                assert!(
                    window(&id).is_some(),
                    "modules/{id}/window.json is not in WINDOWS: the look would not know its actions"
                );
            }
        }`,
    `        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for bucket in ["apps", "platform"] {
            for module in std::fs::read_dir(root.join(bucket)).unwrap().flatten() {
                let id = module.file_name().to_string_lossy().into_owned();
                if module.path().join("window.json").exists() {
                    assert!(
                        window(&id).is_some(),
                        "{bucket}/{id}/window.json is not in WINDOWS: the look would not know its actions"
                    );
                }
            }
        }`,
  ],
  [
    "platform/skill/build.rs",
    `for parent in [root.clone(), root.join("modules")] {`,
    `for parent in [root.clone(), root.join("apps"), root.join("platform")] {`,
  ],
  [
    "platform/skill/build.rs",
    "at the workspace's top (`platform/look/skill/`) or in a module\n//! (`apps/agents/skill/`).",
    "at the workspace's top (`engine/skill/`) or in `apps/` and `platform/`\n//! (`platform/look/skill/`).",
  ],
  [
    "engine/src/modules.rs",
    `panic!("modules/{folder}/module.toml: {error}")`,
    `panic!("{folder}'s module.toml: {error}")`,
  ],
  [
    "engine/src/modules.rs",
    `panic!("modules/{folder}/window.json: {error}")`,
    `panic!("{folder}'s window.json: {error}")`,
  ],
  [
    "engine/src/modules.rs",
    `"modules/{}/module.toml", files.folder`,
    `"{}'s module.toml", files.folder`,
  ],
]

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter(
    (file) =>
      !/^docs\/(adr|research)\//.test(file) &&
      file !== "scripts/layout.sh" &&
      existsSync(file)
  )
for (const file of files) {
  const bytes = readFileSync(file)
  if (bytes.subarray(0, 8000).includes(0)) continue
  const text = bytes.toString("utf8")
  let next = rewrite(file, text)
  if (file === "pnpm-lock.yaml") next = sorted(next)
  for (const [path, from, to] of EDITS) {
    if (path !== file) continue
    if (typeof from === "string" && !next.includes(from)) {
      if (!next.includes(to))
        console.log(`left ${file}: not as on main: ${from.split("\n")[0]}`)
      continue
    }
    next = next.replace(from, to)
  }
  if (next !== text) {
    writeFileSync(file, next)
    console.log(`changed ${file}`)
  }
}
JS
)
changed=$(sed -n 's/^changed //p' <<<"$said")
left=$(sed -n 's/^left //p' <<<"$said")

# A path a line longer or shorter may wrap it otherwise.
cargo fmt --all || left+=$'\n'"cargo fmt failed: a Cargo.toml may name a path that is not there"
if [[ -n $changed && -x node_modules/.bin/prettier ]]; then
  xargs node_modules/.bin/prettier --write --ignore-unknown --log-level warn \
    <<<"$changed" 2>/dev/null ||
    left+=$'\n'"prettier could not format what changed: run pnpm install, then pnpm format"
fi

# What is left in an old folder: a module this list does not know, say,
# and each line that names it.
while read -r top; do
  [[ -e $top ]] || continue
  if [[ -z $(git ls-files -- "$top") ]]; then
    left+=$'\n'"$top/ holds only what git does not track, as node_modules: remove it"
    continue
  fi
  for part in $(git ls-files -- "$top" | cut -d/ -f1-2 | sort -u); do
    left+=$'\n'"$part is not on the list of moves"
    left+=$'\n'$(git grep -n -I -E "(^|[^A-Za-z0-9_@-])$part([^A-Za-z0-9_-]|$)" \
      -- ':!docs/adr' ':!docs/research' ':!scripts/layout.sh' || true)
  done
done < <(cut -d' ' -f1 <<<"$MOVES" | cut -d/ -f1 | sort -u)
# pnpm's links in node_modules point at the folders they were made for.
if [[ -d node_modules && pnpm-lock.yaml -nt node_modules/.modules.yaml ]]; then
  echo "layout.sh: run pnpm install, so node_modules links the new folders" >&2
fi
if [[ -n ${left//$'\n'/} ]]; then
  echo "layout.sh: left as it was, for you to look at:" >&2
  sed '/^$/d' <<<"$left" >&2
fi
