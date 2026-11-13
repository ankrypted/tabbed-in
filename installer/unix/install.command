#!/bin/bash
# macOS: double-click this file (it opens in Terminal). It just runs install.sh
# next to it; open install.sh in a text editor to read exactly what it does.
cd "$(dirname "$0")" && bash ./install.sh "$@"
echo
read -r -p "Press Enter to close this window..." _
