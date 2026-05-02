#!/usr/bin/env bash
set -euo pipefail

environment="${1:-dev}"
region="${AWS_REGION:-us-east-1}"
stack_name="CollectoolBackendStack-${environment}"
profile_args=()

if [[ -n "${AWS_PROFILE:-}" ]]; then
  profile_args=(--profile "$AWS_PROFILE")
fi

aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$region" \
  "${profile_args[@]}" \
  --query 'Stacks[0].Outputs' \
  --output table
