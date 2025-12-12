import urllib.request
import json
import time

BASE_URL = "http://127.0.0.1:8188/manager/queue/install"

payload = {
  "author": "Unclaimed",
  "title": "Masquerade Nodes",
  "id": "masquerade-nodes-comfyui",
  "reference": "https://github.com/BadCafeCode/masquerade-nodes-comfyui",
  "files": [
    "https://github.com/BadCafeCode/masquerade-nodes-comfyui"
  ],
  "install_type": "git-clone",
  "description": "This is a low-dependency node pack primarily dealing with masks.",
  "cnr_latest": "nightly",
  "repository": "https://github.com/BadCafeCode/masquerade-nodes-comfyui",
  "version": "nightly",
  
  # Try "local" channel
  "channel": "local", 
  "mode": "local"
}

print(f"Sending payload to {BASE_URL}...")
print(json.dumps(payload, indent=2))

data = json.dumps(payload).encode('utf-8')
headers = {'Content-Type': 'application/json'}
req = urllib.request.Request(BASE_URL, data=data, method="POST", headers=headers)

try:
    with urllib.request.urlopen(req) as res:
        content = res.read()
        print(f"Status: {res.code}")
        print(f"Body: {content.decode('utf-8')}")
except Exception as e:
    print(f"Error: {e}")
