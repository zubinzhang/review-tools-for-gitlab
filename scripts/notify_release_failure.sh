#!/usr/bin/env bash
set -uo pipefail

if [ "${CI_JOB_STATUS:-}" != "failed" ]; then
  exit 0
fi

if [ -z "${SLACK_WEBHOOK:-}" ]; then
  echo "SLACK_WEBHOOK is not set, skipping release failure notification."
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is not available, skipping release failure notification."
  exit 0
fi

# shellcheck disable=SC2016 # backticks are Slack code formatting
text=$(printf ':rotating_light: Release job <%s|%s> failed on `%s` in %s. The release may be incomplete. <%s|View pipeline>' \
  "$CI_JOB_URL" "$CI_JOB_NAME" "$CI_COMMIT_REF_NAME" "$CI_PROJECT_PATH" "$CI_PIPELINE_URL")

if ! curl --silent --show-error --fail --max-time 15 \
  --header 'Content-Type: application/json' \
  --data "{\"text\":\"${text}\"}" \
  "$SLACK_WEBHOOK" >/dev/null; then
  echo "Failed to send release failure notification."
fi

exit 0
