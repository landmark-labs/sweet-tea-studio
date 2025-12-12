import urllib.request
import json
import sys

BASE_URL = "http://127.0.0.1:8188"

def check_loaded():
    url = f"{BASE_URL}/object_info"
    try:
        with urllib.request.urlopen(url) as res:
            data = json.loads(res.read())
            
            # Nodes to look for
            targets = ["MaskToRegion", "PasteByMask", "CutByMask"]
            
            found = []
            for t in targets:
                if t in data:
                    found.append(t)
            
            with open("install_status_check.txt", "w") as f:
                if found:
                    f.write("YES")
                    print("FOUND_MASQUERADE_NODES: YES")
                else:
                    f.write("NO")
                    print("FOUND_MASQUERADE_NODES: NO")

                
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    check_loaded()
    sys.stdout.flush()
