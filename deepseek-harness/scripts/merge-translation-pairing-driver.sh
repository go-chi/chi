#!/bin/sh

if [ "$#" -ne 4 ]; then
  echo 'merge-translation-pairing: expected <ancestor> <current> <other> <repository-path>' >&2
  exit 129
fi

ancestor_path=$1
current_path=$2
other_path=$3
meta_path=$4
driver_directory=$(CDPATH= cd -P "$(dirname "$0")" && pwd) || exit 129
driver_path=$driver_directory/merge-translation-pairing.ts

if command -v node >/dev/null 2>&1 \
  && node --import tsx/esm "$driver_path" --probe >/dev/null 2>&1; then
  exec node --import tsx/esm "$driver_path" \
    "$ancestor_path" "$current_path" "$other_path" "$meta_path"
fi

echo "merge-translation-pairing: runtime is unavailable; leaving an ordinary text conflict in $meta_path" >&2
git merge-file \
  -L "$meta_path:current" \
  -L "$meta_path:ancestor" \
  -L "$meta_path:other" \
  -- "$current_path" "$ancestor_path" "$other_path"
fallback_status=$?
echo 'merge-translation-pairing: restore Node dependencies, then rerun the merge or `pnpm run resolve-translation-pairing-conflicts`; use `git merge --abort` to cancel' >&2

# A clean text merge is still unverified pairing metadata, so the driver must
# leave Git's index stages unresolved until the repository-aware resolver runs.
if [ "$fallback_status" -gt 127 ]; then
  exit "$fallback_status"
fi
exit 1
