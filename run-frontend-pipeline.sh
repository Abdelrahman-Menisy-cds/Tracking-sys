#!/usr/bin/env bash
# Run brief A (editable file UI), then brief B (prayer + adhkar) only if the tree
# is still sound. Written as a file so quoting cannot mangle the briefs.
set -uo pipefail

REPO=/home/menisy/Desktop/Me/tracking_system_project
FE="$REPO/frontend"

echo "############ RUN A — editable employee file UI — $(date -Is) ############"
hermes -p frontend_engineer chat \
  --query-file "$REPO/brief-A-editable-file-ui.md" \
  --oneshot --yolo --run-budget 2700 --in "$REPO"
echo "############ A EXIT=$? — $(date -Is) ############"

echo
echo "############ GUARD — is the tree sound after A? ############"
cd "$FE" || exit 1
node node_modules/typescript/bin/tsc -b --pretty false
TSC=$?
echo "GUARD TSC_EXIT=$TSC"
echo "GUARD COMMITS:"
git -C "$REPO" log --oneline -3

if [ "$TSC" -ne 0 ]; then
  echo "############ GUARD FAILED — skipping run B, tree needs repair ############"
  exit 3
fi

echo
echo "############ RUN B — prayer times + adhkar — $(date -Is) ############"
hermes -p frontend_engineer chat \
  --query-file "$REPO/brief-B-prayer-adhkar.md" \
  --oneshot --yolo --run-budget 3600 --in "$REPO"
echo "############ B EXIT=$? — $(date -Is) ############"

echo
echo "############ FINAL STATE ############"
node node_modules/typescript/bin/tsc -b --pretty false; echo "FINAL TSC_EXIT=$?"
git -C "$REPO" log --oneline -4
git -C "$REPO" status --porcelain | grep -vE '^\?\?' || echo "(tracked tree clean)"
