#!/usr/bin/env python3
"""Refresh the shipped usage price snapshot from a pinned LiteLLM revision.
Usage: python3 scripts/usage-prices.py <full-commit-sha>
No network request is made by Banda or by an ordinary build.
"""
import json
import pathlib
import re
import sys
import urllib.request

revision = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"[0-9a-f]{40}", revision):
    raise SystemExit("Pass a full LiteLLM commit SHA")
url = f"https://raw.githubusercontent.com/BerriAI/litellm/{revision}/model_prices_and_context_window.json"
with urllib.request.urlopen(url, timeout=30) as response:
    prices = json.load(response)
models = {}
for model, values in prices.items():
    if values.get("litellm_provider") not in ("anthropic", "openai") or values.get("mode") != "chat":
        continue
    if "/" in model or not model.startswith(("claude-", "gpt-", "o1", "o3", "o4")):
        continue
    kept = {key: value for key, value in values.items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
            and (key.startswith(("input_cost_per_token", "output_cost_per_token", "cache_read_input_token_cost", "cache_creation_input_token_cost")))}
    if "input_cost_per_token" in kept and "output_cost_per_token" in kept:
        models[model] = kept
output = pathlib.Path(__file__).resolve().parents[1] / "modules/harnesses/engine/src/usage/prices.json"
output.write_text(json.dumps({"revision": revision, "source": url, "models": models}, sort_keys=True, indent=2) + "\n")
print(f"{len(models)} models from {revision}")
