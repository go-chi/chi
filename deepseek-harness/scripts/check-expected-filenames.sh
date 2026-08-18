#!/usr/bin/env bash
set -euo pipefail

# Vendored upstream paths follow vendor/README.md instead of repository naming policy.
root=$(git rev-parse --show-toplevel)
candidate_file=$(mktemp)
trap 'unlink "$candidate_file"' EXIT
git -C "$root" ls-files -z -- \
  ':(icase,glob)*golden*' \
  ':(icase,glob)**/*golden*' \
  ':(exclude,glob)vendor/**' > "$candidate_file"

violations=()
while IFS= read -r -d '' path; do
  violations+=("$path")
done < "$candidate_file"

if (( ${#violations[@]} == 0 )); then
  echo 'check-expected-filenames: no tracked non-vendor filename contains "golden".'
  exit 0
fi

echo 'check-expected-filenames: tracked non-vendor filenames must not contain "golden":' >&2
printf '  %s\n' "${violations[@]}" >&2
echo 'Rename each file with an accurate term such as "expected".' >&2
exit 1
