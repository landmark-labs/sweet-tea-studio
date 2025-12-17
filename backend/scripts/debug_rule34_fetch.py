import sys
from pathlib import Path

# Add project root to path so we can import 'app'
current = Path(__file__).resolve()
project_root = current.parent.parent
sys.path.append(str(project_root))

from app.api.endpoints.library_tags import fetch_all_rule34_tags, fetch_rule34_tags, resolve_via_doh  # noqa: E402


def main() -> None:
    api_host = "api.rule34.xxx"
    base_host = "rule34.xxx"

    print("Rule34 DoH resolution:")
    print(f"  - {api_host} -> {resolve_via_doh(api_host)}")
    print(f"  - {base_host} -> {resolve_via_doh(base_host)}")
    print("")

    print("Rule34 autocomplete sample (q=b):")
    try:
        sample = fetch_rule34_tags("b", limit=10)
        print(f"  - fetched {len(sample)}")
        for t in sample[:5]:
            print(f"    - {t.name} ({t.frequency})")
    except Exception as e:
        print(f"  - ERROR: {e}")
    print("")

    print("Rule34 bulk fetch (max_tags=200):")
    try:
        tags = fetch_all_rule34_tags(max_tags=200, page_size=100)
        print(f"  - fetched {len(tags)}")
        for t in tags[:10]:
            print(f"    - {t.name} ({t.frequency})")
    except Exception as e:
        print(f"  - ERROR: {e}")


if __name__ == "__main__":
    main()

