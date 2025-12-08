import urllib.request
import json
import sys

BASE_URL = "http://127.0.0.1:8188"

def probe(path):
    url = f"{BASE_URL}{path}"
    print(f"Probing {url}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read())
            print(f"SUCCESS: {path}")
            # print(json.dumps(data, indent=2)[:500]) # Print first 500 chars
            return True
    except urllib.error.HTTPError as e:
        print(f"FAILED: {path} - {e.code}")
    except Exception as e:
        print(f"ERROR: {path} - {e}")
    return False

print("Checking for ComfyUI Manager endpoints...")

# Common ComfyUI Manager endpoints based on community knowledge
endpoints = [
    "/customnode/get_list", 
    "/customnode/get_mappings",
    "/manager/check_update",
    "/extensions",
    "/object_info" 
]

found = []
for ep in endpoints:
    if probe(ep):
        found.append(ep)

print(f"\nFound {len(found)} endpoints: {found}")
