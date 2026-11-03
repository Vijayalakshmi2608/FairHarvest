import os
import re
from pathlib import Path

EXPECTED = 18
assert int(os.getenv("STABLECOIN_DECIMALS", str(EXPECTED))) == EXPECTED
root = Path(__file__).resolve().parents[1]
for path in (root / ".env.example", root / "ai-service" / ".env.example", root / "backend" / ".env.example"):
    match = re.search(r"^STABLECOIN_DECIMALS=(\d+)$", path.read_text(), re.MULTILINE)
    assert match, f"missing STABLECOIN_DECIMALS in {path}"
    assert int(match.group(1)) == EXPECTED, f"mismatched decimals in {path}"
print(f"ai-service STABLECOIN_DECIMALS={EXPECTED}; templates consistent")
