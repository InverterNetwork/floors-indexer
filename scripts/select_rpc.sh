#!/usr/bin/env bash

# Ensure consistent execution environment and explicit failures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CONFIG_FILE="${CONFIG_FILE:-${PROJECT_ROOT}/config.yaml}"
LOCAL_RPC_URL="${LOCAL_RPC_URL:-http://127.0.0.1:8545}"
REMOTE_RPC_URL="${REMOTE_RPC_URL:-https://vfgvanuabr.eu-central-1.awsapprunner.com/}"
CHOICE_INPUT="${RPC_SOURCE:-}"

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

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "config file not found: ${CONFIG_FILE}" >&2
  exit 1
fi

python3 - "${CONFIG_FILE}" "${SELECTED_URL}" <<'PY'
import pathlib
import re
import sys

config_path = pathlib.Path(sys.argv[1]).resolve()
selected_url = sys.argv[2]

data = config_path.read_text()
pattern = r"(id:\s*31337\b[\s\S]*?url:\s*)(?:'[^']*'|\"[^\"]*\"|\S+)"
replacement = r"\1'{}'".format(selected_url)

new_data, count = re.subn(pattern, replacement, data, count=1)
if count == 0:
    sys.stderr.write(f"Could not update 31337 RPC URL in {config_path}\n")
    sys.exit(1)

config_path.write_text(new_data)
PY

echo "✓ Updated ${CONFIG_FILE} with ${SELECTED_URL}" >&2

printf "export RPC_URL_31337=%q\n" "${SELECTED_URL}"

