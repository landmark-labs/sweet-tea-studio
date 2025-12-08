import urllib.request
import json

BASE_URL = "http://127.0.0.1:8188"

def get_extensions():
    url = f"{BASE_URL}/extensions"
    print(f"Fetching {url}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read())
            print(json.dumps(data, indent=2))
    except Exception as e:
        print(f"ERROR: {e}")

get_extensions()
