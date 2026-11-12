#!/bin/sh
# Installs Banda's engine on the machine it runs on, as the Person, no root
# (ADR 0115, decision 8): what a machine with no window needs for another
# machine's Banda to reach it, and what Install in Settings → Machines runs
# there over ssh. From then on that machine's engine updates itself
# (platform/updates).
#
#   install.sh [--check] [--channel dev|stable] [version]
#
#   curl -fsSL https://github.com/0x1oceanlabs/banda/releases/download/v<version>/install.sh | sh -s -- <version>
#
# With no version, the channel's newest. It reads the release's feed,
# <feed>-engine-<os>.yml (scripts/engine.mjs), takes the bundle it names,
# <folder>-<version>-engine-<os>-<arch>.tar.gz, checks its size and
# sha512, unpacks it beside the engine's copies, checks what its `banda
# --version` says, and renames it into place: <data>/<folder>/engine/
# <version>/, laid out as the window's own copy (client/desktop/src/
# program.ts) and platform/updates' are; the two newest stay. Where a
# package manager owns Banda, it takes nothing.
#
# It says each step on a line of its own, its first word what it is, for a
# person and for the window alike:
#
#   machine <os> <arch> <system…>
#   version <version>
#   present <version> <path>        that version is in place already
#   downloading <file> <bytes>
#   checked <file>
#   installed <version> <path>      the last line, once it is in place
#
# --check says machine, version and where it would go (`would <version>
# <path>`, or `present`), and takes nothing. A failure says
# `failed <why>` on stderr and ends 1. POSIX sh: dash and macOS's sh.
set -eu

repo=0x1oceanlabs/banda
channel=dev
check=
version=
while [ $# -gt 0 ]; do
  case $1 in
    --check) check=1 ;;
    --channel) channel=${2:-}; shift ;;
    -*) echo "failed unknown option $1" >&2; exit 2 ;;
    *) version=${1#v} ;;
  esac
  shift
done

fail() {
  echo "failed $*" >&2
  exit 1
}

case $channel in
  dev) folder=banda-dev feed=dev ;;
  stable) folder=banda feed=latest ;;
  *) fail "no channel $channel: dev or stable" ;;
esac

case $(uname -s) in
  Linux) os=linux data=${XDG_DATA_HOME:-$HOME/.local/share} ;;
  Darwin) os=mac data="$HOME/Library/Application Support" ;;
  *) fail "Banda's engine runs on Linux and macOS, not $(uname -s)" ;;
esac
case $(uname -m) in
  x86_64 | amd64) arch=x86_64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "no Banda for $(uname -m)" ;;
esac
system=
if [ "$os" = mac ]; then
  system="macOS $(sw_vers -productVersion 2>/dev/null || true)"
elif [ -r /etc/os-release ]; then
  system=$(. /etc/os-release && echo "${NAME:-Linux} ${VERSION_ID:-}")
fi
echo "machine $os $arch ${system:-$(uname -s)}"

[ "$(id -u)" -ne 0 ] || fail "run it as the Person who uses Banda, not root"

# Where a package manager put Banda, it updates it too (package-type, as
# the AUR's banda-bin has).
if owned=$(command -v "$folder" 2>/dev/null); then
  owned=$(readlink -f "$owned" 2>/dev/null || echo "$owned")
  [ ! -e "$(dirname "$owned")/package-type" ] ||
    fail "a package manager owns $folder here ($owned): update it there"
fi

fetch() { # fetch <url> <file>, or to stdout with no file
  if command -v curl >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then curl -fsSL -o "$2" "$1"; else curl -fsSL "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then wget -q -O "$2" "$1"; else wget -q -O - "$1"; fi
  else
    fail "neither curl nor wget is here"
  fi
}

if [ -z "$version" ]; then
  if [ "$channel" = dev ]; then
    version=$(fetch "https://api.github.com/repos/$repo/releases?per_page=1" |
      sed -n 's/^ *"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)
  else
    version=$(fetch "https://api.github.com/repos/$repo/releases/latest" |
      sed -n 's/^ *"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)
  fi
  [ -n "$version" ] || fail "GitHub named no release of $channel"
fi
case $version in
  *[!0-9A-Za-z.+_-]* | "") fail "no version $version" ;;
esac
echo "version $version"

engine=$data/$folder/engine
kept=$engine/$version
if [ -x "$kept/banda" ] && "$kept/banda" --version 2>/dev/null | grep -q "^banda $version "; then
  echo "present $version $kept"
  exit 0
fi
if [ -n "$check" ]; then
  echo "would $version $kept"
  exit 0
fi

release=https://github.com/$repo/releases/download/v$version
mkdir -p "$engine"
work=$(mktemp -d "$engine/.install.XXXXXX")
fresh=$engine/.$version.new
# Ended early, as when Install's ssh is cancelled, it leaves nothing half
# put in place.
trap 'rm -rf "$work" ${fresh:+"$fresh"}' EXIT
trap 'exit 1' HUP INT TERM PIPE

fetch "$release/$feed-engine-$os.yml" "$work/feed.yml" ||
  fail "$version has no engine for $os; it came with dev.660"
file=$(sed -n 's/^path: *//p' "$work/feed.yml")
sha512=$(sed -n 's/^sha512: *//p' "$work/feed.yml")
size=$(sed -n 's/^ *size: *//p' "$work/feed.yml" | head -n 1)
case $file in
  "$folder-$version-engine-$os-$arch.tar.gz") ;;
  *) fail "the feed names $file, not this machine's" ;;
esac
echo "downloading $file $size"
fetch "$release/$file" "$work/$file" || fail "$file did not download"

[ "$(wc -c <"$work/$file" | tr -d ' ')" = "$size" ] || fail "$file is not $size bytes"
# The sha512 in base64, as electron-builder writes it.
if command -v openssl >/dev/null 2>&1; then
  said=$(openssl dgst -sha512 -binary "$work/$file" | base64 | tr -d '\n')
else
  hex=$( (sha512sum "$work/$file" 2>/dev/null || shasum -a 512 "$work/$file") | cut -d ' ' -f 1)
  said=$(printf "$(echo "$hex" | sed 's/../ 0x&/g' | xargs printf '\\%03o')" | base64 | tr -d '\n')
fi
[ "$said" = "$sha512" ] || fail "$file's sha512 is not the feed's"
echo "checked $file"

rm -rf "$fresh"
mkdir -p "$fresh"
tar -xzf "$work/$file" -C "$fresh" || { rm -rf "$fresh"; fail "$file did not unpack"; }
for needed in banda adapters/claude-agent-acp.mjs adapters/codex-acp.mjs; do
  [ -f "$fresh/$needed" ] || { rm -rf "$fresh"; fail "$file has no $needed"; }
done
says=$("$fresh/banda" --version 2>/dev/null || true)
case $says in
  "banda $version "*) ;;
  *) rm -rf "$fresh"; fail "the new engine says \"$says\", not $version" ;;
esac
echo "$says" >"$fresh/version"
rm -rf "$kept"
mv "$fresh" "$kept"
fresh=

# The two newest stay, as the window and platform/updates keep them.
ls -1 "$engine" | grep -v '^\.' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | sed '$d' | sed '$d' |
  while read -r old; do
    [ -x "$engine/$old/banda" ] && rm -rf "${engine:?}/$old"
  done
echo "installed $version $kept"
