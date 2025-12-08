import urllib.request
import json

BASE_URL = "http://127.0.0.1:8188"
LIST_URL = f"{BASE_URL}/customnode/getlist?mode=online"
MAPPINGS_URL = f"{BASE_URL}/customnode/getmappings?mode=online"

def fetch(url, name):
    print(f"Fetching {url}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            content = json.loads(response.read())
            print(f"[{name}] Type: {type(content)}")
            if isinstance(content, list):
                print(f"[{name}] Count: {len(content)}")
                if len(content) > 0:
                    print(f"[{name}] First Item Sample:")
                    print(json.dumps(content[0], indent=2))
            elif isinstance(content, dict):
                print(f"[{name}] Keys: {list(content.keys())[:10]}")
                # Print first key/val
                first_key = list(content.keys())[0]
                print(f"[{name}] First Item ({first_key}):")
                print(json.dumps(content[first_key], indent=2))
    except Exception as e:
        print(f"ERROR {name}: {e}")

fetch(LIST_URL, "List")
fetch(MAPPINGS_URL, "Mappings")
