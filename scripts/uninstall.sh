#!/bin/bash
# ============================================================================
# staicli (hbcli) Uninstaller
# ============================================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'

STAICLI_HOME="${STAICLI_HOME:-$HOME/.staicli}"
INSTALL_BIN_DIR="${STAICLI_INSTALL_BIN_DIR:-$HOME/.local/bin}"
PURGE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --purge) PURGE=true; shift ;;
        *) shift ;;
    esac
done

echo -e "${CYAN}Uninstalling staicli (hbcli)…${NC}"

BIN_LINK="${INSTALL_BIN_DIR}/hbcli"
if [ -L "$BIN_LINK" -o -e "$BIN_LINK" ]; then
    rm -f "$BIN_LINK"
    echo -e "${GREEN}✓ Removed ${BIN_LINK}${NC}"
fi

if [ "$PURGE" = true ]; then
    if [ -d "$STAICLI_HOME" ]; then
        rm -rf "$STAICLI_HOME"
        echo -e "${GREEN}✓ Removed ${STAICLI_HOME}${NC}"
    fi
else
    echo -e "${YELLOW}Preserved ${STAICLI_HOME} (--purge to remove)${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}✓ Uninstalled${NC}"