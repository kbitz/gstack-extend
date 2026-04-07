#!/usr/bin/env bash
# gstack-extend shared semver comparison.
# Source this file; do not execute directly.
#
# version_gt returns 0 if $1 > $2, 1 otherwise.
# Pure bash, no sort -V (unavailable on stock macOS).
version_gt() {
  local IFS='.'
  read -ra a <<< "$1"
  read -ra b <<< "$2"
  local i
  for i in 0 1 2 3; do
    local ai="${a[$i]:-0}"
    local bi="${b[$i]:-0}"
    if (( ai > bi )); then return 0; fi
    if (( ai < bi )); then return 1; fi
  done
  return 1  # equal
}

# semver_lte returns 0 if $1 <= $2, 1 otherwise.
semver_lte() {
  if version_gt "$1" "$2"; then
    return 1
  fi
  return 0
}
