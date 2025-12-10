#!/usr/bin/env bash

# Ensure consistent execution environment and explicit failures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CONFIG_FILE="${CONFIG_FILE:-${PROJECT_ROOT}/config.yaml}"
LOCAL_RPC_URL="${LOCAL_RPC_URL:-http://127.0.0.1:8545}"
REMOTE_RPC_URL="${REMOTE_RPC_URL:-https://vfgvanuabr.eu-central-1.awsapprunner.com/}"
CHOICE_INPUT="${RPC_SOURCE:-}"
FLOOR_FACTORY_INPUT="${FLOOR_FACTORY:-}"

if [[ -z "${CHOICE_INPUT}" ]]; then
  if [[ -t 0 ]]; then
    printf 'Select RPC source ([l]ocal/[r]emote, default remote): ' >&2
    read -r CHOICE_INPUT
  else
    CHOICE_INPUT="remote"
  fi
fi

CHOICE_INPUT="$(printf '%s' "${CHOICE_INPUT:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

if [[ "${CHOICE_INPUT}" == "local" || "${CHOICE_INPUT}" == "l" ]]; then
  SELECTED_URL="${LOCAL_RPC_URL}"
  echo "→ Using local RPC: ${SELECTED_URL}" >&2
else
  SELECTED_URL="${REMOTE_RPC_URL}"
  echo "→ Using remote RPC: ${SELECTED_URL}" >&2
fi

printf "export RPC_URL_31337=%q\n" "${SELECTED_URL}"

if [[ -z "${FLOOR_FACTORY_INPUT}" ]]; then
  if [[ -t 0 ]]; then
    printf 'FloorFactory override (leave blank to skip): ' >&2
    read -r FLOOR_FACTORY_INPUT
  else
    FLOOR_FACTORY_INPUT=""
  fi
fi

FLOOR_FACTORY_INPUT="$(printf '%s' "${FLOOR_FACTORY_INPUT:-}" | tr -d '[:space:]')"

if [[ -n "${FLOOR_FACTORY_INPUT}" ]]; then
  echo "→ Using FloorFactory override: ${FLOOR_FACTORY_INPUT}" >&2
  printf "export FLOOR_FACTORY=%q\n" "${FLOOR_FACTORY_INPUT}"
fi

