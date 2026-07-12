#!/bin/bash
# ============================================================================
# hotelbyte-cli Installer
# ============================================================================
# One-click installation script. Downloads a pre-compiled Bun binary from
# GitHub Releases and sets up symlinks. No Python/Node/Bun runtime needed
# on the target machine.
#
# Usage:
#   curl -fsSL https://github.com/hotelbyte-com/hotelbyte-cli/releases/latest/download/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --version 0.2.0 --install-dir /usr/local
#
# ============================================================================

set -e

# Guard against environment leakage
if [ -n "${PYTHONPATH:-}" ]; then
    echo "⚠ Ignoring inherited PYTHONPATH during install"
    unset PYTHONPATH
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
REPO="hotelbyte-com/hotelbyte-cli"
HOTELBYTE_HOME="${HOTELBYTE_HOME:-$HOME/.hotelbyte-cli}"
INSTALL_VERSION=""
INSTALL_BIN_DIR="${HOTELBYTE_INSTALL_BIN_DIR:-$HOME/.local/bin}"

# Detect non-interactive mode
if [ -t 0 ]; then
    IS_INTERACTIVE=true
else
    IS_INTERACTIVE=false
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --version)
            INSTALL_VERSION="$2"
            shift 2
            ;;
        --install-dir)
            INSTALL_BIN_DIR="$2"
            shift 2
            ;;
        --home)
            HOTELBYTE_HOME="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: install.sh [--version <ver>] [--install-dir <dir>] [--home <dir>]"
            echo ""
            echo "Options:"
            echo "  --version <ver>     Specific version to install (default: latest)"
            echo "  --install-dir <dir>  Binary symlink directory (default: ~/.local/bin)"
            echo "  --home <dir>         hotelbyte-cli home directory (default: ~/.hotelbyte-cli)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ── Detect platform ─────────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Darwin) PLATFORM="darwin" ;;
    Linux)  PLATFORM="linux" ;;
    *) echo -e "${RED}Unsupported OS: $OS${NC}"; exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) echo -e "${RED}Unsupported architecture: $ARCH${NC}"; exit 1 ;;
esac

ASSET_NAME="hotelbyte-cli-${PLATFORM}-${ARCH}"
if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x64" ]; then
    ASSET_NAME="hotelbyte-cli-darwin-x64"
fi

echo -e "${CYAN}${BOLD}hotelbyte-cli installer${NC}"
echo -e "  Platform: ${PLATFORM}/${ARCH}"
if [ -n "$INSTALL_VERSION" ]; then
    echo -e "  Version:  ${INSTALL_VERSION}"
else
    echo -e "  Version:  latest"
fi
echo ""

# ── Resolve version ──────────────────────────────────────────────────────

if [ -z "$INSTALL_VERSION" ]; then
    echo -e "${CYAN}Fetching latest release…${NC}"
    LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed -E 's/.*"v?([^"]+)".*/\1/')
    if [ -z "$LATEST_TAG" ]; then
        echo -e "${RED}Failed to determine latest version.${NC}"
        exit 1
    fi
    INSTALL_VERSION="$LATEST_TAG"
fi

echo -e "${CYAN}Installing version ${INSTALL_VERSION}…${NC}"

# ── Find release asset ───────────────────────────────────────────────────

RELEASE_URL="https://api.github.com/repos/${REPO}/releases/tags/v${INSTALL_VERSION}"
echo -e "${CYAN}Looking for asset ${ASSET_NAME}…${NC}"

ASSET_URL=$(curl -fsSL "$RELEASE_URL" | grep -o '"browser_download_url":\s*"[^"]*'"${ASSET_NAME}"'"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')

if [ -z "$ASSET_URL" ]; then
    echo -e "${RED}No binary found for ${PLATFORM}/${ARCH} in release v${INSTALL_VERSION}.${NC}"
    echo -e "  Available assets:"
    curl -fsSL "$RELEASE_URL" | grep '"browser_download_url"' | sed -E 's/.*"([^"]+)"$/  - \1/' || true
    exit 1
fi

# ── Download binary ──────────────────────────────────────────────────────

VERSION_DIR="${HOTELBYTE_HOME}/versions/${INSTALL_VERSION}"
mkdir -p "$VERSION_DIR"

BINARY_PATH="${VERSION_DIR}/hotelbyte-cli"

echo -e "${CYAN}Downloading ${ASSET_NAME}…${NC}"
curl -fsSL "$ASSET_URL" -o "$BINARY_PATH"
chmod +x "$BINARY_PATH"

# ── Update 'current' symlink ─────────────────────────────────────────────

CURRENT_LINK="${HOTELBYTE_HOME}/current"
if [ -L "$CURRENT_LINK" ] || [ -e "$CURRENT_LINK" ]; then
    rm -f "$CURRENT_LINK"
fi
ln -s "$VERSION_DIR" "$CURRENT_LINK"

# ── Install to bin dir ───────────────────────────────────────────────────

mkdir -p "$INSTALL_BIN_DIR"
BIN_LINK="${INSTALL_BIN_DIR}/hotelbyte-cli"
if [ -L "$BIN_LINK" ] || [ -e "$BIN_LINK" ]; then
    rm -f "$BIN_LINK"
fi
ln -s "$BINARY_PATH" "$BIN_LINK"

# ── Verify ───────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}✓ hotelbyte-cli ${INSTALL_VERSION} installed${NC}"
echo -e "  Binary:  ${BINARY_PATH}"
echo -e "  Link:    ${BIN_LINK}"
echo -e "  Home:    ${HOTELBYTE_HOME}"
echo ""

# Check if bin dir is in PATH
if [[ ":$PATH:" != *":${INSTALL_BIN_DIR}:"* ]]; then
    echo -e "${YELLOW}⚠ ${INSTALL_BIN_DIR} is not in your PATH.${NC}"
    echo -e "  Add it to your shell profile:"
    echo -e "    export PATH=\"${INSTALL_BIN_DIR}:\$PATH\""
    echo ""
fi

# Quick verify
if "$BINARY_PATH" version >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Verification passed${NC}"
    "$BINARY_PATH" version
else
    echo -e "${YELLOW}⚠ Binary verification failed — try running manually: ${BINARY_PATH} version${NC}"
fi

echo ""
echo -e "Run ${BOLD}hotelbyte-cli --help${NC} to get started."