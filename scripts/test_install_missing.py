import urllib.request
import json

URL = "http://127.0.0.1:8000/api/v1/extensions/install_missing"
DATA = {
    "missing_nodes": ["ThisNodeDoesNotExist_Test"]
}

print(f"Posting to {URL}...")
try:
    req = urllib.request.Request(URL, data=json.dumps(DATA).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as response:
        print(response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code} - {e.read().decode('utf-8')}")
except Exception as e:
    print(f"Error: {e}")
