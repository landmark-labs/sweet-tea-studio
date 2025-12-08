import urllib.request

BASE_URL = "http://127.0.0.1:8188"
FILE_PATH = "/extensions/ComfyUI-Manager/custom-nodes-manager.js"

url = f"{BASE_URL}{FILE_PATH}"
print(f"Fetching {url}...")
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
        print(content)
except Exception as e:
    print(f"ERROR: {e}")
