# The CI runner: a GitHub Actions self-hosted runner with what
# scripts/check.sh needs (ci/README.md).
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG DEBIAN_FRONTEND=noninteractive
# A C toolchain for the bundled SQLite, procps for the tests' process checks,
# clang and LLVM's tools for the workspace built for Windows, and what
# Electron's Chromium loads, even headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git jq unzip xz-utils build-essential pkg-config procps \
        clang llvm \
        libnss3 libatk-bridge2.0-0t64 libatk1.0-0t64 libcups2t64 libgbm1 libasound2t64 \
        libgtk-3-0t64 libxss1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
        libpango-1.0-0 libcairo2 libdrm2 libxkbcommon0 libx11-xcb1 libxshmfence1 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
# rustup only: a job installs rust-toolchain.toml's toolchain into the
# runner's volume, so a new pin needs no new image.
RUN curl -fsSL https://sh.rustup.rs | CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/tmp/rustup \
        sh -s -- -y --no-modify-path --profile minimal --default-toolchain none \
    && rm -rf /tmp/rustup && chmod -R a+rX /usr/local/cargo
# cargo-xwin, which builds the workspace for Windows from Linux
# (`scripts/check.sh windows`, ADR 0090, decision 9). It fetches Microsoft's
# CRT and Windows SDK into the runner's volume on first use, under
# Microsoft's license (ADR 0090, open question 14).
ARG CARGO_XWIN_VERSION=0.23.1
ARG CARGO_XWIN_SHA256=c492c6dfb7e5ac0eee586b796e0fc950ba13077e7f0bbb046f445d71790d5360
RUN curl -fsSLo xwin.tar.gz "https://github.com/rust-cross/cargo-xwin/releases/download/v$CARGO_XWIN_VERSION/cargo-xwin-v$CARGO_XWIN_VERSION.x86_64-unknown-linux-musl.tar.gz" \
    && echo "$CARGO_XWIN_SHA256  xwin.tar.gz" | sha256sum -c - \
    && tar -xzf xwin.tar.gz -C /usr/local/cargo/bin cargo-xwin && rm xwin.tar.gz
# Node, and pnpm, which switches itself to package.json's packageManager pin.
ARG NODE_VERSION=26.12.0
ARG NODE_SHA256=fd47865ecd6391ebb431fc815e01b9135bf83ded5cf373247e9331e196b7aded
RUN curl -fsSLo node.tar.xz "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" \
    && echo "$NODE_SHA256  node.tar.xz" | sha256sum -c - \
    && tar -xJf node.tar.xz -C /usr/local --strip-components=1 --exclude='*.md' --exclude=LICENSE \
    && rm node.tar.xz \
    && npm install --global pnpm@11 && npm cache clean --force
# The runner itself. It updates itself in its volume when GitHub asks for a
# newer version; a new image only changes the starting point.
ARG RUNNER_VERSION=2.338.0
ARG RUNNER_SHA256=af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32
RUN mkdir -p /opt/actions-runner && cd /opt/actions-runner \
    && curl -fsSLo runner.tar.gz "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/actions-runner-linux-x64-$RUNNER_VERSION.tar.gz" \
    && echo "$RUNNER_SHA256  runner.tar.gz" | sha256sum -c - \
    && tar xzf runner.tar.gz && rm runner.tar.gz \
    && ./bin/installdependencies.sh && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 1001 ci && mkdir /state && chown ci:ci /state
COPY --chmod=0755 entrypoint.sh /usr/local/bin/banda-runner
# Fails a fork's job before it starts (ADR 0038, decision 4). The runner
# takes a hook only by its extension, so the name keeps its .sh.
COPY --chmod=0755 job-started.sh /usr/local/bin/banda-job-started.sh
# All a run keeps lives in /state, the runner's volume. Debug info is most
# of a debug target/, and no check reads it.
ENV RUSTUP_HOME=/state/rustup CARGO_HOME=/state/cargo BANDA_CI_TARGET=/state/target \
    XDG_DATA_HOME=/state/data XDG_CACHE_HOME=/state/cache \
    CARGO_PROFILE_DEV_DEBUG=0 \
    ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/bin/banda-job-started.sh \
    PATH=/usr/local/cargo/bin:$PATH
USER ci
WORKDIR /state
ENTRYPOINT ["banda-runner"]
