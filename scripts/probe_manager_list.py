import urllib.request
import json

BASE_URL = "http://127.0.0.1:8188"
URL = f"{BASE_URL}/customnode/getlist?mode=online"

print(f"Fetching {URL}...")
try:
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        content = json.loads(response.read())
        print(f"Count: {len(content['custom_nodes'])}")
        print("First Item:")
        print(json.dumps(content['custom_nodes'][0], indent=2))
except Exception as e:
    print(f"ERROR: {e}")
