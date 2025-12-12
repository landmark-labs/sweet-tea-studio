import urllib.request
import urllib.error
import urllib.parse
import json

BASE_URL = "http://127.0.0.1:8188"
ENDPOINT = "/manager/queue/install"

# Mock package data - FULL RECORD
mock_pack = {
    "author": "Masquerade",
    "title": "Masquerade Nodes",
    "reference": "https://github.com/masquerade-circus/masquerade-nodes-comfyui",
    "files": ["https://github.com/masquerade-circus/masquerade-nodes-comfyui"],
    "install_type": "git-clone",
    "description": "Masquerade Nodes description",
    "id": "masquerade-nodes-comfyui",
    "version": "unknown" 
}

def test_payload(name, payload):
    print(f"Testing payload '{name}' on {ENDPOINT}...")
    url = f"{BASE_URL}{ENDPOINT}"
    
    encoded_data = json.dumps(payload).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
        
    req = urllib.request.Request(url, data=encoded_data, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            print(f"  SUCCESS ({res.code}):", res.read().decode('utf-8')[:100])
    except urllib.error.HTTPError as e:
        print(f"  FAILED: {e.code} {e.reason}")
        try:
             print("   Content:", e.read().decode('utf-8'))
        except: pass
    except Exception as e:
         print(f"  ERROR: {e}")

if __name__ == "__main__":
    test_payload("Full Pack with Version", mock_pack)
