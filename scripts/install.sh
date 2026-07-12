#!/bin/bash
# ============================================================================
# staicli (hbcli) Installer
# ============================================================================
# One-line install — downloads a pre-compiled native binary.
#
# Usage:
#   curl -fsSL https://github.com/hotelbyte-com/hotelbyte-cli/releases/latest/download/install.sh | bash
#
# Options:
#   --version <ver>     Specific version (default: latest)
#   --install-dir <dir>  Binary symlink directory (default: ~/.local/bin)
# ============================================================================

set -e

if [ -n "${PYTHONPATH:-}" ]; then unset PYTHONPATH; fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

REPO="hotelbyte-com/hotelbyte-cli"
STAICLI_HOME="${STAICLI_HOME:-$HOME/.staicli}"
INSTALL_VERSION=""
INSTALL_BIN_DIR="${STAICLI_INSTALL_BIN_DIR:-$HOME/.local/bin}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --version)   INSTALL_VERSION="$2"; shift 2 ;;
        --install-dir) INSTALL_BIN_DIR="$2"; shift 2 ;;
        --home)      STAICLI_HOME="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: install.sh [--version <ver>] [--install-dir <dir>] [--home <dir>]"
            exit 0 ;;
        *) shift ;;
    esac
done

# Detect platform
OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in Darwin) PLATFORM="darwin" ;; Linux) PLATFORM="linux" ;; *) echo -e "${RED}Unsupported OS: $OS${NC}"; exit 1 ;; esac
case "$ARCH" in x86_64|amd64) ARCH="x64" ;; arm64|aarch64) ARCH="arm64" ;; *) echo -e "${RED}Unsupported arch: $ARCH${NC}"; exit 1 ;; esac

ASSET_NAME="hbcli-${PLATFORM}-${ARCH}"

echo -e "${CYAN}${BOLD}staicli (hbcli) installer${NC}"
echo -e "  Platform: ${PLATFORM}/${ARCH}"
echo -e "  Version:  ${INSTALL_VERSION:-latest}"
echo ""

# Resolve version
if [ -z "$INSTALL_VERSION" ]; then
    echo -e "${CYAN}Fetching latest release…${NC}"
    LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed -E 's/.*"v?([^"]+)".*/\1/')
    [ -z "$LATEST_TAG" ] && { echo -e "${RED}Failed to determine latest version.${NC}"; exit 1; }
    INSTALL_VERSION="$LATEST_TAG"
fi

echo -e "${CYAN}Installing v${INSTALL_VERSION}…${NC}"

# Find release asset
RELEASE_URL="https://api.github.com/repos/${REPO}/releases/tags/v${INSTALL_VERSION}"
ASSET_URL=$(curl -fsSL "$RELEASE_URL" | grep -o '"browser_download_url":\s*"[^"]*'"${ASSET_NAME}"'"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')

if [ -z "$ASSET_URL" ]; then
    echo -e "${RED}No binary for ${PLATFORM}/${ARCH} in v${INSTALL_VERSION}.${NC}"
    curl -fsSL "$RELEASE_URL" | grep '"browser_download_url"' | sed -E 's/.*"([^"]+)"$/  - \1/' || true
    exit 1
fi

# Download
VERSION_DIR="${STAICLI_HOME}/versions/${INSTALL_VERSION}"
mkdir -p "$VERSION_DIR"
BINARY_PATH="${VERSION_DIR}/hbcli"

echo -e "${CYAN}Downloading ${ASSET_NAME}…${NC}"
curl -fsSL "$ASSET_URL" -o "$BINARY_PATH"
chmod +x "$BINARY_PATH"

# Update 'current' symlink
CURRENT_LINK="${STAICLI_HOME}/current"
[ -L "$CURRENT_LINK" -o -e "$CURRENT_LINK" ] && rm -f "$CURRENT_LINK"
ln -s "$VERSION_DIR" "$CURRENT_LINK"

# Install to bin dir
mkdir -p "$INSTALL_BIN_DIR"
BIN_LINK="${INSTALL_BIN_DIR}/hbcli"
[ -L "$BIN_LINK" -o -e "$BIN_LINK" ] && rm -f "$BIN_LINK"
ln -s "$BINARY_PATH" "$BIN_LINK"

echo ""
echo -e "${GREEN}${BOLD}✓ staicli ${INSTALL_VERSION} installed${NC}"
echo -e "  Binary:  ${BINARY_PATH}"
echo -e "  Link:    ${BIN_LINK}"
echo ""

# PATH check
if [[ ":$PATH:" != *":${INSTALL_BIN_DIR}:"* ]]; then
    echo -e "${YELLOW}⚠ Add to PATH:${NC}  export PATH=\"${INSTALL_BIN_DIR}:\$PATH\""
    echo ""
fi

# Verify
if "$BINARY_PATH" version >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Verification passed${NC}"
    "$BINARY_PATH" version
else
    echo -e "${YELLOW}⚠ Try: ${BINARY_PATH} version${NC}"
fi

echo ""
echo -e "Run ${BOLD}hbcli --help${NC} to get started."