#!/usr/bin/env bash
# Runs contracts/company/tests/sandbox.rs on a real local NEAR node inside Docker (near-sandbox is Linux only).
# Build both wasm files first, on the host where cargo-near works:
#   (cd test-usdc && cargo near build non-reproducible-wasm --no-abi) && (cd company && cargo near build non-reproducible-wasm --no-abi)
# Volumes keep the Linux build, the cargo registry and the neard binary between runs.
# The image is Debian 13 because neard (the sandbox node) needs glibc 2.39 or newer.
set -euo pipefail
cd "$(dirname "$0")"
# Git Bash: Docker wants the Windows form of the path, and /work must not be rewritten
HOST_DIR="$(pwd -W 2>/dev/null || pwd)"
export MSYS_NO_PATHCONV=1
docker run --rm \
  -v "$HOST_DIR":/work -w /work/company \
  -v shark-cargo-registry:/usr/local/cargo/registry \
  -v shark-sandbox-target:/cache/target \
  -v shark-sandbox-bin:/root/.near \
  -e CARGO_TARGET_DIR=/cache/target \
  rust:1-trixie \
  cargo test --test sandbox -- --test-threads=1 --nocapture "$@"
