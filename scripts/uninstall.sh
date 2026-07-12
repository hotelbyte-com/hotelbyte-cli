#!/bin/bash
# ============================================================================
# hotelbyte-cli Uninstaller
# ============================================================================
# Removes the hotelbyte-cli binary, symlinks, and optionally the home directory.
#
# Usage:
#   curl -fsSL https://github.com/hotelbyte-com/hotelbyte-cli/releases/latest/download/uninstall.sh | bash
#
# Options:
#   --purge   Also remove ~/.hotelbyte-cli (credentials, config)
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

HOTELBYTE_HOME="${HOTELBYTE_HOME:-$HOME/.hotelbyte-cli}"
INSTALL_BIN_DIR="${HOTELBYTE_INSTALL_BIN_DIR:-$HOME/.local/bin}"
PURGE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --purge) PURGE=true; shift ;;
        --help|-h)
            echo "Usage: uninstall.sh [--purge]"
            echo "  --purge  Also remove ~/.hotelbyte-cli (credentials, config)"
            exit 0
            ;;
        *) shift ;;
    esac
done

echo -e "${CYAN}Uninstalling hotelbyte-cli…${NC}"

# Remove bin symlink
BIN_LINK="${INSTALL_BIN_DIR}/hotelbyte-cli"
if [ -L "$BIN_LINK" ] || [ -e "$BIN_LINK" ]; then
    rm -f "$BIN_LINK"
    echo -e "${GREEN}✓ Removed ${BIN_LINK}${NC}"
else
    echo -e "${YELLOW}Binary link not found at ${BIN_LINK}${NC}"
fi

# Remove home directory
if [ "$PURGE" = true ]; then
    if [ -d "$HOTELBYTE_HOME" ]; then
        rm -rf "$HOTELBYTE_HOME"
        echo -e "${GREEN}✓ Removed ${HOTELBYTE_HOME} (including credentials)${NC}"
    fi
else
    echo -e "${YELLOW}Preserved ${HOTELBYTE_HOME} (use --purge to remove credentials/config)${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}✓ Uninstalled hotelbyte-cli${NC}"