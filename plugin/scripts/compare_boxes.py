"""Compare the plug-in's element map with the PoC fixture.

  python plugin/scripts/compare_boxes.py <elementmap.json> [plugin/tests/fixtures/element-boxes.json] [--tol 1.0]

Exit 0 when both have the same element ids and every coordinate is within the tolerance (points).
"""

import json
import sys
from pathlib import Path


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    tol = float(sys.argv[sys.argv.index("--tol") + 1]) if "--tol" in sys.argv else 1.0
    if "--tol" in sys.argv:
        args.remove(str(sys.argv[sys.argv.index("--tol") + 1]))
    actual = json.loads(Path(args[0]).read_text())
    expected_path = args[1] if len(args) > 1 else Path(__file__).parents[1] / "tests" / "fixtures" / "element-boxes.json"
    expected = json.loads(Path(expected_path).read_text())

    missing = sorted(set(expected) - set(actual), key=int)
    extra = sorted(set(actual) - set(expected), key=int)
    off = []
    for key in sorted(set(actual) & set(expected), key=int):
        delta = max(abs(a - e) for a, e in zip(actual[key], expected[key]))
        if delta > tol:
            off.append((delta, key))
    off.sort(reverse=True)

    print(f"plug-in: {len(actual)} elements, fixture: {len(expected)}")
    print(f"missing in plug-in: {len(missing)} {missing[:10]}")
    print(f"extra in plug-in:   {len(extra)} {extra[:10]}")
    print(f"outside {tol} pt:   {len(off)} " + ", ".join(f"{k} ({d:.2f})" for d, k in off[:10]))
    if "676281" in actual:
        print(f"wall 676281: plug-in {actual['676281']}  fixture {expected.get('676281')}")
    return 0 if not (missing or extra or off) else 1


if __name__ == "__main__":
    sys.exit(main())
