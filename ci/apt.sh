#!/usr/bin/env bash
# Installs Ubuntu packages on a GitHub runner: ci.yml's parts call it with
# the packages they need. Those the runner's image has already are left
# as they are, so most of a run asks apt for nothing.
#
# For the rest apt asks Ubuntu's mirrors, for two minutes at most. On
# 2026-11-11 no ubuntu.com name resolved on GitHub's runners for hours;
# a package below then comes from Debian's archive instead, by a hash
# pinned here, which libraries the image has satisfy.
set -euo pipefail

declare -A debian=(
  [bubblewrap]="https://deb.debian.org/debian/pool/main/b/bubblewrap/bubblewrap_0.12.0-1~deb13u1_amd64.deb 70aca4fa8daeacb677ec00e8063eb586f08ae3d94b1f11e684370b5524c43431"
)

missing=()
for package in "$@"; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'ok installed' ||
    missing+=("$package")
done
((${#missing[@]})) || exit 0
echo "apt.sh: installing ${missing[*]}"

apt=(-o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15)
if sudo timeout 120 apt-get update -q "${apt[@]}" &&
  sudo timeout 300 apt-get install -y -q --no-install-recommends "${apt[@]}" "${missing[@]}"; then
  exit 0
fi

echo "::warning::apt.sh: Ubuntu's mirrors failed; ${missing[*]} from Debian's archive"
work=$(mktemp -d)
debs=()
for package in "${missing[@]}"; do
  [[ -v debian[$package] ]] || { echo "apt.sh: no Debian package pinned for $package" >&2; exit 1; }
  read -r url sha <<<"${debian[$package]}"
  curl -fsSL --retry 3 -m 120 -o "$work/$package.deb" "$url"
  echo "$sha  $work/$package.deb" | sha256sum -c -
  debs+=("$work/$package.deb")
done
sudo dpkg -i "${debs[@]}"
