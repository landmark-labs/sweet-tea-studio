import urllib.request
import json

BASE_URL = "http://127.0.0.1:8188"

def get_list():
    url = f"{BASE_URL}/customnode/getlist?mode=remote"
    try:
        with urllib.request.urlopen(url) as res:
            return json.loads(res.read())
    except Exception as e:
        print(f"Error: {e}")
        return {}

data = get_list()
packs = data.get('custom_nodes', [])
if not packs:
    packs = data.get('node_packs', [])

target = None
if isinstance(packs, list):
    for p in packs:
        if "Masquerade" in p.get('title', ''):
            target = p
            break
elif isinstance(packs, dict):
     for k, p in packs.items():
        if "Masquerade" in p.get('title', ''):
            target = p
            break

if target:
    print(json.dumps(target, indent=2))
else:
    print("Masquerade Nodes not found in list.")
